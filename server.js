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

    const field = classifyField(matchCategoryName, matchBoatCategoryCode);
    const needsHistory = field.category === 'development' || field.category === 'eerstejaars';

    const [personDataMap, historyMap] = await Promise.all([
      getPersonDataBatch(uniquePersonIds),
      needsHistory ? getHistoryBatch(uniquePersonIds) : Promise.resolve(new Map()),
    ]);

    console.log(`All person data fetched (history: ${needsHistory ? 'yes' : 'skipped'}). Running rule checks...`);

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

app.post('/api/check-tournament', async (req, res) => {
  try {
    const { tournamentId, combinedNieuweling = true } = req.body;
    if (!tournamentId) {
      return res.status(400).json({ error: 'Missing tournamentId' });
    }

    console.log(`Checking full tournament: tournament=${tournamentId}`);
    const startTime = Date.now();

    // 1 API call to get match list, then individual calls for full registration data
    const rawMatches = await fetchMatches(tournamentId);
    // Handle both array and { items: [...] } response formats
    const allMatches = Array.isArray(rawMatches) ? rawMatches : (rawMatches.items || []);
    console.log(`fetchMatches returned ${allMatches.length} total matches`);

    // Only check fields with registrations
    const eligibleMatches = allMatches.filter(m => (m.registrationCount || 0) > 0);
    console.log(`Found ${eligibleMatches.length} fields with registrations`);
    if (eligibleMatches.length === 0) {
      console.log(`Warning: no fields with registrations found. All ${allMatches.length} matches have registrationCount<=0`);
      if (allMatches.length > 0) {
        console.log(`First match sample: ${JSON.stringify({ id: allMatches[0].id, name: allMatches[0].matchFullName, registrationCount: allMatches[0].registrationCount }).slice(0, 200)}`);
      }
    }

    // Pre-build: extract crews + hashes, check caches
    const uncachedMatches = [];
    const fieldResults = [];
    let totalCrews = 0;

    for (const match of eligibleMatches) {
      const matchHash = computeMatchHash(match);
      const cached = getCachedFieldResult(tournamentId, String(match.id), matchHash);
      if (cached) {
        fieldResults.push({ matchId: match.id, ...cached });
        totalCrews += cached.totalCrews;
        continue;
      }
      uncachedMatches.push(match);
    }

    console.log(`Cache hits: ${fieldResults.length}/${eligibleMatches.length} fields`);

    // fetchMatches returns simplified data without full registration details.
    // We must fetch each match individually to get team member data.
    const detailedMatches = [];
    if (uncachedMatches.length > 0) {
      console.log(`Fetching full registration data for ${uncachedMatches.length} matches...`);
      for (let i = 0; i < uncachedMatches.length; i += 25) {
        const chunk = uncachedMatches.slice(i, i + 25);
        const settled = await Promise.allSettled(
          chunk.map(m => fetchMatch(tournamentId, m.id))
        );
        for (let j = 0; j < settled.length; j++) {
          const result = settled[j];
          if (result.status === 'fulfilled' && result.value) {
            detailedMatches.push(result.value);
          } else {
            console.error(`Failed to fetch match ${chunk[j].id}:`, result.reason?.message || result.reason);
          }
        }
      }
    }

    // Collect ALL unique person IDs across ALL uncached fields
    const allCrews = [];
    const allUniquePersonIds = new Set();
    let needsAnyHistory = false;

    for (const match of detailedMatches) {
      const crews = extractCrews(match);
      if (crews.length === 0) continue;

      const field = classifyField(match.matchCategoryName, match.matchBoatCategoryCode);
      if (field.category === 'development' || field.category === 'eerstejaars') {
        needsAnyHistory = true;
      }
      for (const crew of crews) {
        for (const rower of crew.rowers) {
          allUniquePersonIds.add(rower.personId);
        }
      }
      allCrews.push({ match, crews });
    }

    console.log(`Fetching data for ${allUniquePersonIds.size} unique rowers across ${allCrews.length} uncached fields...`);

    // Single batch fetch for ALL person data across ALL fields
    const [personDataMap, historyMap] = await Promise.all([
      getPersonDataBatch(Array.from(allUniquePersonIds)),
      needsAnyHistory ? getHistoryBatch(Array.from(allUniquePersonIds)) : Promise.resolve(new Map()),
    ]);

    // Run rules per field, cache each result
    for (const { match, crews } of allCrews) {
      const { matchCategoryName, matchBoatCategoryCode, matchGeneratedCode } = match;
      incrementCounter();

      const crewResults = crews.map(crew => {
        const enrichedRowers = crew.rowers.map(r => ({
          ...r,
          personData: personDataMap.get(r.personId) || {},
          raceHistory: historyMap.get(r.personId) || [],
        }));
        return {
          teamName: crew.teamName,
          organisationName: crew.organisationName,
          matchCode: `${matchGeneratedCode || ''} ${matchBoatCategoryCode || ''}`.trim(),
          ...checkCrew(enrichedRowers, matchCategoryName, matchBoatCategoryCode, combinedNieuweling, matchGeneratedCode),
        };
      });

      crewResults.sort((a, b) => {
        if (a.status === 'ILLEGAL' && b.status !== 'ILLEGAL') return -1;
        if (a.status !== 'ILLEGAL' && b.status === 'ILLEGAL') return 1;
        return 0;
      });

      const matchHash = computeMatchHash(match);
      const illegalCount = crewResults.filter(r => r.status === 'ILLEGAL').length;

      const cacheResult = {
        matchFullName: match.matchFullName,
        matchCategoryName,
        matchBoatCategoryCode,
        totalCrews: crewResults.length,
        illegalCrews: illegalCount,
        results: crewResults,
      };

      setCachedFieldResult(tournamentId, String(match.id), matchHash, cacheResult);
      fieldResults.push({ matchId: match.id, ...cacheResult });
      totalCrews += crewResults.length;
    }

    // Sort: illegal fields first, then alphabetical
    fieldResults.sort((a, b) => {
      if (a.illegalCrews > 0 && b.illegalCrews === 0) return -1;
      if (a.illegalCrews === 0 && b.illegalCrews > 0) return 1;
      return (a.matchFullName || '').localeCompare(b.matchFullName || '');
    });

    const elapsed = Date.now() - startTime;
    const totalIllegal = fieldResults.filter(f => f.illegalCrews > 0).length;
    console.log(`Tournament check complete in ${elapsed}ms: ${totalIllegal} illegal fields out of ${fieldResults.length} total, ${totalCrews} crews`);

    res.json({
      tournamentId,
      totalFields: fieldResults.length,
      totalIllegalFields: totalIllegal,
      totalCrews,
      fields: fieldResults,
    });
  } catch (err) {
    console.error('Error checking tournament:', err);
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