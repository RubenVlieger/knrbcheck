const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { LRUCache } = require('lru-cache');
const { fetchPerson, fetchHistory } = require('./foys');

const DB_DIR = path.join(__dirname, 'db');
const DB_PATH = path.join(DB_DIR, 'cache.sqlite');

const TTL = {
  PERSON: 30 * 60 * 1000,
  HISTORY: 7 * 24 * 60 * 60 * 1000,
  FIELD_RESULT: 2 * 60 * 1000,
  TOURNAMENTS: 60 * 60 * 1000,
};

const BATCH_SIZE = 25;

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS person_cache (
    person_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS history_cache (
    person_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS field_cache (
    cache_key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    match_hash TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
`);

const stmtPersonGet = db.prepare('SELECT data, fetched_at FROM person_cache WHERE person_id = ?');
const stmtPersonSet = db.prepare('INSERT OR REPLACE INTO person_cache (person_id, data, fetched_at) VALUES (?, ?, ?)');
const stmtHistoryGet = db.prepare('SELECT data, fetched_at FROM history_cache WHERE person_id = ?');
const stmtHistorySet = db.prepare('INSERT OR REPLACE INTO history_cache (person_id, data, fetched_at) VALUES (?, ?, ?)');
const stmtFieldGet = db.prepare('SELECT data, match_hash, fetched_at FROM field_cache WHERE cache_key = ?');
const stmtFieldSet = db.prepare('INSERT OR REPLACE INTO field_cache (cache_key, data, match_hash, fetched_at) VALUES (?, ?, ?, ?)');
const stmtDeleteExpiredPerson = db.prepare('DELETE FROM person_cache WHERE fetched_at < ?');
const stmtDeleteExpiredHistory = db.prepare('DELETE FROM history_cache WHERE fetched_at < ?');
const stmtDeleteExpiredField = db.prepare('DELETE FROM field_cache WHERE fetched_at < ?');

const lruPerson = new LRUCache({ max: 500, ttl: TTL.PERSON });
const lruHistory = new LRUCache({ max: 500, ttl: TTL.HISTORY });
const lruField = new LRUCache({ max: 100, ttl: TTL.FIELD_RESULT });

let stats = { personHits: 0, personMisses: 0, historyHits: 0, historyMisses: 0, fieldHits: 0, fieldMisses: 0 };

function getPersonCached(personId) {
  if (lruPerson.has(personId)) {
    stats.personHits++;
    return lruPerson.get(personId);
  }
  const row = stmtPersonGet.get(personId);
  if (row && (Date.now() - row.fetched_at) < TTL.PERSON) {
    const data = JSON.parse(row.data);
    lruPerson.set(personId, data);
    stats.personHits++;
    return data;
  }
  stats.personMisses++;
  return null;
}

function getHistoryCached(personId) {
  if (lruHistory.has(personId)) {
    stats.historyHits++;
    return lruHistory.get(personId);
  }
  const row = stmtHistoryGet.get(personId);
  if (row && (Date.now() - row.fetched_at) < TTL.HISTORY) {
    const data = JSON.parse(row.data);
    lruHistory.set(personId, data);
    stats.historyHits++;
    return data;
  }
  stats.historyMisses++;
  return null;
}

function setPersonCached(personId, data, fetchedAt) {
  lruPerson.set(personId, data);
  stmtPersonSet.run(personId, JSON.stringify(data), fetchedAt || Date.now());
}

function setHistoryCached(personId, data, fetchedAt) {
  lruHistory.set(personId, data);
  stmtHistorySet.run(personId, JSON.stringify(data), fetchedAt || Date.now());
}

async function getPersonDataBatch(personIds) {
  const results = new Map();
  const toFetch = [];

  for (const pid of personIds) {
    const cached = getPersonCached(pid);
    if (cached) {
      results.set(pid, cached);
    } else {
      toFetch.push(pid);
    }
  }

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const chunk = toFetch.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(chunk.map(pid => fetchPerson(pid)));
    for (let j = 0; j < settled.length; j++) {
      const result = settled[j];
      const pid = chunk[j];
      if (result.status === 'fulfilled') {
        const { personId, data, fetchedAt } = result.value;
        setPersonCached(personId, data, fetchedAt);
        results.set(pid, data);
      } else {
        console.error(`Failed to fetch person ${pid}:`, result.reason?.message || result.reason);
        results.set(pid, { totalScullingPoints: 0, totalSweepingPoints: 0, rowingPoints: [] });
      }
    }
  }

  return results;
}

async function getHistoryBatch(personIds) {
  const results = new Map();
  const toFetch = [];

  for (const pid of personIds) {
    const cached = getHistoryCached(pid);
    if (cached) {
      results.set(pid, cached);
    } else {
      toFetch.push(pid);
    }
  }

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const chunk = toFetch.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(chunk.map(pid => fetchHistory(pid)));
    for (let j = 0; j < settled.length; j++) {
      const result = settled[j];
      const pid = chunk[j];
      if (result.status === 'fulfilled') {
        const { personId, data, fetchedAt } = result.value;
        setHistoryCached(personId, data, fetchedAt);
        results.set(pid, data);
      } else {
        console.error(`Failed to fetch history for ${pid}:`, result.reason?.message || result.reason);
        results.set(pid, []);
      }
    }
  }

  return results;
}

function getCachedFieldResult(tournamentId, matchId, currentMatchHash) {
  if (lruField.has(`${tournamentId}:${matchId}`)) {
    const cached = lruField.get(`${tournamentId}:${matchId}`);
    if (cached.matchHash === currentMatchHash) {
      stats.fieldHits++;
      return cached.result;
    }
  }
  const row = stmtFieldGet.get(`${tournamentId}:${matchId}`);
  if (row && row.match_hash === currentMatchHash && (Date.now() - row.fetched_at) < TTL.FIELD_RESULT) {
    const result = JSON.parse(row.data);
    lruField.set(`${tournamentId}:${matchId}`, { matchHash: currentMatchHash, result });
    stats.fieldHits++;
    return result;
  }
  stats.fieldMisses++;
  return null;
}

function setCachedFieldResult(tournamentId, matchId, matchHash, result) {
  const key = `${tournamentId}:${matchId}`;
  lruField.set(key, { matchHash, result });
  stmtFieldSet.run(key, JSON.stringify(result), matchHash, Date.now());
}

function clearAllCache() {
  lruPerson.clear();
  lruHistory.clear();
  lruField.clear();
  db.exec('DELETE FROM person_cache; DELETE FROM history_cache; DELETE FROM field_cache;');
}

function pruneExpiredEntries() {
  const now = Date.now();
  const personDeleted = stmtDeleteExpiredPerson.run(now - TTL.PERSON * 3).changes;
  const historyDeleted = stmtDeleteExpiredHistory.run(now - TTL.HISTORY * 3).changes;
  const fieldDeleted = stmtDeleteExpiredField.run(now - TTL.FIELD_RESULT * 3).changes;

  if (personDeleted + historyDeleted + fieldDeleted > 0) {
    console.log(`Pruned expired cache entries: ${personDeleted} persons, ${historyDeleted} histories, ${fieldDeleted} fields`);
  }
}

function getCacheStats() {
  const personCount = db.prepare('SELECT COUNT(*) as count FROM person_cache').get().count;
  const historyCount = db.prepare('SELECT COUNT(*) as count FROM history_cache').get().count;
  const fieldCount = db.prepare('SELECT COUNT(*) as count FROM field_cache').get().count;

  return {
    personCache: { count: personCount, lruSize: lruPerson.size, hits: stats.personHits, misses: stats.personMisses },
    historyCache: { count: historyCount, lruSize: lruHistory.size, hits: stats.historyHits, misses: stats.historyMisses },
    fieldCache: { count: fieldCount, lruSize: lruField.size, hits: stats.fieldHits, misses: stats.fieldMisses },
    ttl: { person: `${TTL.PERSON / 60000}min`, history: `${TTL.HISTORY / 86400000}d`, fieldResult: `${TTL.FIELD_RESULT / 60000}min` },
  };
}

module.exports = {
  getPersonDataBatch,
  getHistoryBatch,
  getCachedFieldResult,
  setCachedFieldResult,
  clearAllCache,
  pruneExpiredEntries,
  getCacheStats,
  TTL,
  db,
};