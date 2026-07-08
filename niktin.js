// ── NIKTIN v1.0 — core JS ──

const LS_DB  = 'niktin_db_v1';
const LS_PRE = 'niktin_presets_v1';

// ── IN-MEMORY STATE ──
let db           = loadDB();
let presets      = loadPresets();
let allHeaders   = db.headers || [];
let selectedCols = new Set(allHeaders);
// colOrder drives the column sequence; maintained as an array of header names
let colOrder     = [...allHeaders];
let generatedCSV = '';
let generatedRows = [];
let generatedCols = [];
let activeTab    = 'table';

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

// Load SheetJS on demand (only when an xlsx is uploaded)
function loadSheetJS(cb) {
  if (window.XLSX) { cb(); return; }
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  s.onload = cb;
  s.onerror = () => showErr('upload-err', 'Could not load xlsx parser. Check your internet connection.');
  document.head.appendChild(s);
}

function handleFile(file) {
  if (!file) return;
  const name = file.name.toLowerCase();
  const isXLSX = name.endsWith('.xlsx') || name.endsWith('.xls');
  const isCSV  = name.endsWith('.csv') || file.type === 'text/csv';
  if (!isXLSX && !isCSV) {
    showErr('upload-err', 'Please upload a .csv or .xlsx file exported from Meta or TikTok Ads Manager.'); return;
  }
  hideErr('upload-err');

  if (isXLSX) {
    loadSheetJS(() => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          // Delete the !ref if it only spans one column — forces SheetJS to re-scan
          if (ws['!ref']) {
            const match = ws['!ref'].match(/^([A-Z]+)\d+:([A-Z]+)\d+$/);
            if (match && match[1] === match[2]) delete ws['!ref'];
          }
          const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
          if (aoa.length < 2) { showErr('upload-err', 'Spreadsheet appears empty.'); return; }
          // Find the actual header row (skip any title/summary rows before data)
          let headerRowIdx = 0;
          for (let i = 0; i < Math.min(aoa.length, 6); i++) {
            if (aoa[i].some(cell => /ad.?id|ad\s*name/i.test(String(cell)))) { headerRowIdx = i; break; }
          }
          const headers = aoa[headerRowIdx].map(h => String(h).trim()).filter(Boolean);
          // Build rows, skip summary/total rows (where Ad ID cell looks like a dash or is blank)
          const rows = aoa.slice(headerRowIdx + 1)
            .filter(r => r.length > 0)
            .map(r => {
              const obj = {};
              headers.forEach((h, i) => { obj[h] = String(r[i] ?? '').trim(); });
              return obj;
            })
            .filter(row => {
              // Drop total/summary rows — they typically have "Total" or "-" in the first cell
              const first = Object.values(row)[0] || '';
              return !/^(total|-)$/i.test(first.trim());
            });
          mergeRowsIntoDb(headers, rows, file.name);
        } catch (err) {
          showErr('upload-err', 'Could not parse xlsx file: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  } else {
    const reader = new FileReader();
    reader.onload = e => {
      const parsed = parseCSV(e.target.result);
      if (parsed.length < 2) { showErr('upload-err', 'CSV seems empty or invalid.'); return; }
      const headers = parsed[0];
      const rows = parsed.slice(1).map(r => rowToObj(headers, r));
      mergeRowsIntoDb(headers, rows, file.name);
    };
    reader.readAsText(file);
  }
}

// Ad ID column detection — handles "Ad ID", "Ad Id", "ad_id", "adid", etc.
function findAdIdCol(headers) {
  return headers.find(h => /^ad[\s_-]?id$/i.test(h.trim()))
      || headers.find(h => /ad[\s_-]?id/i.test(h));
}

function mergeRowsIntoDb(headers, rows, filename) {
  const adIdCol = findAdIdCol(headers);
  if (!adIdCol) {
    showErr('upload-err', `Could not detect an Ad ID column. Columns found: ${headers.slice(0,8).join(', ')}…`);
    return;
  }

  const newHeaders = [...new Set([...db.headers, ...headers])];
  db.headers = newHeaders;
  allHeaders  = newHeaders;

  const existingSet = new Set(colOrder);
  newHeaders.forEach(h => { if (!existingSet.has(h)) colOrder.push(h); });

  let added = 0, updated = 0;
  rows.forEach(row => {
    const id = (row[adIdCol] || '').trim();
    if (!id || /^[-–]$/.test(id)) return;
    if (db.rows[id]) { Object.assign(db.rows[id], row); updated++; }
    else { db.rows[id] = row; added++; }
  });

  db.lastUpdated = new Date().toISOString();
  saveDB();

  selectedCols = new Set(newHeaders);
  renderColGrid();
  renderPresetRow();

  const status = document.getElementById('upload-status');
  status.classList.add('visible');
  document.getElementById('upload-status-text').textContent =
    `${filename} merged — ${added} new · ${updated} updated · ${Object.keys(db.rows).length} total in database`;
}

function mergeCSVIntoDb(text, filename) {
  const parsed = parseCSV(text);
  if (parsed.length < 2) { showErr('upload-err', 'CSV seems empty or invalid.'); return; }
  const headers = parsed[0];
  const rows = parsed.slice(1).map(r => rowToObj(headers, r));
  mergeRowsIntoDb(headers, rows, filename);
}

// ── COLUMN GRID (pointer-based drag-to-reorder) ──
function renderColGrid() {
  const grid = document.getElementById('col-grid');
  if (!allHeaders.length) {
    grid.innerHTML = '<div class="empty-state" style="padding:1rem;">Upload a CSV or the database has no headers yet</div>';
    return;
  }
  // Sync colOrder
  const orderSet = new Set(colOrder);
  allHeaders.forEach(h => { if (!orderSet.has(h)) colOrder.push(h); });
  colOrder = colOrder.filter(h => allHeaders.includes(h));

  grid.innerHTML = '';
  colOrder.forEach(h => {
    const div = document.createElement('div');
    div.className = 'col-check' + (selectedCols.has(h) ? ' checked' : '');
    div.dataset.col = h;
    div.innerHTML = `
      <span class="drag-handle" title="Drag to reorder">⠿</span>
      <span class="col-check-icon">${selectedCols.has(h) ? '✓' : '+'}</span>
      <span class="col-label">${escapeHtml(h)}</span>`;
    div.addEventListener('click', e => {
      if (e.target.closest('.drag-handle')) return;
      if (selectedCols.has(h)) { selectedCols.delete(h); div.classList.remove('checked'); div.querySelector('.col-check-icon').textContent = '+'; }
      else { selectedCols.add(h); div.classList.add('checked'); div.querySelector('.col-check-icon').textContent = '✓'; }
    });
    grid.appendChild(div);
  });
  initPointerSort(grid);
}

function initPointerSort(grid) {
  grid.addEventListener('mousedown', onDragStart);
  grid.addEventListener('touchstart', onDragStart, { passive: false });

  let dragging = null, ghost = null, placeholder = null, offsetY = 0;

  function onDragStart(e) {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    e.preventDefault();

    dragging = handle.closest('.col-check');
    const rect = dragging.getBoundingClientRect();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    offsetY = clientY - rect.top;

    // Placeholder keeps the slot
    placeholder = document.createElement('div');
    placeholder.style.cssText = `height:${rect.height}px;flex-shrink:0;border:1.5px dashed #d0d0cc;background:#f4f4f0;border-radius:6px;box-sizing:border-box;`;
    dragging.insertAdjacentElement('afterend', placeholder);
    dragging.style.display = 'none';

    // Floating ghost
    ghost = dragging.cloneNode(true);
    ghost.style.cssText = `
      position:fixed;left:${rect.left}px;width:${rect.width}px;top:${rect.top}px;
      pointer-events:none;z-index:9999;opacity:0.9;border-radius:6px;margin:0;
      box-shadow:0 8px 24px rgba(0,0,0,0.15);`;
    document.body.appendChild(ghost);

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('touchend', onDragEnd);
  }

  function onDragMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    ghost.style.top = (clientY - offsetY) + 'px';

    // Find where to insert placeholder
    const items = [...grid.querySelectorAll('.col-check[data-col]')];
    let placed = false;
    for (const item of items) {
      const r = item.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) {
        grid.insertBefore(placeholder, item);
        placed = true;
        break;
      }
    }
    if (!placed) grid.appendChild(placeholder);
  }

  function onDragEnd(e) {
    if (!dragging) return;
    // Drop dragging before placeholder, then remove placeholder
    grid.insertBefore(dragging, placeholder);
    placeholder.remove();
    dragging.style.display = '';
    ghost.remove();

    dragging = null; ghost = null; placeholder = null;

    // Rebuild colOrder from DOM order
    colOrder = [...grid.querySelectorAll('.col-check[data-col]')].map(el => el.dataset.col);

    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.removeEventListener('touchend', onDragEnd);
  }
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
    chip.innerHTML = `${escapeHtml(name)} <span class="del" title="Delete preset">✕</span>`;
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
  const saved = presets[name];
  if (Array.isArray(saved)) {
    // Legacy format — just cols, no order
    selectedCols = new Set(saved.filter(c => allHeaders.includes(c)));
  } else {
    const restoredOrder = (saved.order || []).filter(c => allHeaders.includes(c));
    // Append any headers not in the saved order (new columns added since preset was saved)
    const inOrder = new Set(restoredOrder);
    allHeaders.forEach(h => { if (!inOrder.has(h)) restoredOrder.push(h); });
    colOrder = restoredOrder;
    selectedCols = new Set((saved.cols || []).filter(c => allHeaders.includes(c)));
  }
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
  // Save both selected cols and current order
  presets[name] = { cols: [...selectedCols], order: [...colOrder] };
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
  if (!Object.keys(db.rows).length) { showErr('gen-err', 'Database is empty — upload a CSV first.'); return; }
  if (!selectedCols.size) { showErr('gen-err', 'Select at least one column.'); return; }

  const adIdCol = findAdIdCol(allHeaders);
  const rawIds  = document.getElementById('ad-ids-input').value.trim();
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

  // Respect colOrder for column sequence
  const cols = colOrder.filter(h => selectedCols.has(h));
  const csvLines = [cols.map(csvCell).join(',')];
  filteredRows.forEach(r => csvLines.push(cols.map(c => csvCell(r[c] ?? '')).join(',')));
  generatedCSV  = csvLines.join('\n');
  generatedRows = filteredRows;
  generatedCols = cols;

  document.getElementById('badge-rows').textContent = `${filteredRows.length} row${filteredRows.length !== 1 ? 's' : ''}`;
  document.getElementById('badge-cols').textContent = `${cols.length} col${cols.length !== 1 ? 's' : ''}`;
  const missEl = document.getElementById('badge-missing');
  if (missingIds.length) { missEl.textContent = `${missingIds.length} missing`; missEl.style.display = 'inline'; }
  else missEl.style.display = 'none';

  renderTable(cols, filteredRows);
  renderRaw();
  const out = document.getElementById('output-section');
  out.classList.add('visible');
  switchTab(activeTab);
  out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showMissingIds(ids) {
  const box = document.getElementById('missing-ids-box');
  document.getElementById('missing-ids-chips').innerHTML =
    ids.map(id => `<span class="missing-id-chip">${escapeHtml(id)}</span>`).join('');
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

// ── COPY HELPERS ──
function buildTSV(includeHeaders) {
  const cols = generatedCols;
  const dataRows = generatedRows.map(r => cols.map(c => (r[c] ?? '').replace(/\t/g, ' ')).join('\t'));
  return includeHeaders ? [cols.join('\t'), ...dataRows].join('\n') : dataRows.join('\n');
}

function flashBtn(id, msg) {
  const btn = document.getElementById(id);
  const orig = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = orig; }, 1800);
}

function copyTable() {
  if (!generatedRows.length) return;
  navigator.clipboard.writeText(buildTSV(true)).then(() => flashBtn('copy-table-btn', '✓ Copied!'));
}

function copyTableNoHeaders() {
  if (!generatedRows.length) return;
  navigator.clipboard.writeText(buildTSV(false)).then(() => flashBtn('copy-no-headers-btn', '✓ Copied!'));
}

// ── DOWNLOAD OUTPUT CSV ──
function downloadCSV() {
  if (!generatedCSV) return;
  triggerDownload(generatedCSV, 'niktin-export.csv', 'text/csv');
}

// ── DB EXPORT ──
function exportDB() {
  triggerDownload(JSON.stringify(db, null, 2), 'niktin-database.json', 'application/json');
}

// ── DB IMPORT ──
document.getElementById('db-import-input').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!imported.rows || !imported.headers) { alert('Invalid Niktin database file.'); return; }
      const newHeaders = [...new Set([...db.headers, ...imported.headers])];
      db.headers = newHeaders; allHeaders = newHeaders;
      const existingSet = new Set(colOrder);
      newHeaders.forEach(h => { if (!existingSet.has(h)) colOrder.push(h); });
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
  if (!confirm('Clear the entire Niktin database? This cannot be undone.')) return;
  db = { rows: {}, headers: [], lastUpdated: null };
  allHeaders = []; selectedCols = new Set(); colOrder = [];
  saveDB();
  renderColGrid();
  renderPresetRow();
  document.getElementById('upload-status').classList.remove('visible');
  document.getElementById('output-section').classList.remove('visible');
}

// ── CLEAR OUTPUT ──
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
  colOrder = [...allHeaders];
  refreshDBPill();
  renderColGrid();
  renderPresetRow();
  selectedCols = new Set(allHeaders);
})();