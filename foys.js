const FOYS_BASE = 'https://api.foys.io/tournament/public/api/v1';
const FEDERATION_ID = '348625af-0eff-47b7-80d6-dfa6b5a8ad19';
const SEASON_ID = 27;

const inflightRequests = new Map();

async function foysGet(url) {
  if (inflightRequests.has(url)) {
    return inflightRequests.get(url);
  }

  const promise = (async () => {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`FOYS API error: ${res.status} ${res.statusText} for ${url}`);
    }
    return res.json();
  })();

  inflightRequests.set(url, promise);
  try {
    return await promise;
  } finally {
    inflightRequests.delete(url);
  }
}

async function fetchPerson(personId) {
  const data = await foysGet(`${FOYS_BASE}/persons/${personId}?id=${personId}`);
  return { personId, data, fetchedAt: Date.now() };
}

async function fetchHistory(personId) {
  const data = await foysGet(`${FOYS_BASE}/races/person-overview-results/${personId}`);
  return { personId, data, fetchedAt: Date.now() };
}

async function fetchMatch(tournamentId, matchId) {
  const url = `${FOYS_BASE}/matches?tournamentId=${tournamentId}&matchRegistrations=true&matchIds[]=${matchId}`;
  const data = await foysGet(url);
  if (!data || data.length === 0) return null;
  return data[0];
}

async function fetchMatches(tournamentId) {
  return foysGet(`${FOYS_BASE}/matches?tournamentId=${tournamentId}&matchRegistrations=true&orderByMatchBoatCategoryCodes=true`);
}

async function fetchTournaments() {
  const url = `${FOYS_BASE}/tournaments?federationId=${FEDERATION_ID}&seasonId=${SEASON_ID}&searchString=&pageSize=1000&registrationsFilter=false&resultsFilter=false`;
  return foysGet(url);
}

function extractCrews(match) {
  const crews = [];
  for (const registration of match.registrations || []) {
    for (const team of registration.teams || []) {
      const activeVersion = (team.teamVersions || []).find(v => v.isActive);
      if (!activeVersion) continue;

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
  return crews;
}

function extractUniquePersonIds(crews) {
  const ids = new Set();
  for (const crew of crews) {
    for (const rower of crew.rowers) {
      ids.add(rower.personId);
    }
  }
  return Array.from(ids);
}

function computeMatchHash(match) {
  const crypto = require('crypto');
  const regData = (match.registrations || []).map(r => ({
    id: r.id,
    teamCount: (r.teams || []).length,
    teamMemberIds: (r.teams || []).flatMap(t =>
      ((t.teamVersions || []).find(v => v.isActive)?.teamMembers || [])?.map(m => m.personId) || []
    ),
  }));
  const hash = crypto.createHash('sha256').update(JSON.stringify(regData)).digest('hex').slice(0, 16);
  return hash;
}

module.exports = {
  foysGet,
  fetchPerson,
  fetchHistory,
  fetchMatch,
  fetchMatches,
  fetchTournaments,
  extractCrews,
  extractUniquePersonIds,
  computeMatchHash,
  FOYS_BASE,
  FEDERATION_ID,
  SEASON_ID,
};