// ── NIKTIN v1.0 — core JS ──

const LS_DB   = 'niktin_db_v1';       // { rows: {...adId: rowObj}, headers: [...], lastUpdated }
const LS_PRE  = 'niktin_presets_v1';  // { name: [col, col, ...] }

// ── IN-MEMORY STATE ──
let db          = loadDB();
let presets     = loadPresets();
let allHeaders  = db.headers || [];
let selectedCols = new Set(allHeaders);
let generatedCSV = '';
let generatedRows = [];
let activeTab   = 'table';

const NUM_KEYWORDS = [
  'spent','amount','value','ctr','frequency','purchases','clicks',
  'views','cart','checkout','cost','reach','impressions','results'
];

// ── STORAGE HELPERS ──
function loadDB() {
  try { return JSON.parse(localStorage.getItem(LS_DB)) || { rows: {}, headers: [], lastUpdated: null }; }
  catch { return { rows: {}, headers: [], lastUpdated: null }; }
}
function saveDB() {
  localStorage.setItem(LS_DB, JSON.stringify(db));
  refreshDBPill();
}
function loadPresets() {
  try { return JSON.parse(localStorage.getItem(LS_PRE)) || {}; }
  catch { return {}; }
}
function savePresets() {
  localStorage.setItem(LS_PRE, JSON.stringify(presets));
}

// ── DB PILL ──
function refreshDBPill() {
  const count = Object.keys(db.rows).length;
  document.getElementById('db-count').textContent = `${count} ad${count !== 1 ? 's' : ''} in database`;
  document.getElementById('db-dot').className = 'db-dot' + (count > 0 ? ' live' : '');
  const lu = db.lastUpdated ? new Date(db.lastUpdated).toLocaleString() : 'never';
  document.getElementById('db-last-updated').textContent = lu;
  document.getElementById('db-total-rows').textContent = count;
  document.getElementById('db-header-count').textContent = db.headers.length;
}

// ── DB PANEL TOGGLE ──
document.getElementById('db-panel-header').addEventListener('click', () => {
  const body = document.getElementById('db-panel-body');
  const hdr  = document.getElementById('db-panel-header');
  const open = body.classList.toggle('open');
  hdr.classList.toggle('open', open);
  document.getElementById('db-chevron').textContent = open ? '▲' : '▼';
});

// ── CSV PARSER ──
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const result = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (c === ',' && !inQ) { row.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    row.push(cur.trim());
    result.push(row);
  }
  return result;
}

function rowToObj(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = (row[i] ?? '').trim(); });
  return obj;
}

// ── UPLOAD & MERGE INTO DB ──
const zone = document.getElementById('upload-zone');
zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); handleFile(e.dataTransfer.files[0]); });
document.getElementById('csv-file-input').addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });

function handleFile(file) {
  if (!file) return;
  if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
    showErr('upload-err', 'Please upload a .csv file exported from Meta Ads Manager.'); return;
  }
  hideErr('upload-err');
  const reader = new FileReader();
  reader.onload = e => mergeCSVIntoDb(e.target.result, file.name);
  reader.readAsText(file);
}

function mergeCSVIntoDb(text, filename) {
  const parsed = parseCSV(text);
  if (parsed.length < 2) { showErr('upload-err', 'CSV seems empty or invalid.'); return; }

  const headers = parsed[0];
  const rows = parsed.slice(1).map(r => rowToObj(headers, r));

  // Detect Ad ID column
  const adIdCol = headers.find(h => /ad.?id/i.test(h));
  if (!adIdCol) { showErr('upload-err', 'Could not detect an "Ad ID" column in this CSV.'); return; }

  // Merge headers (union)
  const newHeaders = [...new Set([...db.headers, ...headers])];
  db.headers = newHeaders;
  allHeaders = newHeaders;

  // Merge rows: if Ad ID exists, update fields; else insert
  let added = 0, updated = 0;
  rows.forEach(row => {
    const id = (row[adIdCol] || '').trim();
    if (!id) return;
    if (db.rows[id]) {
      // Update existing fields
      Object.assign(db.rows[id], row);
      updated++;
    } else {
      db.rows[id] = row;
      added++;
    }
  });

  db.lastUpdated = new Date().toISOString();
  saveDB();

  // Rebuild column selection from merged headers
  selectedCols = new Set(newHeaders);
  renderColGrid();
  renderPresetRow();

  const status = document.getElementById('upload-status');
  status.classList.add('visible');
  document.getElementById('upload-status-text').textContent =
    `${filename} merged — ${added} new · ${updated} updated · ${Object.keys(db.rows).length} total in database`;
}

// ── COLUMN GRID ──
function renderColGrid() {
  const grid = document.getElementById('col-grid');
  if (!allHeaders.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Upload a CSV or the database has no headers yet</div>';
    return;
  }
  grid.innerHTML = '';
  allHeaders.forEach(h => {
    const div = document.createElement('label');
    div.className = 'col-check' + (selectedCols.has(h) ? ' checked' : '');
    div.innerHTML = `<input type="checkbox" ${selectedCols.has(h) ? 'checked' : ''} />
      <span class="col-check-icon">${selectedCols.has(h) ? '✓' : '+'}</span> ${escapeHtml(h)}`;
    div.querySelector('input').addEventListener('change', ev => {
      if (ev.target.checked) { selectedCols.add(h); div.classList.add('checked'); div.querySelector('.col-check-icon').textContent = '✓'; }
      else { selectedCols.delete(h); div.classList.remove('checked'); div.querySelector('.col-check-icon').textContent = '+'; }
    });
    grid.appendChild(div);
  });
}

function toggleAllCols(on) {
  if (on) allHeaders.forEach(h => selectedCols.add(h));
  else selectedCols.clear();
  renderColGrid();
}

// ── PRESETS ──
function renderPresetRow() {
  const row = document.getElementById('preset-row');
  const names = Object.keys(presets);
  row.innerHTML = `<span class="preset-label">PRESETS</span>`;
  names.forEach(name => {
    const chip = document.createElement('span');
    chip.className = 'preset-chip';
    chip.innerHTML = `${escapeHtml(name)} <span class="del" title="Delete preset" data-name="${escapeHtml(name)}">✕</span>`;
    chip.addEventListener('click', e => {
      if (e.target.classList.contains('del')) {
        if (confirm(`Delete preset "${name}"?`)) { delete presets[name]; savePresets(); renderPresetRow(); }
      } else {
        applyNamedPreset(name);
      }
    });
    row.appendChild(chip);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-ghost btn-sm';
  addBtn.textContent = '+ Save preset';
  addBtn.onclick = openSavePresetModal;
  row.appendChild(addBtn);
}

function applyNamedPreset(name) {
  if (!presets[name]) return;
  selectedCols = new Set(presets[name].filter(c => allHeaders.includes(c)));
  renderColGrid();
}

function openSavePresetModal() {
  document.getElementById('preset-name-input').value = '';
  document.getElementById('preset-modal').classList.add('open');
  document.getElementById('preset-name-input').focus();
}
function closePresetModal() {
  document.getElementById('preset-modal').classList.remove('open');
}
function confirmSavePreset() {
  const name = document.getElementById('preset-name-input').value.trim();
  if (!name) { alert('Enter a preset name.'); return; }
  presets[name] = [...selectedCols];
  savePresets();
  renderPresetRow();
  closePresetModal();
}
document.getElementById('preset-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmSavePreset();
  if (e.key === 'Escape') closePresetModal();
});

// ── GENERATE ──
function generate() {
  hideErr('gen-err');
  const dbRowCount = Object.keys(db.rows).length;
  if (dbRowCount === 0) { showErr('gen-err', 'Database is empty — upload a CSV first.'); return; }
  if (!selectedCols.size) { showErr('gen-err', 'Select at least one column.'); return; }

  const adIdCol = allHeaders.find(h => /ad.?id/i.test(h));
  const rawIds = document.getElementById('ad-ids-input').value.trim();
  let filteredRows = [], missingIds = [];

  document.getElementById('ids-warn').classList.remove('visible');
  document.getElementById('missing-ids-box').classList.remove('visible');

  if (rawIds) {
    if (!adIdCol) { showErr('gen-err', 'No "Ad ID" column detected in the database headers.'); return; }
    const ids = rawIds.split('\n').map(s => s.trim()).filter(Boolean);
    ids.forEach(id => {
      if (db.rows[id]) filteredRows.push(db.rows[id]);
      else missingIds.push(id);
    });
    if (!filteredRows.length && missingIds.length) {
      showErr('gen-err', 'None of the pasted Ad IDs were found in the database.');
      showMissingIds(missingIds);
      return;
    }
    if (missingIds.length) showMissingIds(missingIds);
  } else {
    filteredRows = Object.values(db.rows);
  }

  const cols = allHeaders.filter(h => selectedCols.has(h));
  const csvLines = [cols.map(csvCell).join(',')];
  filteredRows.forEach(r => csvLines.push(cols.map(c => csvCell(r[c] ?? '')).join(',')));
  generatedCSV = csvLines.join('\n');
  generatedRows = filteredRows;

  document.getElementById('badge-rows').textContent = `${filteredRows.length} row${filteredRows.length !== 1 ? 's' : ''}`;
  document.getElementById('badge-cols').textContent = `${cols.length} col${cols.length !== 1 ? 's' : ''}`;
  const missEl = document.getElementById('badge-missing');
  if (missingIds.length) {
    missEl.textContent = `${missingIds.length} missing`;
    missEl.style.display = 'inline';
  } else { missEl.style.display = 'none'; }

  renderTable(cols, filteredRows);
  renderRaw();
  const out = document.getElementById('output-section');
  out.classList.add('visible');
  switchTab(activeTab);
  out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showMissingIds(ids) {
  const box = document.getElementById('missing-ids-box');
  const chips = document.getElementById('missing-ids-chips');
  chips.innerHTML = ids.map(id => `<span class="missing-id-chip">${escapeHtml(id)}</span>`).join('');
  box.classList.add('visible');
}

// ── RENDER ──
function csvCell(v) {
  v = String(v ?? '');
  if (v.includes(',') || v.includes('"') || v.includes('\n')) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function renderTable(cols, rows) {
  const thead = document.querySelector('#csv-table thead');
  const tbody = document.querySelector('#csv-table tbody');
  thead.innerHTML = '<tr>' + cols.map(c => `<th>${escapeHtml(c)}</th>`).join('') + '</tr>';
  tbody.innerHTML = rows.map(r =>
    '<tr>' + cols.map(c => {
      const v = r[c] ?? '';
      const isNum = NUM_KEYWORDS.some(kw => c.toLowerCase().includes(kw));
      const isId  = /ad.?id/i.test(c);
      return `<td class="${isId ? 'col-adid' : isNum ? 'col-num' : ''}">${escapeHtml(v)}</td>`;
    }).join('') + '</tr>'
  ).join('');
}

function renderRaw() {
  document.getElementById('csv-raw').textContent = generatedCSV;
}

// ── TABS ──
function switchTab(tab) {
  activeTab = tab;
  document.getElementById('tab-table').classList.toggle('active', tab === 'table');
  document.getElementById('tab-raw').classList.toggle('active',   tab === 'raw');
  document.getElementById('table-view-wrap').style.display = tab === 'table' ? 'block' : 'none';
  document.getElementById('csv-raw').style.display          = tab === 'raw'   ? 'block' : 'none';
}

// ── COPY (TSV for sheets) ──
function copyTable() {
  if (!generatedCSV) return;
  const cols = allHeaders.filter(h => selectedCols.has(h));
  const tsv = [cols.join('\t'), ...generatedRows.map(r => cols.map(c => (r[c] ?? '').replace(/\t/g,' ')).join('\t'))].join('\n');
  navigator.clipboard.writeText(tsv).then(() => {
    const btn = document.querySelector('#copy-table-btn');
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1800);
  });
}

// ── DOWNLOAD OUTPUT CSV ──
function downloadCSV() {
  if (!generatedCSV) return;
  triggerDownload(generatedCSV, 'niktin-export.csv', 'text/csv');
}

// ── DB EXPORT ──
function exportDB() {
  const json = JSON.stringify(db, null, 2);
  triggerDownload(json, 'niktin-database.json', 'application/json');
}

// ── DB IMPORT ──
document.getElementById('db-import-input').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!imported.rows || !imported.headers) { alert('Invalid niktin database file.'); return; }
      // Merge imported into existing
      const newHeaders = [...new Set([...db.headers, ...imported.headers])];
      db.headers = newHeaders;
      allHeaders = newHeaders;
      let added = 0, updated = 0;
      Object.entries(imported.rows).forEach(([id, row]) => {
        if (db.rows[id]) { Object.assign(db.rows[id], row); updated++; }
        else { db.rows[id] = row; added++; }
      });
      db.lastUpdated = new Date().toISOString();
      saveDB();
      selectedCols = new Set(newHeaders);
      renderColGrid();
      renderPresetRow();
      alert(`Database imported: ${added} new, ${updated} updated.`);
    } catch { alert('Could not parse the database file.'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── CLEAR DB ──
function clearDB() {
  if (!confirm('Clear the entire niktin database? This cannot be undone.')) return;
  db = { rows: {}, headers: [], lastUpdated: null };
  allHeaders = []; selectedCols = new Set();
  saveDB();
  renderColGrid();
  renderPresetRow();
  document.getElementById('upload-status').classList.remove('visible');
  document.getElementById('output-section').classList.remove('visible');
}

// ── RESET SESSION (keep DB) ──
function resetAll() {
  generatedCSV = ''; generatedRows = [];
  document.getElementById('csv-file-input').value = '';
  document.getElementById('ad-ids-input').value = '';
  document.getElementById('upload-status').classList.remove('visible');
  document.getElementById('output-section').classList.remove('visible');
  document.getElementById('missing-ids-box').classList.remove('visible');
  ['upload-err','ids-warn','gen-err'].forEach(hideErr);
}

// ── HELPERS ──
function triggerDownload(content, filename, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
function showErr(id, msg) { const el = document.getElementById(id); if (el) { el.textContent = msg; el.classList.add('visible'); } }
function hideErr(id) { const el = document.getElementById(id); if (el) { el.textContent = ''; el.classList.remove('visible'); } }
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── INIT ──
(function init() {
  refreshDBPill();
  renderColGrid();
  renderPresetRow();
  // Restore selected cols from DB headers
  selectedCols = new Set(allHeaders);
})();