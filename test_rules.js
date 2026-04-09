/**
 * Unit tests for KNRB Regatta Checker rules engine
 * Run: node test_rules.js
 */

const assert = require('assert');
const {
  isClassifyingSeniorRace,
  countClassifyingSeniorSeasons,
  wasJuniorInSeason,
  getPointsAtSeasonStart,
  getSeasonForDate,
  checkEerstejaarsCrew,
  checkDevelopmentCrew,
  checkNieuwelingCrew,
  checkGevorderdeCrew,
  checkBeginnerCrew,
  checkJuniorCrew,
  checkEliteCrew,
  checkSBCrew,
  classifyField,
} = require('./rules');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

// ──────────────────────────────────────────────
// Season helper tests
// ──────────────────────────────────────────────
console.log('\n📡 Season helpers');

test('getSeasonForDate: Sept 2025 → 2025-2026', () => {
  assert.strictEqual(getSeasonForDate('2025-09-01'), '2025-2026');
});

test('getSeasonForDate: Aug 2025 → 2024-2025', () => {
  assert.strictEqual(getSeasonForDate('2025-08-31'), '2024-2025');
});

test('getSeasonForDate: Jan 2026 → 2025-2026', () => {
  assert.strictEqual(getSeasonForDate('2026-01-15'), '2025-2026');
});

test('wasJuniorInSeason: born 2007, season 2024-2025 → junior', () => {
  assert.strictEqual(wasJuniorInSeason('2024-2025', 2007), true);
});

test('wasJuniorInSeason: born 2006, season 2024-2025 → NOT junior', () => {
  assert.strictEqual(wasJuniorInSeason('2024-2025', 2006), false);
});

test('wasJuniorInSeason: born 2008, season 2025-2026 → junior', () => {
  assert.strictEqual(wasJuniorInSeason('2025-2026', 2008), true);
});

test('wasJuniorInSeason: born 2007, season 2025-2026 → NOT junior (18 on Jan 1 2026)', () => {
  assert.strictEqual(wasJuniorInSeason('2025-2026', 2007), false);
});

test('wasJuniorInSeason: born 2008, season 2024-2025 → junior (16 on Jan 1 2025)', () => {
  assert.strictEqual(wasJuniorInSeason('2024-2025', 2008), true);
});

// ──────────────────────────────────────────────
// Classifying race detection tests
// ──────────────────────────────────────────────
console.log('\n🎯 Classifying race detection');

const classifyingTrue = [
  ['ME 4-', 'Elite'],
  ['MG-B 1x', 'Gevorderde'],
  ['MN 1x', 'Nieuweling'],
  ['MB 2x', 'Beginner'],
  ['MDev 4-', 'Development'],
  ['MEj 8+', 'Eerstejaars'],
  ['VE 4-', 'Elite'],
  ['VG 1x', 'Gevorderde'],
  ['VN 1x', 'Nieuweling'],
  ['VEj 8+', 'Eerstejaars'],
  ['VDev 2x', 'Development'],
  ['HE 4-', 'Elite'],
  ['HG 1x', 'Gevorderde'],
  ['LM G 1x', 'Gevorderde'],
  ['LV N 1x', 'Nieuweling'],
  ['OE 4-', 'Elite'],
  ['VSB 1x', 'Senioren B'],
  ['MSB 4+', 'Senioren B'],
  ['SB 1x', 'Senioren B'],
];

for (const [code, cat] of classifyingTrue) {
  test(`isClassifying: ${code} (${cat})`, () => {
    assert.strictEqual(isClassifyingSeniorRace({ matchCode: code, matchCategoryName: cat }), true);
  });
}

const classifyingFalse = [
  ['MOv4+', 'Overnaeds'],
  ['HOv2+', 'Overnaeds'],
  ['VOv4+', 'Overnaeds'],
  ['DOv4+', 'Overnaeds'],
  ['Ov2+', 'Overnaeds'],
  ['VOnerv C4+', 'Onervaren'],
  ['MErv 1x', 'Ervaren'],
  ['VErv 8+', 'Ervaren'],
  ['VErv 8+', ''],
  ['MErv 1x', ''],
  ['MClub 4+', 'Club'],
  ['VLente 1x', 'Lente'],
  ['MTalent 1x', 'Talenten'],
  ['M18 1x', 'Junioren'],
  ['V16 2x', 'Junioren'],
  ['Masters A 1x', 'Masters'],
  ['Mix 8+', 'Mixed'],
  ['Mix 4+', ''],
  ['H4+', ''],
  ['V4+', ''],
  ['D4+', ''],
  ['H8+', ''],
  ['V8+', ''],
  ['O 4+', ''],
  ['M 1x', ''],
  ['V 2x', ''],
];

for (const [code, cat] of classifyingFalse) {
  test(`isNOTClassifying: ${code} (${cat || 'empty'})`, () => {
    assert.strictEqual(isClassifyingSeniorRace({ matchCode: code, matchCategoryName: cat }), false);
  });
}

// ──────────────────────────────────────────────
// Points at season start
// ──────────────────────────────────────────────
console.log('\n📊 Points at season start');

test('getPointsAtSeasonStart: no points at all', () => {
  const result = getPointsAtSeasonStart({ totalScullingPoints: 0, totalSweepingPoints: 0, rowingPoints: [] });
  assert.strictEqual(result.total, 0);
  assert.strictEqual(result.sculling, 0);
  assert.strictEqual(result.sweeping, 0);
});

test('getPointsAtSeasonStart: 2 total, 1 earned this season → 1 at start', () => {
  const result = getPointsAtSeasonStart({
    totalScullingPoints: 1,
    totalSweepingPoints: 1,
    rowingPoints: [{ type: 'Sculling', point: 1, date: '2025-10-01' }],
  });
  assert.strictEqual(result.sculling, 0);
  assert.strictEqual(result.sweeping, 1);
  assert.strictEqual(result.total, 1);
});

test('getPointsAtSeasonStart: all points earned before this season', () => {
  const result = getPointsAtSeasonStart({
    totalScullingPoints: 3,
    totalSweepingPoints: 2,
    rowingPoints: [{ type: 'Sculling', point: 3, date: '2024-05-01' }],
  });
  assert.strictEqual(result.sculling, 3);
  assert.strictEqual(result.sweeping, 2);
  assert.strictEqual(result.total, 5);
});

// ──────────────────────────────────────────────
// Classifying senior seasons (Eerstejaars)
// ──────────────────────────────────────────────
console.log('\n📅 Classifying senior seasons');

test('No history → only current season', () => {
  const result = countClassifyingSeniorSeasons([], 2000);
  assert.strictEqual(result.count, 1);
});

test('One classifying season (as senior) + current = 2', () => {
  const history = [
    { firstTournamentDate: '2024-10-05', raceResults: [{ matchCode: 'MN 1x', matchCategoryName: 'Nieuweling' }] },
  ];
  const result = countClassifyingSeniorSeasons(history, 2000);
  assert.strictEqual(result.count, 2);
});

test('Classifying season as JUNIOR should be excluded', () => {
  // Rower born 2007: junior in 2024-2025 (age 17 on Jan 1 2025)
  // Raced in MG 1x (classifying) but was a junior → should NOT count
  const history = [
    { firstTournamentDate: '2024-10-05', raceResults: [{ matchCode: 'MG 1x', matchCategoryName: 'Gevorderde' }] },
  ];
  const result = countClassifyingSeniorSeasons(history, 2007);
  assert.strictEqual(result.count, 1); // only current season
});

test('Classifying season as SENIOR should be counted', () => {
  // Rower born 2000: NOT junior in 2024-2025
  // Raced in MG 1x (classifying) → should count
  const history = [
    { firstTournamentDate: '2024-10-05', raceResults: [{ matchCode: 'MG 1x', matchCategoryName: 'Gevorderde' }] },
  ];
  const result = countClassifyingSeniorSeasons(history, 2000);
  assert.strictEqual(result.count, 2); // past + current
});

test('Competitie races should NOT count even as senior', () => {
  // Rower born 2000, raced VOnerv C4+ and H4+ (competitie)
  const history = [
    { firstTournamentDate: '2024-10-05', raceResults: [{ matchCode: 'VOnerv C4+', matchCategoryName: 'Onervaren' }] },
    { firstTournamentDate: '2025-04-12', raceResults: [{ matchCode: 'H4+', matchCategoryName: '' }] },
  ];
  const result = countClassifyingSeniorSeasons(history, 2000);
  assert.strictEqual(result.count, 1); // only current season
});

test('Gijs Bargeman scenario: raced SB as junior, now transitioning to senior', () => {
  // Gijs born 2007: junior in 2024-2025 (age 17 on Jan 1 2025)
  // Raced in MSB (classifying senior field) while junior → should NOT count
  const history = [
    { firstTournamentDate: '2024-10-05', raceResults: [{ matchCode: 'MSB 1x', matchCategoryName: 'Gevorderde' }] },
  ];
  const result = countClassifyingSeniorSeasons(history, 2007);
  assert.strictEqual(result.count, 1); // only current season (junior season excluded)
});

test('Mixed history: junior classifying + senior classifying + competitie', () => {
  // Born 2007: junior in 2023-2024, NOT junior in 2024-2025 (age 18 on Jan 1 2025... wait)
  // Actually born 2007 → age 18 on Jan 1 2026 → still junior in 2025-2026 season
  // Born 2006: NOT junior in 2024-2025 (age 19 on Jan 1 2025)
  // Junior in 2023-2024 (age 18 on Jan 1 2024)
  const history = [
    { firstTournamentDate: '2023-10-05', raceResults: [{ matchCode: 'MSB 1x', matchCategoryName: 'Gevorderde' }] }, // as junior → excluded
    { firstTournamentDate: '2024-10-05', raceResults: [{ matchCode: 'MN 1x', matchCategoryName: 'Nieuweling' }] }, // as senior → counted
    { firstTournamentDate: '2025-04-12', raceResults: [{ matchCode: 'VOnerv C4+', matchCategoryName: 'Onervaren' }] }, // competitie → excluded
  ];
  const result = countClassifyingSeniorSeasons(history, 2006);
  assert.strictEqual(result.count, 2); // 2024-2025 (senior classifying) + current
});

// ──────────────────────────────────────────────
// Eerstejaars crew check (Art. 13.4a-g)
// ──────────────────────────────────────────────
console.log('\n🏊 Eerstejaars check');

function makeRower(name, yob, totalSculling, totalSweeping, rowingPoints, raceHistory) {
  return {
    fullName: name,
    personId: name.toLowerCase().replace(/\s+/g, '_'),
    personData: { totalScullingPoints: totalSculling, totalSweepingPoints: totalSweeping, rowingPoints: rowingPoints || [], yearOfBirth: yob },
    raceHistory: raceHistory || [],
  };
}

test('EJ: first season, 0 points → EERSTEJAARS', () => {
  const rower = makeRower('Jan', 2006, 0, 0, [], []);
  const result = checkEerstejaarsCrew([rower], '4+', false, true);
  assert.strictEqual(result.rowers[0].isEerstejaars, true);
  assert.strictEqual(result.rowers[0].pointsAtSeasonStart, 0);
  assert.strictEqual(result.status, 'LEGAL');
});

test('EJ: 2 classifying senior seasons, 0 points at start → non-EJ but allowed with 0 pts', () => {
  const rower = makeRower('Piet', 2002, 0, 0, [], [
    { firstTournamentDate: '2023-10-05', raceResults: [{ matchCode: 'MN 1x', matchCategoryName: 'Nieuweling' }] },
    { firstTournamentDate: '2024-10-05', raceResults: [{ matchCode: 'MG 1x', matchCategoryName: 'Gevorderde' }] },
  ]);
  const result = checkEerstejaarsCrew([rower], '8+', true, false);
  assert.strictEqual(result.rowers[0].isEerstejaars, false);
  assert.strictEqual(result.rowers[0].pointsAtSeasonStart, 0);
  assert.strictEqual(result.rowers[0].violations.length, 0); // allowed as non-EJ with 0 pts
});

test('EJ: 2 classifying senior seasons, 2 points at start → non-EJ WITH violation', () => {
  const rower = makeRower('Klaas', 2002, 2, 0, [], [
    { firstTournamentDate: '2023-10-05', raceResults: [{ matchCode: 'MN 1x', matchCategoryName: 'Nieuweling' }] },
    { firstTournamentDate: '2024-10-05', raceResults: [{ matchCode: 'MG 1x', matchCategoryName: 'Gevorderde' }] },
  ]);
  const result = checkEerstejaarsCrew([rower], '8+', true, false);
  assert.strictEqual(result.rowers[0].isEerstejaars, false);
  assert.strictEqual(result.rowers[0].pointsAtSeasonStart, 2);
  assert.strictEqual(result.rowers[0].violations.length, 1);
});

test('EJ: junior who raced classifying (SB) → should be EERSTEJAARS (junior exception)', () => {
  // Born 2007: junior in 2024-2025, racing SB while junior
  // Now transitioning to senior in 2025-2026
  const rower = makeRower('Gijs', 2007, 0, 0, [], [
    { firstTournamentDate: '2024-10-05', raceResults: [{ matchCode: 'MSB 1x', matchCategoryName: 'Gevorderde' }] },
  ]);
  const result = checkEerstejaarsCrew([rower], '8+', true, false);
  assert.strictEqual(result.rowers[0].isEerstejaars, true);
  assert.strictEqual(result.rowers[0].classifyingSeasonCount, 1);
  assert.strictEqual(result.rowers[0].eerstejaarsReason, 'Eerste seizoen in klasserend veld, 0 punten op 1 sept');
});

test('EJ: only competitie history → should be EERSTEJAARS (1 classifying season = current)', () => {
  // Rower who only raced VOnerv (competitie) → doesn't count as classifying
  const rower = makeRower('Sophie', 2005, 0, 0, [], [
    { firstTournamentDate: '2024-10-05', raceResults: [{ matchCode: 'VOnerv C4+', matchCategoryName: 'Onervaren' }] },
  ]);
  const result = checkEerstejaarsCrew([rower], '8+', true, false);
  assert.strictEqual(result.rowers[0].isEerstejaars, true);
  assert.strictEqual(result.rowers[0].classifyingSeasonCount, 1);
});

test('EJ: classifying + competitie history → only classifying seasons count', () => {
  // Born 2002: NOT junior, raced both MN (classifying) and VOnerv (competitie)
  const rower = makeRower('Test', 2002, 0, 0, [], [
    { firstTournamentDate: '2024-10-05', raceResults: [
      { matchCode: 'MN 1x', matchCategoryName: 'Nieuweling' },
      { matchCode: 'VOnerv C4+', matchCategoryName: 'Onervaren' },
    ]},
  ]);
  const result = checkEerstejaarsCrew([rower], '8+', true, false);
  assert.strictEqual(result.rowers[0].isEerstejaars, false); // 2 classifying seasons (past + current)
  assert.strictEqual(result.rowers[0].classifyingSeasonCount, 2);
});

test('EJ: 8+ allows max 2 non-EJ with 0 points', () => {
  const rowers = [
    makeRower('A', 2006, 0, 0, [], []), // EJ
    makeRower('B', 2006, 0, 0, [], []), // EJ
    makeRower('C', 2002, 0, 0, [], [
      { firstTournamentDate: '2024-10-05', raceResults: [{ matchCode: 'MN 1x', matchCategoryName: 'Nieuweling' }] },
    ]), // non-EJ, 0 pts
    makeRower('D', 2002, 0, 0, [], [
      { firstTournamentDate: '2024-10-05', raceResults: [{ matchCode: 'MN 1x', matchCategoryName: 'Nieuweling' }] },
    ]), // non-EJ, 0 pts
    makeRower('E', 2002, 2, 0, [], [
      { firstTournamentDate: '2024-10-05', raceResults: [{ matchCode: 'MG 1x', matchCategoryName: 'Gevorderde' }] },
    ]), // non-EJ, 2 pts → VIOLATION
  ];
  const result = checkEerstejaarsCrew(rowers, '8+', true, false);
  assert.strictEqual(result.nonEerstejaarsCount, 3);
  assert.strictEqual(result.maxNonEerstejaars, 2);
  assert.strictEqual(result.status, 'ILLEGAL');
});

test('EJ: 4+ allows max 1 non-EJ with 0 points', () => {
  const rowers = [
    makeRower('A', 2006, 0, 0, [], []), // EJ
    makeRower('B', 2006, 0, 0, [], []), // EJ
    makeRower('C', 2002, 0, 0, [], [
      { firstTournamentDate: '2024-10-05', raceResults: [{ matchCode: 'MN 1x', matchCategoryName: 'Nieuweling' }] },
    ]), // non-EJ, 0 pts → allowed
    makeRower('D', 2002, 0, 0, [], [
      { firstTournamentDate: '2024-10-05', raceResults: [{ matchCode: 'MN 1x', matchCategoryName: 'Nieuweling' }] },
    ]), // non-EJ, 0 pts → too many
  ];
  const result = checkEerstejaarsCrew(rowers, '4+', false, true);
  assert.strictEqual(result.nonEerstejaarsCount, 2);
  assert.strictEqual(result.maxNonEerstejaars, 1);
  assert.strictEqual(result.status, 'ILLEGAL');
});

test('EJ: points earned THIS season should be subtracted for season start calc', () => {
  // Rower has 1 sculling point but earned it this season → 0 pts at start
  const rower = makeRower('SeasonPoints', 2006, 1, 0, [
    { type: 'Sculling', point: 1, date: '2025-10-15' },
  ], []);
  const result = checkEerstejaarsCrew([rower], '4+', false, true);
  assert.strictEqual(result.rowers[0].pointsAtSeasonStart, 0);
  assert.strictEqual(result.rowers[0].isEerstejaars, true);
});

// ──────────────────────────────────────────────
// Other field checks (basic sanity)
// ──────────────────────────────────────────────
console.log('\n🚣 Other field checks');

test('Development: crew with 10 total points in 4- → LEGAL', () => {
  const rowers = [
    makeRower('A', 2005, 3, 2, [], []),
    makeRower('B', 2005, 2, 1, [], []),
    makeRower('C', 2005, 1, 1, [], []),
  ];
  const result = checkDevelopmentCrew(rowers, '4-');
  assert.strictEqual(result.status, 'LEGAL');
  assert.strictEqual(result.totalCrewPoints, 10);
});

test('Development: crew with 11 total points in 4- → ILLEGAL', () => {
  const rowers = [
    makeRower('A', 2005, 4, 3, [], []),
    makeRower('B', 2005, 2, 1, [], []),
    makeRower('C', 2005, 1, 0, [], []),
  ];
  const result = checkDevelopmentCrew(rowers, '4-');
  assert.strictEqual(result.status, 'ILLEGAL');
});

test('Nieuweling: avg < 2.0 → LEGAL', () => {
  const rowers = [
    makeRower('A', 2005, 1, 1, [], []),
    makeRower('B', 2005, 0, 1, [], []),
  ];
  const result = checkNieuwelingCrew(rowers, true, true);
  assert.strictEqual(result.status, 'LEGAL');
});

test('Nieuweling: avg ≥ 2.0 → ILLEGAL', () => {
  const rowers = [
    makeRower('A', 2005, 2, 2, [], []),
    makeRower('B', 2005, 1, 1, [], []),
  ];
  // avg = (4+2)/2 = 3.0 → ILLEGAL
  const result = checkNieuwelingCrew(rowers, true, true);
  assert.strictEqual(result.status, 'ILLEGAL');
});

test('Gevorderde: 8+ avg < 6.0 combined → LEGAL', () => {
  const rowers = Array(8).fill(null).map((_, i) => makeRower(`R${i}`, 2000, 3, 2, [], []));
  const result = checkGevorderdeCrew(rowers, false, true);
  assert.strictEqual(result.status, 'LEGAL'); // avg = 5.0
});

test('Beginner: 0 in relevant type, < 6 in other → LEGAL', () => {
  const rower = makeRower('A', 2005, 0, 3, [], []);
  const result = checkBeginnerCrew([rower], true); // sculling boat
  assert.strictEqual(result.status, 'LEGAL');
});

test('Beginner: > 0 in relevant type → ILLEGAL', () => {
  const rower = makeRower('A', 2005, 1, 3, [], []);
  const result = checkBeginnerCrew([rower], true); // sculling boat
  assert.strictEqual(result.status, 'ILLEGAL');
});

test('Junior-18: age 18 on Jan 1 → LEGAL', () => {
  const rower = { fullName: 'J18', personId: 'j18', personData: { totalScullingPoints: 0, totalSweepingPoints: 0, yearOfBirth: new Date().getFullYear() - 18 }, raceHistory: [] };
  const result = checkJuniorCrew([rower], 'M18 1x');
  assert.strictEqual(result.status, 'LEGAL');
});

test('Junior-18: age 19 on Jan 1 → ILLEGAL', () => {
  const rower = { fullName: 'J19', personId: 'j19', personData: { totalScullingPoints: 0, totalSweepingPoints: 0, yearOfBirth: new Date().getFullYear() - 19 }, raceHistory: [] };
  const result = checkJuniorCrew([rower], 'M18 1x');
  assert.strictEqual(result.status, 'ILLEGAL');
});

// ──────────────────────────────────────────────
// SB (Senioren B / Beginner) tests
// ──────────────────────────────────────────────
console.log('\n🏅 Senioren B (Beginner)');

test('classifyField: Senioren B → sb', () => {
  const field = classifyField('Senioren B', '1x');
  assert.strictEqual(field.category, 'sb');
  assert.strictEqual(field.isSculling, true);
});

test('classifyField: Achttien → junior', () => {
  const field = classifyField('Achttien', '1x');
  assert.strictEqual(field.category, 'junior');
});

test('classifyField: Zestien → junior', () => {
  const field = classifyField('Zestien', '4+');
  assert.strictEqual(field.category, 'junior');
});

test('SB: age ≤ 22, 9 scull points → LEGAL (no point restriction)', () => {
  const rower = makeRower('Sarah', 2004, 9, 5, [], []);
  const result = checkSBCrew([rower]);
  assert.strictEqual(result.status, 'LEGAL');
});

test('SB: age 24 → ILLEGAL (too old)', () => {
  const rower = makeRower('Old', 2002, 0, 0, [], []);
  const result = checkSBCrew([rower]);
  assert.strictEqual(result.status, 'ILLEGAL');
});

test('SB: age 22 (born last year of range) → LEGAL', () => {
  const rower = makeRower('Borderline', 2004, 5, 3, [], []);
  const result = checkSBCrew([rower]);
  assert.strictEqual(result.status, 'LEGAL');
});

test('isClassifying: VSB 1x (Senioren B) → true', () => {
  assert.strictEqual(isClassifyingSeniorRace({ matchCode: 'VSB 1x', matchCategoryName: 'Senioren B' }), true);
});

test('isClassifying: MSB 4+ (Senioren B) → true', () => {
  assert.strictEqual(isClassifyingSeniorRace({ matchCode: 'MSB 4+', matchCategoryName: 'Senioren B' }), true);
});

test('isClassifying: VEnv 8+ (Ervaren) → false', () => {
  assert.strictEqual(isClassifyingSeniorRace({ matchCode: 'VErv 8+', matchCategoryName: 'Ervaren' }), false);
});

test('isClassifying: VEnv 8+ (no category) → false', () => {
  assert.strictEqual(isClassifyingSeniorRace({ matchCode: 'VErv 8+', matchCategoryName: '' }), false);
});

test('EJ: VErv (competitie) should NOT count as classifying season', () => {
  const rower = makeRower('Laura', 2005, 0, 0, [], [
    { firstTournamentDate: '2024-10-05', raceResults: [{ matchCode: 'VErv 8+', matchCategoryName: 'Ervaren' }] },
  ]);
  const result = checkEerstejaarsCrew([rower], '8+', true, false);
  assert.strictEqual(result.rowers[0].isEerstejaars, true);
  assert.strictEqual(result.rowers[0].classifyingSeasonCount, 1); // only current season
});

// ──────────────────────────────────────────────
// Results
// ──────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.log('\n⚠️  Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}