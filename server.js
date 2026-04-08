const express = require('express');
const path = require('path');
const { checkCrew, classifyField } = require('./rules');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const FOYS_BASE = 'https://api.foys.io/tournament/public/api/v1';

// In-memory cache for person data (avoids re-fetching within same session)
const personCache = new Map();
const historyCache = new Map();

/**
 * Fetch JSON from FOYS API
 */
async function foysGet(url) {
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`FOYS API error: ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

let cachedTournaments = null;
let lastTournamentsFetch = 0;

/**
 * GET /api/tournaments - list all tournaments for the current season
 */
app.get('/api/tournaments', async (req, res) => {
  try {
    // Return cached tournaments if fetched within the last hour
    if (cachedTournaments && (Date.now() - lastTournamentsFetch < 3600000)) {
      return res.json({ tournaments: cachedTournaments });
    }

    const FEDERATION_ID = '348625af-0eff-47b7-80d6-dfa6b5a8ad19';
    const SEASON_ID = 27; // 2025-2026 season

    const url = `${FOYS_BASE}/tournaments?federationId=${FEDERATION_ID}&seasonId=${SEASON_ID}&searchString=&pageSize=1000&registrationsFilter=false&resultsFilter=false`;
    const data = await foysGet(url);

    // Get ALL tournaments (don't filter by hasRegistrations because that hides future regattas)
    // Only filter out strictly cancelled tournaments just in case
    const baseTournaments = (data.items || []).filter(t => t.status !== 'Cancelled');

    const validTournaments = [];
    
    // Batch fetch matches for each tournament to see if it has Classifying fields
    for (let i = 0; i < baseTournaments.length; i += 10) {
      const chunk = baseTournaments.slice(i, i + 10);
      await Promise.all(chunk.map(async (t) => {
        try {
          const matchUrl = `${FOYS_BASE}/matches?tournamentId=${t.id}`;
          const matchData = await foysGet(matchUrl);
          
          // Check if any match is classifying/standard KNRB field
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

    // Cache the results
    cachedTournaments = tournaments;
    lastTournamentsFetch = Date.now();

    res.json({ tournaments });
  } catch (err) {
    console.error('Error fetching tournaments:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/matches - list all matches for a tournament
 */
app.get('/api/matches', async (req, res) => {
  try {
    const { tournamentId } = req.query;
    if (!tournamentId) {
      return res.status(400).json({ error: 'Missing tournamentId' });
    }

    const url = `${FOYS_BASE}/matches?tournamentId=${tournamentId}&matchRegistrations=true&orderByMatchBoatCategoryCodes=true`;
    const data = await foysGet(url);

    // Return simplified match list for the dropdown
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

/**
 * POST /api/check-field - check all crews in a field
 * Body: { tournamentId, matchId, combinedNieuweling }
 */
app.post('/api/check-field', async (req, res) => {
  try {
    const { tournamentId, matchId, combinedNieuweling = true } = req.body;
    if (!tournamentId || !matchId) {
      return res.status(400).json({ error: 'Missing tournamentId or matchId' });
    }

    console.log(`Checking field: tournament=${tournamentId}, match=${matchId}`);

    // 1. Fetch detailed match data with team members
    const matchUrl = `${FOYS_BASE}/matches?tournamentId=${tournamentId}&matchRegistrations=true&matchIds[]=${matchId}`;
    const matchData = await foysGet(matchUrl);

    if (!matchData || matchData.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const match = matchData[0];
    const { matchCategoryName, matchBoatCategoryCode } = match;

    console.log(`Match: ${match.matchFullName} (${matchCategoryName} / ${matchBoatCategoryCode})`);

    // 2. Extract all crews (teams) from registrations
    const crews = [];
    for (const registration of (match.registrations || [])) {
      for (const team of (registration.teams || [])) {
        // Find the active team version
        const activeVersion = (team.teamVersions || []).find(v => v.isActive);
        if (!activeVersion) continue;

        // Extract rowers (not coaches, not cox)
        const rowers = (activeVersion.teamMembers || []).filter(
          m => !m.isCoach && !m.isCox
        );

        if (rowers.length === 0) continue;

        crews.push({
          teamName: team.teamFullName || team.name,
          organisationName: team.organisationName || team.name,
          rowers: rowers.map(r => ({
            fullName: r.fullName,
            personId: r.personId,
            boatPosition: r.boatPosition,
            clubName: r.clubName,
          })),
        });
      }
    }

    console.log(`Found ${crews.length} crews to check`);

    // 3. Fetch person data for all unique rowers
    const uniquePersonIds = new Set();
    for (const crew of crews) {
      for (const rower of crew.rowers) {
        uniquePersonIds.add(rower.personId);
      }
    }

    console.log(`Fetching data for ${uniquePersonIds.size} unique rowers...`);

    // Batch fetch in chunks of 10
    const personIds = Array.from(uniquePersonIds);
    for (let i = 0; i < personIds.length; i += 10) {
      const chunk = personIds.slice(i, i + 10);
      await Promise.all(chunk.map(async (pid) => {
        // Fetch person points
        if (!personCache.has(pid)) {
          try {
            const personData = await foysGet(`${FOYS_BASE}/persons/${pid}?id=${pid}`);
            personCache.set(pid, personData);
          } catch (e) {
            console.error(`Failed to fetch person ${pid}:`, e.message);
            personCache.set(pid, { totalScullingPoints: 0, totalSweepingPoints: 0, rowingPoints: [] });
          }
        }

        // Fetch race history
        if (!historyCache.has(pid)) {
          try {
            const history = await foysGet(`${FOYS_BASE}/races/person-overview-results/${pid}`);
            historyCache.set(pid, history);
          } catch (e) {
            console.error(`Failed to fetch history for ${pid}:`, e.message);
            historyCache.set(pid, []);
          }
        }
      }));
    }

    console.log('All person data fetched. Running rule checks...');

    // 4. Check each crew
    const results = [];
    for (const crew of crews) {
      // Enrich rowers with fetched data
      const enrichedRowers = crew.rowers.map(r => ({
        ...r,
        personData: personCache.get(r.personId) || {},
        raceHistory: historyCache.get(r.personId) || [],
      }));

      const result = checkCrew(enrichedRowers, matchCategoryName, matchBoatCategoryCode, combinedNieuweling, match.matchGeneratedCode);

      results.push({
        teamName: crew.teamName,
        organisationName: crew.organisationName,
        matchCode: `${match.matchGeneratedCode || ''} ${matchBoatCategoryCode || ''}`.trim(),
        ...result,
      });
    }

    // Sort: ILLEGAL first, then LEGAL
    results.sort((a, b) => {
      if (a.status === 'ILLEGAL' && b.status !== 'ILLEGAL') return -1;
      if (a.status !== 'ILLEGAL' && b.status === 'ILLEGAL') return 1;
      return 0;
    });

    const illegalCount = results.filter(r => r.status === 'ILLEGAL').length;
    console.log(`Check complete: ${illegalCount} illegal crews out of ${results.length} total`);

    res.json({
      matchFullName: match.matchFullName,
      matchCategoryName,
      matchBoatCategoryCode,
      totalCrews: results.length,
      illegalCrews: illegalCount,
      results,
    });
  } catch (err) {
    console.error('Error checking field:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/clear-cache - clear person data cache
 */
app.post('/api/clear-cache', (req, res) => {
  personCache.clear();
  historyCache.clear();
  console.log('Cache cleared');
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`KNRB Regatta Checker running at http://localhost:${PORT}`);
});
