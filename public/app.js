/**
 * KNRB Regatta Checker – Client-side Application
 */

// DOM elements
const tournamentSelect = document.getElementById('tournament-select');
const stepSelect = document.getElementById('step-select');
const fieldSelect = document.getElementById('field-select');
const combinedCheckbox = document.getElementById('combined-nieuweling');
const btnCheck = document.getElementById('btn-check');
const stepLoading = document.getElementById('step-loading');
const loadingText = document.getElementById('loading-text');
const loadingSub = document.getElementById('loading-sub');
const stepResults = document.getElementById('step-results');
const resultsTitle = document.getElementById('results-title');
const statTotal = document.getElementById('stat-total');
const statLegal = document.getElementById('stat-legal');
const statIllegal = document.getElementById('stat-illegal');
const resultsGrid = document.getElementById('results-grid');
const globalStatsText = document.getElementById('global-stats-text');
const globalCounter = document.getElementById('global-counter');
const btnCheckTournament = document.getElementById('btn-check-tournament');

let currentTournamentId = null;
let allMatches = [];

// Default tournament to pre-select: Voorjaarsregatta 2026
const DEFAULT_TOURNAMENT_NAME = 'Voorjaarsregatta';

/**
 * Fetch and update global stats counter
 */
async function updateStats() {
  try {
    const res = await fetch('/api/stats');
    if (res.ok) {
      const data = await res.json();
      globalCounter.textContent = data.totalChecks;
      globalStatsText.style.opacity = '1';
    }
  } catch (e) {
    console.error('Could not fetch stats', e);
  }
}

/**
 * Format a date string for display.
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}

/**
 * Load the tournament list on page load.
 */
async function loadTournaments() {
  try {
    const res = await fetch('/api/tournaments');
    if (!res.ok) throw new Error(`Fout: ${res.statusText}`);
    const data = await res.json();

    const tournaments = data.tournaments || [];
    tournamentSelect.innerHTML = '<option value="">-- Selecteer regatta --</option>';

    let defaultId = null;

    for (const t of tournaments) {
      const opt = document.createElement('option');
      opt.value = t.id;
      const dateStr = formatDate(t.firstDate);
      const lastStr = t.lastDate !== t.firstDate ? ` – ${formatDate(t.lastDate)}` : '';
      opt.textContent = `${dateStr}${lastStr}: ${t.name}`;
      tournamentSelect.appendChild(opt);

      // Find the default tournament (Voorjaarsregatta)
      if (t.name.toLowerCase().includes(DEFAULT_TOURNAMENT_NAME.toLowerCase())) {
        defaultId = t.id;
      }
    }

    // Auto-select and load the default tournament
    if (defaultId) {
      tournamentSelect.value = defaultId;
      await loadRegatta(defaultId);
    }
  } catch (err) {
    tournamentSelect.innerHTML = '<option value="">Fout bij laden van regatta\'s</option>';
    console.error('Error loading tournaments:', err);
  }
}

/**
 * Load matches for a specific tournament.
 */
async function loadRegatta(tournamentId) {
  if (!tournamentId) {
    stepSelect.classList.add('hidden');
    stepResults.classList.add('hidden');
    btnCheckTournament.disabled = true;
    return;
  }

  currentTournamentId = tournamentId;

  btnCheckTournament.disabled = false;

  try {
    const res = await fetch(`/api/matches?tournamentId=${tournamentId}`);
    if (!res.ok) throw new Error(`Fout: ${res.statusText}`);
    const data = await res.json();

    allMatches = data.matches || [];
    populateFieldDropdown(allMatches);

    stepSelect.classList.remove('hidden');
    stepResults.classList.add('hidden');
  } catch (err) {
    alert(`Fout bij het laden: ${err.message}`);
  }
}

/**
 * Populate the field dropdown, grouped by category.
 * Show Dev + Nieuweling at the top.
 */
function populateFieldDropdown(matches) {
  fieldSelect.innerHTML = '<option value="">-- Selecteer veld --</option>';

  // Group by category
  const groups = {};
  for (const m of matches) {
    const cat = m.matchCategoryName || 'Overig';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(m);
  }

  // Order: Development, Nieuweling, Beginner, Gevorderde, then rest alphabetically
  const priority = ['Development', 'Nieuweling', 'Beginner', 'Gevorderde', 'Elite'];
  const sortedKeys = [
    ...priority.filter(k => groups[k]),
    ...Object.keys(groups).filter(k => !priority.includes(k)).sort(),
  ];

  for (const cat of sortedKeys) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = cat;
    for (const m of groups[cat]) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.code || m.matchGeneratedCode} – ${m.name} (${m.registrationCount} inschrijvingen)`;
      optgroup.appendChild(opt);
    }
    fieldSelect.appendChild(optgroup);
  }
}

/**
 * Enable/disable check button based on selection.
 */
fieldSelect.addEventListener('change', () => {
  btnCheck.disabled = !fieldSelect.value;
});

/**
 * When tournament changes, load its fields.
 */
tournamentSelect.addEventListener('change', () => {
  loadRegatta(tournamentSelect.value);
});

/**
 * Check all crews in the selected field.
 */
async function checkField() {
  const matchId = fieldSelect.value;
  if (!matchId || !currentTournamentId) return;

  // Show loading
  stepLoading.classList.remove('hidden');
  stepResults.classList.add('hidden');
  btnCheck.disabled = true;

  const selectedMatch = allMatches.find(m => m.id === parseInt(matchId));
  loadingText.textContent = `Controleren: ${selectedMatch?.code || matchId}...`;
  loadingSub.textContent = `${selectedMatch?.registrationCount || '?'} inschrijvingen – bemanningsdata ophalen...`;

  try {
    const res = await fetch('/api/check-field', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournamentId: currentTournamentId,
        matchId: parseInt(matchId),
        combinedNieuweling: combinedCheckbox.checked,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || res.statusText);
    }

    const data = await res.json();
    renderResults(data);
    updateStats();
  } catch (err) {
    alert(`Fout bij controle: ${err.message}`);
  } finally {
    stepLoading.classList.add('hidden');
    btnCheck.disabled = false;
  }
}

/**
 * Check all fields in the selected tournament.
 */
async function checkTournament() {
  if (!currentTournamentId) return;

  stepLoading.classList.remove('hidden');
  stepResults.classList.add('hidden');
  btnCheck.disabled = true;
  btnCheckTournament.disabled = true;

  const selectedOption = tournamentSelect.options[tournamentSelect.selectedIndex];
  loadingText.textContent = `Controleren: ${selectedOption?.text || 'wedstrijd'}...`;
  loadingSub.textContent = `Alle velden controleren – dit kan even duren`;

  try {
    const res = await fetch('/api/check-tournament', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournamentId: currentTournamentId,
        combinedNieuweling: combinedCheckbox.checked,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || res.statusText);
    }

    const data = await res.json();
    renderTournamentResults(data);
    updateStats();
  } catch (err) {
    alert(`Fout bij controle: ${err.message}`);
  } finally {
    stepLoading.classList.add('hidden');
    btnCheck.disabled = false;
    btnCheckTournament.disabled = false;
  }
}

/**
 * Render the check results.
 */
function renderResults(data) {
  stepResults.classList.remove('hidden');

  resultsTitle.textContent = data.matchFullName || 'Resultaten';
  statTotal.textContent = `${data.totalCrews} bemanningen`;
  statLegal.textContent = `✅ ${data.totalCrews - data.illegalCrews} legaal`;
  statIllegal.textContent = `❌ ${data.illegalCrews} illegaal`;

  // Hide illegal stat if 0
  statIllegal.style.display = data.illegalCrews > 0 ? '' : 'none';

  resultsGrid.innerHTML = '';

  for (let i = 0; i < data.results.length; i++) {
    const crew = data.results[i];
    const card = createCrewCard(crew, i);
    resultsGrid.appendChild(card);
  }

  // Auto-expand illegal crews
  document.querySelectorAll('.crew-card.status-illegal').forEach(card => {
    card.classList.add('expanded');
  });
}

/**
 * Render the full tournament check results.
 */
function renderTournamentResults(data) {
  stepResults.classList.remove('hidden');

  resultsTitle.textContent = `${data.totalFields} velden gecontroleerd`;
  statTotal.textContent = `${data.totalFields} velden`;
  statLegal.textContent = `✅ ${data.totalFields - data.totalIllegalFields} legaal`;
  statIllegal.textContent = `❌ ${data.totalIllegalFields} met problemen`;
  statIllegal.style.display = data.totalIllegalFields > 0 ? '' : 'none';

  resultsGrid.innerHTML = '';

  for (let fi = 0; fi < data.fields.length; fi++) {
    const field = data.fields[fi];
    const section = document.createElement('div');
    section.className = `tournament-field ${field.illegalCrews > 0 ? 'status-illegal expanded' : 'status-legal'}`;
    section.style.animationDelay = `${fi * 0.04}s`;

    const badge = field.illegalCrews > 0
      ? `<span class="status-badge badge-illegal">${field.illegalCrews} illegaal</span>`
      : `<span class="status-badge badge-legal">Legaal</span>`;

    const crewCards = field.results.map((crew, ci) => createCrewCard(crew, ci).outerHTML).join('');

    section.innerHTML = `
      <div class="tournament-field-header" onclick="this.parentElement.classList.toggle('expanded')">
        <div class="field-info">
          <span class="field-name">${escapeHtml(field.matchFullName)}</span>
          <span class="field-meta">${field.totalCrews} bemanningen</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          ${badge}
          <span class="expand-icon">▼</span>
        </div>
      </div>
      <div class="tournament-field-body">
        ${crewCards}
      </div>
    `;

    resultsGrid.appendChild(section);
  }
}

/**
 * Create a crew result card element.
 */
function createCrewCard(crew, index) {
  const card = document.createElement('div');
  card.className = `crew-card status-${crew.status.toLowerCase()}`;
  card.style.animationDelay = `${index * 0.05}s`;

  // Badge class
  const badgeClass = crew.status === 'LEGAL' ? 'badge-legal' :
                     crew.status === 'ILLEGAL' ? 'badge-illegal' : 'badge-skipped';
  const badgeText = crew.status === 'LEGAL' ? '✅ Legaal' :
                    crew.status === 'ILLEGAL' ? '❌ Illegaal' : '⏭️ Overgeslagen';

  // Points summary text
  let pointsSummary = '';
  let pointsLimitText = '';
  if (crew.fieldType === 'Development' && crew.totalCrewPoints !== undefined) {
    pointsSummary = `Totaal: ${crew.totalCrewPoints} / ${crew.pointLimit} punten`;
    pointsLimitText = `max ${crew.pointLimit} totaal`;
  } else if (crew.fieldType === 'Nieuweling' && crew.averagePoints !== undefined) {
    pointsSummary = `Gemiddelde: ${crew.averagePoints.toFixed(2)} punten`;
    pointsLimitText = 'max < 2.0 gemiddeld';
  } else if (crew.fieldType === 'Gevorderde' && crew.averagePoints !== undefined) {
    pointsSummary = `Gemiddelde: ${crew.averagePoints.toFixed(2)} punten`;
    pointsLimitText = 'max < 6.0 gemiddeld';
  } else if (crew.fieldType === 'Eerstejaars' && crew.nonEerstejaarsCount !== undefined) {
    pointsSummary = `Niet-eerstejaars: ${crew.nonEerstejaarsCount} / max ${crew.maxNonEerstejaars}`;
    pointsLimitText = `max ${crew.maxNonEerstejaars} niet-eerstejaars`;
  } else if (crew.fieldType === 'Junior' && crew.ageLimit) {
    pointsSummary = `Leeftijdslimiet: ${crew.ageLimit} jaar`;
    pointsLimitText = `max ${crew.ageLimit} jaar op 1 jan`;
  }

  const noteHtml = crew.note ? `<div class="points-summary" style="color:var(--text-muted)">${escapeHtml(crew.note)}</div>` : '';

  card.innerHTML = `
    <div class="crew-header" onclick="this.parentElement.classList.toggle('expanded')">
      <div class="crew-info">
        <span class="crew-name">${escapeHtml(crew.teamName)}</span>
        <span class="crew-meta">${escapeHtml(crew.matchCode)}${pointsSummary ? ' · ' + pointsSummary : ''}</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="status-badge ${badgeClass}">${badgeText}</span>
        <span class="expand-icon">▼</span>
      </div>
    </div>
    <div class="crew-details">
      ${renderViolations(crew.crewViolations)}
      ${renderRowerTable(crew)}
      ${pointsSummary ? `<div class="points-summary"><strong>${crew.fieldType}:</strong> ${pointsSummary} (${pointsLimitText})</div>` : ''}
      ${noteHtml}
    </div>
  `;

  return card;
}

/**
 * Render violations list.
 */
function renderViolations(violations) {
  if (!violations || violations.length === 0) return '';

  return `<div class="violations">
    ${violations.map(v => `
      <div class="violation">
        <span class="violation-icon">⚠️</span>
        <span>${escapeHtml(v)}</span>
      </div>
    `).join('')}
  </div>`;
}

/**
 * Render the rower details table.
 */
function renderRowerTable(crew) {
  if (!crew.rowers || crew.rowers.length === 0) return '';

  const isDev = crew.fieldType === 'Development';
  const isEerstejaars = crew.fieldType === 'Eerstejaars';
  const isJunior = crew.fieldType === 'Junior';

  let headers = `<th>Naam</th><th>Scull</th><th>Sweep</th><th>Totaal</th>`;
  if (isDev) {
    headers += `<th>Dev seizoenen</th>`;
  } else if (isEerstejaars) {
    headers += `<th>Eerstejaars?</th>`;
  } else if (isJunior) {
    headers += `<th>Geboortejaar</th>`;
  }
  headers += `<th>Status</th>`;

  const rows = crew.rowers.map(r => {
    const hasViolation = r.violations && r.violations.length > 0;
    let cells = `
      <td class="rower-name">${escapeHtml(r.name)}</td>
      <td class="points-cell">${r.scullingPoints}</td>
      <td class="points-cell">${r.sweepingPoints}</td>
      <td class="points-cell">${r.totalPoints}</td>
    `;
    if (isDev) {
      cells += `<td class="points-cell">${r.devSeasonCount || 0} (${(r.devSeasons || []).join(', ') || '-'})</td>`;
    } else if (isEerstejaars) {
      const isEJ = r.isEerstejaars;
      cells += `<td>${isEJ ? '<span style="color:var(--green)">Ja</span>' : '<span style="color:var(--amber)">Nee (' + (r.classifyingSeasonCount || '?') + ' seizoenen)</span>'}</td>`;
    } else if (isJunior) {
      cells += `<td class="points-cell">${r.yearOfBirth || '?'}</td>`;
    }
    cells += `<td>${hasViolation
        ? `<span class="rower-violation-text">⚠️ ${escapeHtml(r.violations[0])}</span>`
        : '<span style="color:var(--green)">✓</span>'
      }</td>`;

    return `<tr>${cells}</tr>`;
  }).join('');

  return `<table class="rower-table">
    <thead><tr>${headers}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
}

// Event listeners
btnCheck.addEventListener('click', checkField);
btnCheckTournament.addEventListener('click', checkTournament);

// Load initial data
loadTournaments();
updateStats();
