const express = require('express');
const path = require('path');
const fs = require('fs');
const { checkCrew, classifyField } = require('./rules');
const { fetchMatch, fetchMatches, fetchTournaments, extractCrews, extractUniquePersonIds, computeMatchHash } = require('./foys');
const { getPersonDataBatch, getHistoryBatch, getCachedFieldResult, setCachedFieldResult, clearAllCache, pruneExpiredEntries, getCacheStats, TTL } = require('./cache');

const STATS_FILE = path.join(__dirname, 'stats.json');
let totalChecks = 102;

try {
  if (fs.existsSync(STATS_FILE)) {
    const d = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    totalChecks = d.totalChecks !== undefined ? d.totalChecks : 102;
  }
} catch (e) {}

function incrementCounter() {
  totalChecks++;
  try { fs.writeFileSync(STATS_FILE, JSON.stringify({ totalChecks })); } catch (e) {}
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

let cachedTournaments = null;
let lastTournamentsFetch = 0;

app.get('/api/tournaments', async (req, res) => {
  try {
    if (cachedTournaments && (Date.now() - lastTournamentsFetch < TTL.TOURNAMENTS)) {
      return res.json({ tournaments: cachedTournaments });
    }

    const data = await fetchTournaments();
    const baseTournaments = (data.items || []).filter(t => t.status !== 'Cancelled');

    const validTournaments = [];

    for (let i = 0; i < baseTournaments.length; i += 10) {
      const chunk = baseTournaments.slice(i, i + 10);
      await Promise.all(chunk.map(async (t) => {
        try {
          const matchData = await fetchMatches(t.id);
          const hasEligibleField = matchData.some(m => {
            const cat = (m.matchCategoryName || '').toLowerCase();
            return cat.includes('gevorderde') || cat.includes('eerstejaars') ||
              cat.includes('development') || cat.includes('nieuweling') ||
              cat.includes('beginner') || cat.includes('first-year') || cat.includes('advanced');
          });
          if (hasEligibleField) {
            validTournaments.push(t);
          }
        } catch (e) {
          console.error(`Failed to fetch matches for ${t.id}:`, e.message);
        }
      }));
    }

    const tournaments = validTournaments
      .map(t => ({
        id: t.id,
        name: (t.name || '').trim(),
        firstDate: t.firstTournamentDate,
        lastDate: t.lastTournamentDate,
        type: t.tournamentTypeName,
        isClassifing: t.isClassifing,
        status: t.publicTournamentStatus,
      }))
      .sort((a, b) => new Date(a.firstDate) - new Date(b.firstDate));

    cachedTournaments = tournaments;
    lastTournamentsFetch = Date.now();

    res.json({ tournaments });
  } catch (err) {
    console.error('Error fetching tournaments:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', (req, res) => {
  res.json({ totalChecks });
});

app.get('/api/matches', async (req, res) => {
  try {
    const { tournamentId } = req.query;
    if (!tournamentId) {
      return res.status(400).json({ error: 'Missing tournamentId' });
    }

    const data = await fetchMatches(tournamentId);

    const matches = data.map(m => ({
      id: m.id,
      code: m.code,
      name: m.name,
      matchCategoryName: m.matchCategoryName,
      matchBoatCategoryCode: m.matchBoatCategoryCode,
      matchFullName: m.matchFullName,
      matchGeneratedCode: m.matchGeneratedCode,
      registrationCount: m.registrationCount,
      genderType: m.genderType,
      weightType: m.weightType,
    }));

    res.json({ tournamentId, matches });
  } catch (err) {
    console.error('Error fetching matches:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/check-field', async (req, res) => {
  try {
    const { tournamentId, matchId, combinedNieuweling = true } = req.body;
    if (!tournamentId || !matchId) {
      return res.status(400).json({ error: 'Missing tournamentId or matchId' });
    }

    console.log(`Checking field: tournament=${tournamentId}, match=${matchId}`);
    incrementCounter();

    const match = await fetchMatch(tournamentId, matchId);
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const matchHash = computeMatchHash(match);

    const cachedResult = getCachedFieldResult(tournamentId, String(matchId), matchHash);
    if (cachedResult) {
      console.log(`Cache HIT for field ${matchId} (hash: ${matchHash})`);
      return res.json(cachedResult);
    }

    console.log(`Cache MISS for field ${matchId} (hash: ${matchHash})`);

    const { matchCategoryName, matchBoatCategoryCode } = match;
    console.log(`Match: ${match.matchFullName} (${matchCategoryName} / ${matchBoatCategoryCode})`);

    const crews = extractCrews(match);
    console.log(`Found ${crews.length} crews to check`);

    const uniquePersonIds = extractUniquePersonIds(crews);
    console.log(`Fetching data for ${uniquePersonIds.length} unique rowers...`);

    const [personDataMap, historyMap] = await Promise.all([
      getPersonDataBatch(uniquePersonIds),
      getHistoryBatch(uniquePersonIds),
    ]);

    console.log('All person data fetched. Running rule checks...');

    const results = [];
    for (const crew of crews) {
      const enrichedRowers = crew.rowers.map(r => ({
        ...r,
        personData: personDataMap.get(r.personId) || {},
        raceHistory: historyMap.get(r.personId) || [],
      }));

      const result = checkCrew(enrichedRowers, matchCategoryName, matchBoatCategoryCode, combinedNieuweling, match.matchGeneratedCode);

      results.push({
        teamName: crew.teamName,
        organisationName: crew.organisationName,
        matchCode: `${match.matchGeneratedCode || ''} ${matchBoatCategoryCode || ''}`.trim(),
        ...result,
      });
    }

    results.sort((a, b) => {
      if (a.status === 'ILLEGAL' && b.status !== 'ILLEGAL') return -1;
      if (a.status !== 'ILLEGAL' && b.status === 'ILLEGAL') return 1;
      return 0;
    });

    const illegalCount = results.filter(r => r.status === 'ILLEGAL').length;
    console.log(`Check complete: ${illegalCount} illegal crews out of ${results.length} total`);

    const response = {
      matchFullName: match.matchFullName,
      matchCategoryName,
      matchBoatCategoryCode,
      totalCrews: results.length,
      illegalCrews: illegalCount,
      results,
    };

    setCachedFieldResult(tournamentId, String(matchId), matchHash, response);

    res.json(response);
  } catch (err) {
    console.error('Error checking field:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clear-cache', (req, res) => {
  cachedTournaments = null;
  lastTournamentsFetch = 0;
  clearAllCache();
  console.log('All caches cleared');
  res.json({ success: true });
});

app.get('/api/cache-stats', (req, res) => {
  const mem = process.memoryUsage();
  const cacheStats = getCacheStats();
  res.json({
    cache: cacheStats,
    memory: {
      heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
    },
    uptime: `${Math.round(process.uptime())}s`,
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

setInterval(() => {
  pruneExpiredEntries();
}, 30 * 60 * 1000);

setInterval(() => {
  const mem = process.memoryUsage();
  console.log(`Memory: heap=${Math.round(mem.heapUsed / 1024 / 1024)}MB, rss=${Math.round(mem.rss / 1024 / 1024)}MB`);
}, 5 * 60 * 1000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`KNRB Regatta Checker running on all interfaces (0.0.0.0) at port ${PORT}`);
});