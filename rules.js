/**
 * KNRB Regatta Crew Eligibility Rule Engine
 * Based on: Reglement voor Roeiwedstrijden, versie 22 november 2025
 * Articles 11 (Junioren), 12 (Masters), 13 (Senioren)
 */

// ──────────────────────────────────────────────
// Season helpers
// ──────────────────────────────────────────────

/**
 * Determine which season a date falls into.
 * Season runs Sept 1 – Aug 31.
 */
function getSeasonForDate(dateStr) {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-based
  if (month >= 8) {
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
}

function getCurrentSeason() {
  return getSeasonForDate(new Date().toISOString());
}

// ──────────────────────────────────────────────
// Field classification
// ──────────────────────────────────────────────

function classifyField(matchCategoryName, matchBoatCategoryCode) {
  const cat = (matchCategoryName || '').toLowerCase();
  const boat = (matchBoatCategoryCode || '').toLowerCase();

  const isEight = boat.includes('8+');
  const isSculling = boat.includes('x');
  // Fours: 4+, 4-, 4x, 4x+
  const isFourOrQuad = boat.includes('4');

  let category = 'unknown';
  if (cat === 'development') category = 'development';
  else if (cat === 'nieuweling') category = 'nieuweling';
  else if (cat === 'beginner') category = 'beginner';
  else if (cat.includes('gevorderde') || cat.includes('advanced')) category = 'gevorderde';
  else if (cat === 'elite') category = 'elite';
  else if (cat.includes('eerstejaars') || cat.includes('first-year') || cat.includes('eerstejaars')) category = 'eerstejaars';
  // Junior fields: matchCategoryName is often just the name, but the matchGeneratedCode starts with M18/V18/M16 etc.
  // We detect juniors by checking if the name contains '18' or '16' age indicators
  else if (cat.includes('junior') || cat.includes('junioren')) category = 'junior';

  return { category, boatType: boat, isEight, isSculling, isFourOrQuad };
}

// ──────────────────────────────────────────────
// Dev season counting
// ──────────────────────────────────────────────

/**
 * Count distinct seasons in which a rower participated in Development fields.
 * A season ONLY counts if they started in a Dev field at 2 OR MORE distinct regattas.
 * IMPORTANT: We also count the CURRENT regatta they are registering for as +1 
 * tournament for the current season.
 */
function countDevSeasons(raceHistory) {
  const seasonTournaments = new Map();

  for (const tournament of raceHistory) {
    const tournamentDate = tournament.firstTournamentDate;
    if (!tournamentDate) continue;

    let racedDevInTournament = false;
    for (const race of (tournament.raceResults || [])) {
      const matchCode = race.matchCode || '';
      if (matchCode.toLowerCase().includes('dev')) {
        racedDevInTournament = true;
        break;
      }
    }

    if (racedDevInTournament) {
      const season = getSeasonForDate(tournamentDate);
      if (!seasonTournaments.has(season)) {
        seasonTournaments.set(season, new Set());
      }
      seasonTournaments.get(season).add(tournament.id || tournament.name);
    }
  }

  // Add the upcoming regatta as +1 to the current season
  const currentSeason = getCurrentSeason();
  if (!seasonTournaments.has(currentSeason)) {
    seasonTournaments.set(currentSeason, new Set());
  }
  seasonTournaments.get(currentSeason).add(`Upcoming`);

  const validSeasons = [];
  
  // Unconditionally count the current season because they are registering for it now
  validSeasons.push(currentSeason);
  seasonTournaments.delete(currentSeason);

  // For all OTHER past seasons, they only count if they started 2 or more times
  for (const [season, tournamentsSet] of seasonTournaments.entries()) {
    if (tournamentsSet.size >= 2) {
      validSeasons.push(season);
    }
  }

  return {
    count: validSeasons.length,
    seasons: validSeasons.sort(),
  };
}

/**
 * Count distinct seasons in which a rower participated in ANY classifying senior field.
 * Used for eerstejaars/tweedejaars determination.
 * Also adds the current season since the rower is about to race.
 */
function countClassifyingSeasons(raceHistory) {
  const seasons = new Set();
  // Senior classifying categories (matchCodes that indicate senior classifying fields)
  // These include: N (nieuweling), Dev, E (elite), G (gevorderde), B (beginner)
  // Basically anything that is NOT a junior/masters field
  const seniorPrefixes = ['m', 'v', 'lm', 'lv', 'o'];

  for (const tournament of raceHistory) {
    const tournamentDate = tournament.firstTournamentDate;
    if (!tournamentDate) continue;

    for (const race of (tournament.raceResults || [])) {
      const matchCode = race.matchCode || '';
      const codeLower = matchCode.toLowerCase();
      // Skip junior (contains '18', '16') and masters fields
      if (codeLower.includes('18') || codeLower.includes('16') || codeLower.includes('15') || codeLower.includes('14')) continue;
      if (codeLower.includes('masters') || codeLower.includes('mast')) continue;
      // If it's a senior classifying field (has match category indicators)
      // The matchCode structure is like "MN 1x", "MDev 2x", "ME 4-", "MG-B 1x", "MB 2x", "HEj 4+"
      // "H" prefix = old Heren designation, "D" = old Dames, "M" = Mannen, "V" = Vrouwen
      // We count any participation that looks like a senior classifying field
      if (codeLower.match(/^(l?[mvhdo])/)) {
        const season = getSeasonForDate(tournamentDate);
        seasons.add(season);
      }
    }
  }

  // Add current season
  seasons.add(getCurrentSeason());

  return {
    count: seasons.size,
    seasons: Array.from(seasons).sort(),
  };
}

// ──────────────────────────────────────────────
// DEVELOPMENT check (Art. 13, lines 166-168)
// ──────────────────────────────────────────────

/**
 * Dev 4-: collectively ≤ 10 points on Jan 1
 * Dev 2x: collectively ≤ 5 points on Jan 1
 * Each rower: max 2 Dev seasons (current + 1 previous)
 */
function checkDevelopmentCrew(rowers, boatType) {
  const rowerResults = [];

  let pointLimit;
  if (boatType.includes('4') || boatType.includes('8')) {
    pointLimit = 10;
  } else if (boatType.includes('2') || boatType.includes('1')) {
    pointLimit = 5;
  } else {
    pointLimit = 10;
  }

  let totalCrewPoints = 0;

  for (const rower of rowers) {
    const currentSeason = getCurrentSeason();
    let scullingSubtract = 0;
    let sweepingSubtract = 0;

    if (rower.personData?.rowingPoints) {
      for (const pt of rower.personData.rowingPoints) {
        if (getSeasonForDate(pt.date) === currentSeason) {
          if (pt.type === 'Sculling') scullingSubtract += pt.point;
          else if (pt.type === 'Sweeping' || pt.type === 'Sweep') sweepingSubtract += pt.point;
        }
      }
    }

    const sculling = Math.max(0, (rower.personData?.totalScullingPoints || 0) - scullingSubtract);
    const sweeping = Math.max(0, (rower.personData?.totalSweepingPoints || 0) - sweepingSubtract);
    const total = sculling + sweeping;
    totalCrewPoints += total;

    const devSeasons = countDevSeasons(rower.raceHistory || []);
    const rowerViolations = [];

    // Season check: max 2 seasons (current + 1 previous) in Dev
    // Since we always add the current season, > 2 means they already raced Dev in 2+ previous seasons
    if (devSeasons.count > 2) {
      rowerViolations.push(
        `Heeft in ${devSeasons.count} seizoenen in Development gestart (${devSeasons.seasons.join(', ')}). Max toegestaan: 2 (huidig + 1 eerder).`
      );
    }

    rowerResults.push({
      name: rower.fullName,
      personId: rower.personId,
      scullingPoints: sculling,
      sweepingPoints: sweeping,
      totalPoints: total,
      devSeasons: devSeasons.seasons,
      devSeasonCount: devSeasons.count,
      violations: rowerViolations,
    });
  }

  const crewViolations = [];
  if (totalCrewPoints > pointLimit) {
    crewViolations.push(
      `Totaal bemanningspunten (${totalCrewPoints}) overschrijdt limiet van ${pointLimit} voor Dev ${boatType}.`
    );
  }

  for (const r of rowerResults) {
    if (r.violations.length > 0) {
      crewViolations.push(...r.violations.map(v => `${r.name}: ${v}`));
    }
  }

  return {
    rowers: rowerResults,
    crewViolations,
    totalCrewPoints,
    pointLimit,
    status: crewViolations.length > 0 ? 'ILLEGAL' : 'LEGAL',
  };
}

// ──────────────────────────────────────────────
// NIEUWELING check (Art. 13, line 119)
// ──────────────────────────────────────────────

/**
 * Crew average < 2.0 points.
 * combinedNieuweling: true = use scull+sweep combined, false = relevant type only.
 * Also flags any rower with ≥6 pts in either type (elite-level).
 */
function checkNieuwelingCrew(rowers, isSculling, combinedNieuweling) {
  const rowerResults = [];
  let pointSum = 0;

  for (const rower of rowers) {
    const sculling = rower.personData?.totalScullingPoints || 0;
    const sweeping = rower.personData?.totalSweepingPoints || 0;
    const total = sculling + sweeping;

    let relevantPoints;
    if (combinedNieuweling) {
      relevantPoints = total;
    } else {
      relevantPoints = isSculling ? sculling : sweeping;
    }
    pointSum += relevantPoints;

    const rowerViolations = [];

    if (sculling >= 6 || sweeping >= 6) {
      rowerViolations.push(
        `Heeft ${sculling} scull en ${sweeping} sweep punten. Met ≥6 in één type is de roeier Elite/Gevorderde niveau en mag niet starten in Nieuweling.`
      );
    }

    rowerResults.push({
      name: rower.fullName,
      personId: rower.personId,
      scullingPoints: sculling,
      sweepingPoints: sweeping,
      totalPoints: total,
      relevantPoints,
      violations: rowerViolations,
    });
  }

  const average = rowers.length > 0 ? pointSum / rowers.length : 0;
  const crewViolations = [];

  if (average >= 2.0) {
    const mode = combinedNieuweling ? 'gecombineerd (scull + sweep)' : (isSculling ? 'scull' : 'sweep');
    crewViolations.push(
      `Bemanningsgemiddelde ${mode} punten (${average.toFixed(2)}) is ≥ 2.0. Max: < 2.0 voor Nieuweling.`
    );
  }

  for (const r of rowerResults) {
    if (r.violations.length > 0) {
      crewViolations.push(...r.violations.map(v => `${r.name}: ${v}`));
    }
  }

  return {
    rowers: rowerResults,
    crewViolations,
    averagePoints: average,
    status: crewViolations.length > 0 ? 'ILLEGAL' : 'LEGAL',
  };
}

// ──────────────────────────────────────────────
// GEVORDERDE check (Art. 13, lines 113-117)
// ──────────────────────────────────────────────

/**
 * Eights (8+): crew average < 6.0 points (sweep + scull COMBINED)
 * Other boats: crew average < 6.0 points in the RELEVANT rowing type (sweep or scull)
 */
function checkGevorderdeCrew(rowers, isSculling, isEight) {
  const rowerResults = [];
  let pointSum = 0;

  for (const rower of rowers) {
    const sculling = rower.personData?.totalScullingPoints || 0;
    const sweeping = rower.personData?.totalSweepingPoints || 0;
    const total = sculling + sweeping;

    let relevantPoints;
    if (isEight) {
      relevantPoints = total; // 8+: combined
    } else {
      relevantPoints = isSculling ? sculling : sweeping; // relevant type
    }
    pointSum += relevantPoints;

    const rowerViolations = [];

    // Remove individual warning here as requested by user

    rowerResults.push({
      name: rower.fullName,
      personId: rower.personId,
      scullingPoints: sculling,
      sweepingPoints: sweeping,
      totalPoints: total,
      relevantPoints,
      violations: rowerViolations,
    });
  }

  const average = rowers.length > 0 ? pointSum / rowers.length : 0;
  const crewViolations = [];

  if (average >= 6.0) {
    const mode = isEight ? 'gecombineerd (scull + sweep)' : (isSculling ? 'scull' : 'sweep');
    crewViolations.push(
      `Bemanningsgemiddelde ${mode} punten (${average.toFixed(2)}) is ≥ 6.0. Max: < 6.0 voor Gevorderde.`
    );
  }

  for (const r of rowerResults) {
    if (r.violations.length > 0) {
      crewViolations.push(...r.violations.map(v => `${r.name}: ${v}`));
    }
  }

  return {
    rowers: rowerResults,
    crewViolations,
    averagePoints: average,
    pointLimit: 6.0,
    status: crewViolations.length > 0 ? 'ILLEGAL' : 'LEGAL',
  };
}

// ──────────────────────────────────────────────
// BEGINNER check (Art. 13, line 121)
// ──────────────────────────────────────────────

/**
 * Beginner: Each rower must have 0 points in the relevant rowing type
 * AND < 6 points in the other type.
 */
function checkBeginnerCrew(rowers, isSculling) {
  const rowerResults = [];

  for (const rower of rowers) {
    const sculling = rower.personData?.totalScullingPoints || 0;
    const sweeping = rower.personData?.totalSweepingPoints || 0;
    const total = sculling + sweeping;

    const relevantPoints = isSculling ? sculling : sweeping;
    const otherPoints = isSculling ? sweeping : sculling;
    const relevantType = isSculling ? 'scull' : 'sweep';
    const otherType = isSculling ? 'sweep' : 'scull';

    const rowerViolations = [];

    if (relevantPoints > 0) {
      rowerViolations.push(
        `Heeft ${relevantPoints} ${relevantType} punten. Beginner vereist 0 punten in het relevante riemtype.`
      );
    }

    if (otherPoints >= 6) {
      rowerViolations.push(
        `Heeft ${otherPoints} ${otherType} punten. Beginner vereist < 6 punten in het andere riemtype.`
      );
    }

    rowerResults.push({
      name: rower.fullName,
      personId: rower.personId,
      scullingPoints: sculling,
      sweepingPoints: sweeping,
      totalPoints: total,
      relevantPoints,
      otherPoints,
      violations: rowerViolations,
    });
  }

  const crewViolations = [];
  for (const r of rowerResults) {
    if (r.violations.length > 0) {
      crewViolations.push(...r.violations.map(v => `${r.name}: ${v}`));
    }
  }

  return {
    rowers: rowerResults,
    crewViolations,
    status: crewViolations.length > 0 ? 'ILLEGAL' : 'LEGAL',
  };
}

// ──────────────────────────────────────────────
// EERSTEJAARS check (Art. 13, lines 155-164)
// ──────────────────────────────────────────────

/**
 * First-year senior fields:
 * - Rower must be in their first season in a classifying senior field after junior age
 * - Must have had 0 total points at start of season
 *
 * Crew composition (8+): only eerstejaars + max 2 non-eerstejaars with 0 pts on Sept 1
 * Crew composition (4+/4x): only eerstejaars + max 1 non-eerstejaars with 0 pts on Sept 1
 *
 * We approximate: a rower is eerstejaars if they have only 1 classifying senior season
 * (the current one). If they have ≥ 2, they are NOT eerstejaars.
 * We also flag any rower with > 0 total points as potentially not qualifying.
 */
function checkEerstejaarsCrewUnavailable(rowers, boatType, isEight, isFourOrQuad) {
  const rowerResults = [];
  let nonEerstejaarsCount = 0;

  // Max non-eerstejaars allowed
  let maxNonEerstejaars;
  if (isEight) {
    maxNonEerstejaars = 2;
  } else if (isFourOrQuad) {
    maxNonEerstejaars = 1;
  } else {
    maxNonEerstejaars = 0; // smaller boats: only eerstejaars
  }

  for (const rower of rowers) {
    const sculling = rower.personData?.totalScullingPoints || 0;
    const sweeping = rower.personData?.totalSweepingPoints || 0;
    const total = sculling + sweeping;

    const classifyingSeasons = countClassifyingSeasons(rower.raceHistory || []);
    const isEerstejaars = classifyingSeasons.count <= 1;

    const rowerViolations = [];

    if (!isEerstejaars) {
      nonEerstejaarsCount++;
      // Non-eerstejaars is only allowed if they had 0 points on Sept 1
      if (total > 0) {
        rowerViolations.push(
          `Niet eerstejaars (${classifyingSeasons.count} seizoenen: ${classifyingSeasons.seasons.join(', ')}) en heeft ${total} punten. Niet-eerstejaars mogen alleen meedoen met 0 punten op 1 sept.`
        );
      }
    }

    rowerResults.push({
      name: rower.fullName,
      personId: rower.personId,
      scullingPoints: sculling,
      sweepingPoints: sweeping,
      totalPoints: total,
      classifyingSeasons: classifyingSeasons.seasons,
      classifyingSeasonCount: classifyingSeasons.count,
      isEerstejaars,
      violations: rowerViolations,
    });
  }

  const crewViolations = [];

  if (nonEerstejaarsCount > maxNonEerstejaars) {
    crewViolations.push(
      `Te veel niet-eerstejaars roeiers: ${nonEerstejaarsCount} (max ${maxNonEerstejaars} toegestaan voor ${boatType}).`
    );
  }

  for (const r of rowerResults) {
    if (r.violations.length > 0) {
      crewViolations.push(...r.violations.map(v => `${r.name}: ${v}`));
    }
  }

  return {
    rowers: rowerResults,
    crewViolations,
    nonEerstejaarsCount,
    maxNonEerstejaars,
    status: crewViolations.length > 0 ? 'ILLEGAL' : 'LEGAL',
  };
}

// ──────────────────────────────────────────────
// JUNIOR age check (Art. 11, lines 37-54)
// ──────────────────────────────────────────────

/**
 * Junior-18: rower must be a Junior (age check via yearOfBirth).
 * Junior-16: rower must not have reached age 16 on Jan 1 of current year.
 *
 * We detect the age limit from the matchGeneratedCode (e.g. M18, V16).
 * yearOfBirth is available from the person API.
 */
function checkJuniorCrew(rowers, matchGeneratedCode) {
  const rowerResults = [];
  const currentYear = new Date().getFullYear();

  // Detect age limit from code
  let ageLimit = 18; // default
  if (matchGeneratedCode && matchGeneratedCode.includes('16')) {
    ageLimit = 16;
  } else if (matchGeneratedCode && matchGeneratedCode.includes('15')) {
    ageLimit = 15;
  } else if (matchGeneratedCode && matchGeneratedCode.includes('14')) {
    ageLimit = 14;
  }

  for (const rower of rowers) {
    const sculling = rower.personData?.totalScullingPoints || 0;
    const sweeping = rower.personData?.totalSweepingPoints || 0;
    const total = sculling + sweeping;
    const yearOfBirth = rower.personData?.yearOfBirth || 0;

    const rowerViolations = [];

    if (yearOfBirth > 0) {
      const ageOnJan1 = currentYear - yearOfBirth;
      if (ageOnJan1 > ageLimit) {
        rowerViolations.push(
          `Leeftijd op 1 jan ${currentYear}: ${ageOnJan1} jaar. Max voor Junioren-${ageLimit}: ${ageLimit} jaar.`
        );
      }
    }

    rowerResults.push({
      name: rower.fullName,
      personId: rower.personId,
      scullingPoints: sculling,
      sweepingPoints: sweeping,
      totalPoints: total,
      yearOfBirth,
      violations: rowerViolations,
    });
  }

  const crewViolations = [];
  for (const r of rowerResults) {
    if (r.violations.length > 0) {
      crewViolations.push(...r.violations.map(v => `${r.name}: ${v}`));
    }
  }

  return {
    rowers: rowerResults,
    crewViolations,
    ageLimit,
    status: crewViolations.length > 0 ? 'ILLEGAL' : 'LEGAL',
  };
}

// ──────────────────────────────────────────────
// ELITE check (Art. 13, line 111)
// ──────────────────────────────────────────────

/**
 * Elite: anyone may start, no point restrictions.
 * We still show rower info for reference.
 */
function checkEliteCrew(rowers) {
  const rowerResults = rowers.map(rower => {
    const sculling = rower.personData?.totalScullingPoints || 0;
    const sweeping = rower.personData?.totalSweepingPoints || 0;
    return {
      name: rower.fullName,
      personId: rower.personId,
      scullingPoints: sculling,
      sweepingPoints: sweeping,
      totalPoints: sculling + sweeping,
      violations: [],
    };
  });

  return {
    rowers: rowerResults,
    crewViolations: [],
    status: 'LEGAL',
    note: 'Elite: geen beperkingen op startpunten.',
  };
}

// ──────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────

function checkCrew(rowers, matchCategoryName, matchBoatCategoryCode, combinedNieuweling, matchGeneratedCode) {
  const field = classifyField(matchCategoryName, matchBoatCategoryCode);

  switch (field.category) {
    case 'development':
      return {
        fieldType: 'Development',
        ...checkDevelopmentCrew(rowers, field.boatType),
      };

    case 'nieuweling':
      return {
        fieldType: 'Nieuweling',
        ...checkNieuwelingCrew(rowers, field.isSculling, combinedNieuweling),
      };

    case 'gevorderde':
      return {
        fieldType: 'Gevorderde',
        ...checkGevorderdeCrew(rowers, field.isSculling, field.isEight),
      };

    case 'beginner':
      return {
        fieldType: 'Beginner',
        ...checkBeginnerCrew(rowers, field.isSculling),
      };

    case 'eerstejaars':
      return {
        fieldType: 'Eerstejaars',
        ...checkEerstejaarsCrewUnavailable(rowers, field.boatType, field.isEight, field.isFourOrQuad),
      };

    case 'elite':
      return {
        fieldType: 'Elite',
        ...checkEliteCrew(rowers),
      };

    case 'junior':
      return {
        fieldType: 'Junior',
        ...checkJuniorCrew(rowers, matchGeneratedCode),
      };

    default:
      // For unknown categories (Masters, Open, etc.) still show rower data
      return {
        fieldType: matchCategoryName || field.category,
        ...checkEliteCrew(rowers), // show data, no restrictions
        note: `Veldtype "${matchCategoryName || field.category}" wordt getoond zonder puntencontrole.`,
      };
  }
}

module.exports = {
  checkCrew,
  checkDevelopmentCrew,
  checkNieuwelingCrew,
  checkGevorderdeCrew,
  checkBeginnerCrew,
  checkEerstejaarsCrewUnavailable,
  checkJuniorCrew,
  checkEliteCrew,
  classifyField,
  countDevSeasons,
  countClassifyingSeasons,
  getSeasonForDate,
  getCurrentSeason,
};
