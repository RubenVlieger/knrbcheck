/**
 * KNRB Regatta Crew Eligibility Rule Engine
 * Based on: Reglement voor Roeiwedstrijden, versie 22 november 2025
 * Articles 11 (Junioren), 12 (Masters), 13 (Senioren), 14 (Competitie)
 */

// ──────────────────────────────────────────────
// Season helpers
// ──────────────────────────────────────────────

function getSeasonForDate(dateStr) {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth();
  if (month >= 8) {
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
}

function getCurrentSeason() {
  return getSeasonForDate(new Date().toISOString());
}

/**
 * Calculate points at the start of the current season (Sept 1).
 * Subtract points earned during the current season from current totals.
 */
function getPointsAtSeasonStart(personData) {
  const currentSeason = getCurrentSeason();
  let scullingSubtract = 0;
  let sweepingSubtract = 0;

  if (personData?.rowingPoints) {
    for (const pt of personData.rowingPoints) {
      if (getSeasonForDate(pt.date) === currentSeason) {
        if (pt.type === 'Sculling') scullingSubtract += pt.point;
        else if (pt.type === 'Sweeping' || pt.type === 'Sweep') sweepingSubtract += pt.point;
      }
    }
  }

  const sculling = Math.max(0, (personData?.totalScullingPoints || 0) - scullingSubtract);
  const sweeping = Math.max(0, (personData?.totalSweepingPoints || 0) - sweepingSubtract);

  return {
    sculling,
    sweeping,
    total: sculling + sweeping,
  };
}

// ──────────────────────────────────────────────
// Field classification
// ──────────────────────────────────────────────

function classifyField(matchCategoryName, matchBoatCategoryCode) {
  const cat = (matchCategoryName || '').toLowerCase();
  const boat = (matchBoatCategoryCode || '').toLowerCase();

  const isEight = boat.includes('8+');
  const isSculling = boat.includes('x');
  const isFourOrQuad = boat.includes('4');

  let category = 'unknown';
  if (cat === 'development') category = 'development';
  else if (cat === 'nieuweling') category = 'nieuweling';
  else if (cat === 'beginner') category = 'beginner';
  else if (cat === 'senioren b') category = 'sb';
  else if (cat.includes('gevorderde') || cat.includes('advanced')) category = 'gevorderde';
  else if (cat === 'elite') category = 'elite';
  else if (cat.includes('eerstejaars') || cat.includes('first-year')) category = 'eerstejaars';
  else if (cat.includes('junior') || cat.includes('junioren') || cat === 'achttien' || cat === 'zestien') category = 'junior';

  return { category, boatType: boat, isEight, isSculling, isFourOrQuad };
}

// ──────────────────────────────────────────────
// Is a race classifying? (Art. 13, 14)
// ──────────────────────────────────────────────

/**
 * Determine if a race is in a classifying senior field (Art. 13).
 * Excludes: junior (Art. 11), masters (Art. 12), competitie (Art. 14).
 *
 * Classifying senior fields: Elite, Gevorderde, Nieuweling, Beginner, Eerstejaars, Development.
 * Non-classifying: Competitie (Ervaren, Onervaren, Club, Lente, Talenten).
 */
function isClassifyingSeniorRace(race) {
  const codeLower = (race.matchCode || '').toLowerCase();
  const catLower = (race.matchCategoryName || '').toLowerCase();

  // Exclude junior fields (age-coded: 18, 16, 15, 14)
  if (codeLower.includes('18') || codeLower.includes('16') || codeLower.includes('15') || codeLower.includes('14')) return false;

  // Exclude masters
  if (codeLower.includes('masters') || codeLower.includes('mast')) return false;

  // Exclude mixed gender fields (Art. 10: Mix — not a classifying category)
  if (codeLower.includes('mix')) return false;

  // Exclude competitie (Art. 14) by category name
  // Ervaren, Onervaren, Club, Lente, Talenten, Overnaeds are all competitie-level, NOT classifying
  if (catLower.includes('competitie') || catLower.includes('ervaren') ||
      catLower.includes('onervaren') || catLower.includes('club') ||
      catLower.includes('lente') || catLower.includes('talent') ||
      catLower.includes('overnaeds') || catLower.includes('overnaed') ||
      catLower.includes('varsity')) return false;

  // Exclude competitie by matchCode patterns.
  // These MUST be checked before the whitelist because their codes
  // superficially match the classifying pattern (e.g. "VErv" has V+E).
  //
  // Competitie patterns in the code:
  //   "MErv" = Ervaren,   "VErv" = Vrouwen Ervaren,    "HErv" = Heren Ervaren
  //   "VOnerv" = Onervaren, "MOnerv" = Onervaren
  //   "MClub" = Club,      "VLente" = Lente,             "MTalent" = Talenten
  //   "MOv" = Overnaeds,   "VOv" = Vrouwen Overnaeds,   "HOv" = Heren Overnaeds
  //   "H4+" = Heren competitie, "V4+" = Vrouwen,  "D4+" = Dames
  //   "Mix 8+" = Mixed

  if (codeLower.includes('onerv') || codeLower.includes('club') ||
      codeLower.includes('lente') || codeLower.includes('talent') ||
      codeLower.includes('tal') || codeLower.includes('ov')) return false;
  // "erv" catches Ervaren (MErv, VEnv, HErv) but NOT Gevorderde (has "gev")
  if (codeLower.includes('erv') && !codeLower.includes('gev')) return false;
  // Also exclude if matchCategoryName says competitie-level
  if (catLower.includes('erv') && !catLower.includes('gevorderde') && !catLower.includes('gev')) return false;

// Include: gender prefix + KNOWN class indicator
  // FOYS classifying codes ALWAYS have: E=Elite, G=Gevorderde, N=Nieuweling,
  // B=Beginner, Dev=Development, Ej=Eerstejaars, SB=Senioren B (Beginner)
  // The class indicator must be followed by a non-letter boundary to distinguish
  // "ME 4-" (Elite) from "MErv 1x" (Ervaren).
  const classifyingPattern = /^l?[mvhdo]\s*(e|g(?!ev)|g-|n(?!erv)|b(?!ov)|dev|ej|sb)/i;
  if (classifyingPattern.test(codeLower)) return true;

  // Also check category name for known classifying categories
  if (catLower === 'elite' || catLower === 'gevorderde' || catLower === 'advanced' ||
      catLower === 'nieuweling' || catLower === 'beginner' || catLower === 'senioren b' ||
      catLower === 'development' || catLower === 'eerstejaars' ||
      catLower.includes('first-year')) return true;

  return false;
}

// ──────────────────────────────────────────────
// Dev season counting
// ──────────────────────────────────────────────

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
      seasonTournaments.get(season).add(tournament.tournamentName);
    }
  }

  const currentSeason = getCurrentSeason();
  if (!seasonTournaments.has(currentSeason)) {
    seasonTournaments.set(currentSeason, new Set());
  }
  seasonTournaments.get(currentSeason).add('Upcoming');

  const validSeasons = [];
  validSeasons.push(currentSeason);
  seasonTournaments.delete(currentSeason);

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
 * Determine whether a rower was still junior age in a given season.
 * A rower is junior if they haven't reached age 19 on Jan 1 of the
 * second year of the season. Season "2024-2025" → Jan 1, 2025.
 * Junior if born in year >= (secondYear - 18), i.e. born 2007+ for
 * season 2024-2025.
 */
function wasJuniorInSeason(season, yearOfBirth) {
  if (!yearOfBirth || yearOfBirth <= 0) return false;
  const parts = season.split('-');
  const secondYear = parseInt(parts[1], 10);
  return yearOfBirth >= (secondYear - 18);
}

/**
 * Count distinct seasons in which a rower participated in a CLASSIFYING SENIOR
 * field AFTER junior age. Used for eerstejaars determination (Art. 13.4a).
 *
 * Seasons where the rower was still junior age are EXCLUDED, because the
 * reglement says "het eerste roeiseizoen dat hij NIET MEER IN DE LEEFTIJD
 * VAN JUNIOR start in een klasserend veld". Junior participation in classifying
 * fields doesn't count toward the eerstejaars limit.
 *
 * Returns { count, seasons } where count includes the current season.
 */
function countClassifyingSeniorSeasons(raceHistory, yearOfBirth) {
  const seasons = new Set();

  for (const tournament of raceHistory) {
    const tournamentDate = tournament.firstTournamentDate;
    if (!tournamentDate) continue;

    let hasClassifyingRace = false;
    for (const race of (tournament.raceResults || [])) {
      if (isClassifyingSeniorRace(race)) {
        hasClassifyingRace = true;
        break;
      }
    }

    if (hasClassifyingRace) {
      const season = getSeasonForDate(tournamentDate);
      // Skip seasons where the rower was still junior age
      if (wasJuniorInSeason(season, yearOfBirth)) continue;
      seasons.add(season);
    }
  }

  // Add current season (they are about to start in this classifying field)
  // Current season is always post-junior (they're registering for a senior field)
  seasons.add(getCurrentSeason());

  return {
    count: seasons.size,
    seasons: Array.from(seasons).sort(),
  };
}

// ──────────────────────────────────────────────
// DEVELOPMENT check (Art. 13.4e,f)
// ──────────────────────────────────────────────

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
    const pointsAtStart = getPointsAtSeasonStart(rower.personData);
    totalCrewPoints += pointsAtStart.total;

    const devSeasons = countDevSeasons(rower.raceHistory || []);
    const rowerViolations = [];

    if (devSeasons.count > 2) {
      rowerViolations.push(
        `Heeft in ${devSeasons.count} seizoenen in Development gestart (${devSeasons.seasons.join(', ')}). Max toegestaan: 2 (huidig + 1 eerder).`
      );
    }

    rowerResults.push({
      name: rower.fullName,
      personId: rower.personId,
      scullingPoints: pointsAtStart.sculling,
      sweepingPoints: pointsAtStart.sweeping,
      totalPoints: pointsAtStart.total,
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
// NIEUWELING check (Art. 13.2d)
// ──────────────────────────────────────────────

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
// GEVORDERDE check (Art. 13.2b,c)
// ──────────────────────────────────────────────

function checkGevorderdeCrew(rowers, isSculling, isEight) {
  const rowerResults = [];
  let pointSum = 0;

  for (const rower of rowers) {
    const sculling = rower.personData?.totalScullingPoints || 0;
    const sweeping = rower.personData?.totalSweepingPoints || 0;
    const total = sculling + sweeping;

    let relevantPoints;
    if (isEight) {
      relevantPoints = total;
    } else {
      relevantPoints = isSculling ? sculling : sweeping;
    }
    pointSum += relevantPoints;

    const rowerViolations = [];

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
// BEGINNER check (Art. 13.2e)
// ──────────────────────────────────────────────

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
// SENIOREN B check (age ≤ 22 on Jan 1, open field)
// ──────────────────────────────────────────────

/**
 * Senioren B (SB) is an age-restricted open field.
 * All rowers must be ≤ 22 years old on Jan 1 of the current calendar year.
 * No point restrictions (it's an open field, not point-limited).
 * IS a classifying field (counts for eerstejaars determination).
 */
function checkSBCrew(rowers) {
  const rowerResults = [];
  const currentYear = new Date().getFullYear();

  for (const rower of rowers) {
    const sculling = rower.personData?.totalScullingPoints || 0;
    const sweeping = rower.personData?.totalSweepingPoints || 0;
    const yearOfBirth = rower.personData?.yearOfBirth || 0;

    const rowerViolations = [];

    if (yearOfBirth > 0) {
      const ageOnJan1 = currentYear - yearOfBirth;
      if (ageOnJan1 > 22) {
        rowerViolations.push(
          `Leeftijd op 1 jan ${currentYear}: ${ageOnJan1} jaar. Max voor Senioren B: 22 jaar.`
        );
      }
    }

    rowerResults.push({
      name: rower.fullName,
      personId: rower.personId,
      scullingPoints: sculling,
      sweepingPoints: sweeping,
      totalPoints: sculling + sweeping,
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
    ageLimit: 22,
    status: crewViolations.length > 0 ? 'ILLEGAL' : 'LEGAL',
  };
}

/**
 * Eerstejaars (First-year senior) check per Art. 13.4:
 *
 * Art. 13.4a: A rower is eerstejaars in the first season they start in a classifying
 * senior field after junior age, provided they had 0 total points (boord + scull) at
 * the start of the season (Sept 1).
 *
 * Junior exception (Art. 13.4a sentence 2): Juniors who already started in a classifying
 * field AND had 0 points at the start of the season are also allowed to start as eerstejaars.
 *
 * Art. 13.4c (8+): Only eerstejaars rowers + max 2 non-eerstejaars with 0 pts on Sept 1.
 * Art. 13.4d (4+/4x): Only eerstejaars rowers + max 1 non-eerstejaars with 0 pts on Sept 1.
 * Art. 13.4f (smaller boats): Only eerstejaars rowers.
 */
function checkEerstejaarsCrew(rowers, boatType, isEight, isFourOrQuad) {
  const rowerResults = [];
  let nonEerstejaarsCount = 0;

  let maxNonEerstejaars;
  if (isEight) {
    maxNonEerstejaars = 2;
  } else if (isFourOrQuad) {
    maxNonEerstejaars = 1;
  } else {
    maxNonEerstejaars = 0;
  }

  const currentYear = new Date().getFullYear();

  for (const rower of rowers) {
    const pointsAtStart = getPointsAtSeasonStart(rower.personData);
    const sculling = rower.personData?.totalScullingPoints || 0;
    const sweeping = rower.personData?.totalSweepingPoints || 0;
    const totalCurrent = sculling + sweeping;

    const classifyingInfo = countClassifyingSeniorSeasons(rower.raceHistory || [], rower.personData?.yearOfBirth);
    const yearOfBirth = rower.personData?.yearOfBirth || 0;

    // Junior age check: born in year >= (currentYear - 18) means still junior age
    // Junior-18: age on Jan 1 <= 18, so born >= currentYear - 18
    const isStillJuniorAge = yearOfBirth > 0 && (currentYear - yearOfBirth) <= 18;

    // Art. 13.4a: Eerstejaars determination
    // Must have 0 total points at start of season (boord + scull combined)
    const hadZeroPointsAtStart = pointsAtStart.total === 0;

    let isEerstejaars = false;
    let eerstejaarsReason = '';

    if (hadZeroPointsAtStart && classifyingInfo.count <= 1) {
      // First season in a classifying senior field, 0 points at start → eerstejaars
      isEerstejaars = true;
      eerstejaarsReason = 'Eerste seizoen in klasserend veld, 0 punten op 1 sept';
    } else if (hadZeroPointsAtStart && isStillJuniorAge) {
      // Junior exception (Art. 13.4a sentence 2):
      // Juniors who already started in classifying fields but had 0 points at season start
      isEerstejaars = true;
      eerstejaarsReason = 'Juniorexeptie: 0 punten op 1 sept, nog junioreleeftijd';
    }

    const rowerViolations = [];

    if (!isEerstejaars) {
      nonEerstejaarsCount++;
      // Non-eerstejaars can only join if they had 0 points on Sept 1
      if (!hadZeroPointsAtStart) {
        rowerViolations.push(
          `Niet eerstejaars (${classifyingInfo.count} klasserende seizoenen, ${pointsAtStart.total} punten op 1 sept). Niet-eerstejaars mogen alleen meedoen met 0 punten op 1 sept.`
        );
      }
    }

    rowerResults.push({
      name: rower.fullName,
      personId: rower.personId,
      scullingPoints: sculling,
      sweepingPoints: sweeping,
      totalPoints: totalCurrent,
      pointsAtSeasonStart: pointsAtStart.total,
      classifyingSeasons: classifyingInfo.seasons,
      classifyingSeasonCount: classifyingInfo.count,
      yearOfBirth,
      isEerstejaars,
      eerstejaarsReason,
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
// JUNIOR age check (Art. 11)
// ──────────────────────────────────────────────

function checkJuniorCrew(rowers, matchGeneratedCode) {
  const rowerResults = [];
  const currentYear = new Date().getFullYear();

  let ageLimit = 18;
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
// ELITE check (Art. 13.2a)
// ──────────────────────────────────────────────

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

    case 'sb':
      return {
        fieldType: 'Senioren B',
        ...checkSBCrew(rowers),
      };

    case 'eerstejaars':
      return {
        fieldType: 'Eerstejaars',
        ...checkEerstejaarsCrew(rowers, field.boatType, field.isEight, field.isFourOrQuad),
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
      return {
        fieldType: matchCategoryName || field.category,
        ...checkEliteCrew(rowers),
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
  checkEerstejaarsCrew,
  checkSBCrew,
  checkJuniorCrew,
  checkEliteCrew,
  classifyField,
  countDevSeasons,
  countClassifyingSeniorSeasons,
  getSeasonForDate,
  getCurrentSeason,
  getPointsAtSeasonStart,
  isClassifyingSeniorRace,
  wasJuniorInSeason,
};