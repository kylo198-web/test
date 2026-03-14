'use strict';

/* ============================================================
   RCN Offers Analyzer – main application script
   Specialised for: Działki Budowlane, Kraków
   ============================================================ */

// ── Column definitions for table ─────────────────────────────
const COLUMNS = [
  { key: 'data_transakcji',  label: 'Data transakcji' },
  { key: 'dzielnica',        label: 'Dzielnica' },
  { key: 'powierzchnia_m2',  label: 'Pow. (m²)',        num: true },
  { key: 'cena',             label: 'Cena (PLN)',        num: true, currency: true },
  { key: 'cena_za_m2',       label: 'Cena/m² (PLN)',    num: true, currency: true },
  { key: 'nabywca_typ',      label: 'Nabywca' },
  { key: 'forma_nabycia',    label: 'Forma nabycia' },
  { key: 'numer_repo',       label: 'Nr repozytorium' },
  { key: 'KW',               label: 'Nr KW' },
];

// ── App state ─────────────────────────────────────────────────
const state = {
  rawData:      [],
  filteredData: [],
  tableData:    [],
  page:         1,
  pageSize:     25,
  sortCol:      null,
  sortDir:      'asc',
  charts:       {},
  activeTab:    'dashboard',
};

// ── Sample data generator (realistic Kraków plots) ────────────
function generateSampleData(n = 250) {
  const districts = [
    'Krowodrza', 'Nowa Huta', 'Podgórze', 'Śródmieście',
    'Bronowice', 'Dębniki', 'Mistrzejowice', 'Bieżanów-Prokocim',
    'Swoszowice', 'Łagiewniki-Borek Fałęcki',
  ];
  // Approximate WGS84 bounding boxes per district [minLat, minLon, maxLat, maxLon]
  const districtBounds = {
    'Krowodrza':              [50.065, 19.90, 50.085, 19.95],
    'Nowa Huta':              [50.065, 20.02, 50.10,  20.12],
    'Podgórze':               [49.99,  19.90, 50.045, 19.98],
    'Śródmieście':            [50.055, 19.93, 50.075, 19.965],
    'Bronowice':              [50.07,  19.84, 50.10,  19.90],
    'Dębniki':                [50.025, 19.88, 50.065, 19.95],
    'Mistrzejowice':          [50.08,  19.98, 50.11,  20.04],
    'Bieżanów-Prokocim':      [50.00,  19.97, 50.04,  20.05],
    'Swoszowice':             [49.97,  19.92, 50.00,  19.99],
    'Łagiewniki-Borek Fałęcki': [50.01, 19.88, 50.045, 19.93],
  };
  const formy = ['Akt notarialny', 'Przetarg', 'Umowa warunkowa'];
  const basePricePerM2 = {
    'Śródmieście': 2200, 'Krowodrza': 1600, 'Dębniki': 1500,
    'Podgórze': 1400, 'Bronowice': 1300, 'Nowa Huta': 900,
    'Mistrzejowice': 1000, 'Bieżanów-Prokocim': 1100,
    'Swoszowice': 1000, 'Łagiewniki-Borek Fałęcki': 950,
  };

  const rows = [];
  const now  = new Date(2026, 2, 14);

  for (let i = 1; i <= n; i++) {
    const district   = districts[Math.floor(Math.random() * districts.length)];
    const bounds     = districtBounds[district];
    const lat        = bounds[0] + Math.random() * (bounds[2] - bounds[0]);
    const lon        = bounds[1] + Math.random() * (bounds[3] - bounds[1]);
    const area       = Math.round(300 + Math.random() * 2200);
    const pricePerM2 = Math.round((basePricePerM2[district] || 1000) * (0.80 + Math.random() * 0.4));
    const price      = Math.round(pricePerM2 * area);
    const daysAgo    = Math.floor(Math.random() * 730);
    const date       = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    const isPrawna   = Math.random() < 0.18;
    const repoNum    = `KR.${String(Math.floor(1000 + Math.random() * 9000))}.${date.getFullYear()}`;
    const kw         = isPrawna
      ? `KR1P/${String(Math.floor(10000 + Math.random() * 90000))}/0`
      : null;

    rows.push({
      data_transakcji: date.toISOString().slice(0, 10),
      dzielnica:       district,
      powierzchnia_m2: area,
      cena:            price,
      cena_za_m2:      pricePerM2,
      nabywca_typ:     isPrawna ? 'Osoba prawna' : 'Osoba fizyczna',
      forma_nabycia:   formy[Math.floor(Math.random() * formy.length)],
      numer_repo:      repoNum,
      KW:              kw,
      _lat:            lat,
      _lon:            lon,
    });
  }
  return rows;
}

// ── Formatting ─────────────────────────────────────────────────
function fmt(value, col) {
  if (value === null || value === undefined || value === '') return '—';
  if (col.currency) return Number(value).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
  if (col.num)      return Number(value).toLocaleString('pl-PL');
  return value;
}
function avg(arr)    { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── Status bar ─────────────────────────────────────────────────
function setStatus(msg, type = 'info') {
  const bar = document.getElementById('statusBar');
  bar.className = `status-bar${type === 'error' ? ' error' : type === 'success' ? ' success' : ''}`;
  bar.textContent = msg;
  bar.classList.remove('hidden');
  if (type === 'success') setTimeout(() => bar.classList.add('hidden'), 4000);
}
function clearStatus() { document.getElementById('statusBar').classList.add('hidden'); }

// ── KPIs ───────────────────────────────────────────────────────
function renderKPIs(data) {
  const prices  = data.map(r => r.cena).filter(Boolean);
  const pm2     = data.map(r => r.cena_za_m2).filter(Boolean);
  const areas   = data.map(r => r.powierzchnia_m2).filter(Boolean);
  const prawne  = data.filter(r => r.nabywca_typ === 'Osoba prawna').length;

  const kpis = [
    { label: 'Transakcje',         value: data.length.toLocaleString('pl-PL'),           sub: 'działki budowlane',    color: 'blue' },
    { label: 'Śred. cena',         value: fmtPLN(avg(prices)),                            sub: 'arytmetyczna',         color: 'green' },
    { label: 'Mediana ceny/m²',    value: fmtPLN(median(pm2)),                            sub: 'mediana',              color: 'orange' },
    { label: 'Śred. pow. działki', value: avg(areas).toLocaleString('pl-PL', { maximumFractionDigits: 0 }) + ' m²', sub: 'arytmetyczna', color: 'purple' },
    { label: 'Nabywcy prawni',     value: prawne.toLocaleString('pl-PL'),                 sub: ((prawne / data.length) * 100 || 0).toFixed(1) + '% transakcji', color: 'red' },
  ];

  document.getElementById('kpiGrid').innerHTML = kpis.map(k => `
    <div class="kpi-card kpi-card--${k.color}">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-sub">${k.sub}</div>
    </div>`).join('');
}
function fmtPLN(v) {
  return Number(v).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
}

// ── Charts ─────────────────────────────────────────────────────
const PALETTE = ['#1e6fd9','#12a05c','#e07b1a','#7c3aed','#d93b2b','#0891b2','#b45309','#be185d','#4338ca','#059669'];

function destroyChart(key) {
  if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
}

function renderCharts(data) {
  renderChartPriceTrend(data);
  renderChartPriceByDistrict(data);
  renderChartCountByDistrict(data);
  renderChartAreaDist(data);
  renderChartBuyerType(data);
}

function renderChartPriceTrend(data) {
  destroyChart('trend');
  const monthly = {};
  data.forEach(r => {
    if (!r.data_transakcji || !r.cena_za_m2) return;
    const m = r.data_transakcji.slice(0, 7);
    (monthly[m] = monthly[m] || []).push(r.cena_za_m2);
  });
  const labels = Object.keys(monthly).sort();
  const values = labels.map(l => Math.round(avg(monthly[l])));
  state.charts.trend = new Chart(document.getElementById('chartPriceTrend'), {
    type: 'line',
    data: {
      labels: labels.map(l => { const [y, m] = l.split('-'); return `${m}.${y}`; }),
      datasets: [{
        label: 'Śred. cena/m²',
        data: values,
        borderColor: PALETTE[0],
        backgroundColor: 'rgba(30,111,217,.08)',
        fill: true, tension: 0.35, pointRadius: 3,
      }],
    },
    options: chartOpts('PLN/m²'),
  });
}

function renderChartPriceByDistrict(data) {
  destroyChart('district');
  const g = {};
  data.forEach(r => { if (r.dzielnica && r.cena_za_m2) (g[r.dzielnica] = g[r.dzielnica] || []).push(r.cena_za_m2); });
  const labels = Object.keys(g).sort((a, b) => avg(g[b]) - avg(g[a]));
  const values = labels.map(l => Math.round(avg(g[l])));
  state.charts.district = new Chart(document.getElementById('chartPriceByDistrict'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Śred. cena/m²', data: values, backgroundColor: PALETTE[0], borderRadius: 6 }] },
    options: { ...chartOpts('PLN/m²'), plugins: { legend: { display: false } } },
  });
}

function renderChartCountByDistrict(data) {
  destroyChart('countd');
  const g = {};
  data.forEach(r => { if (r.dzielnica) g[r.dzielnica] = (g[r.dzielnica] || 0) + 1; });
  const labels = Object.keys(g).sort((a, b) => g[b] - g[a]);
  state.charts.countd = new Chart(document.getElementById('chartCountByDistrict'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Liczba', data: labels.map(l => g[l]), backgroundColor: PALETTE[1], borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } } },
  });
}

function renderChartAreaDist(data) {
  destroyChart('area');
  const buckets = [
    { label: '<300',       min: 0,    max: 300 },
    { label: '300–600',    min: 300,  max: 600 },
    { label: '600–1000',   min: 600,  max: 1000 },
    { label: '1000–1500',  min: 1000, max: 1500 },
    { label: '1500–2500',  min: 1500, max: 2500 },
    { label: '>2500',      min: 2500, max: Infinity },
  ];
  const counts = buckets.map(b => data.filter(r => r.powierzchnia_m2 >= b.min && r.powierzchnia_m2 < b.max).length);
  state.charts.area = new Chart(document.getElementById('chartAreaDist'), {
    type: 'bar',
    data: { labels: buckets.map(b => b.label + ' m²'), datasets: [{ label: 'Liczba', data: counts, backgroundColor: PALETTE[2], borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } } },
  });
}

function renderChartBuyerType(data) {
  destroyChart('buyer');
  const g = {};
  data.forEach(r => { if (r.nabywca_typ) g[r.nabywca_typ] = (g[r.nabywca_typ] || 0) + 1; });
  const labels = Object.keys(g);
  state.charts.buyer = new Chart(document.getElementById('chartBuyerType'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: labels.map(l => g[l]), backgroundColor: [PALETTE[0], PALETTE[4]], hoverOffset: 8 }] },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } },
  });
}

function chartOpts(unit) {
  return {
    responsive: true, maintainAspectRatio: true,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => ctx.parsed.y.toLocaleString('pl-PL') + ' ' + unit } },
    },
    scales: { y: { ticks: { callback: v => v.toLocaleString('pl-PL') } } },
  };
}

// ── Table ──────────────────────────────────────────────────────
function renderTableHead() {
  document.getElementById('offersTableHead').innerHTML = `<tr>${
    COLUMNS.map(c => `<th data-key="${c.key}">${c.label} <span class="sort-icon">↕</span></th>`).join('')
  }</tr>`;
  document.querySelectorAll('#offersTableHead th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      state.sortDir = state.sortCol === key && state.sortDir === 'asc' ? 'desc' : 'asc';
      state.sortCol = key;
      document.querySelectorAll('#offersTableHead th').forEach(t => { t.classList.remove('sorted'); t.querySelector('.sort-icon').textContent = '↕'; });
      th.classList.add('sorted');
      th.querySelector('.sort-icon').textContent = state.sortDir === 'asc' ? '↑' : '↓';
      state.page = 1;
      applyTableSort();
      renderTablePage();
    });
  });
}

function applyTableSort() {
  if (!state.sortCol) return;
  const col = COLUMNS.find(c => c.key === state.sortCol);
  state.tableData.sort((a, b) => {
    let va = a[state.sortCol], vb = b[state.sortCol];
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    if (col && col.num) { va = Number(va); vb = Number(vb); }
    else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
    return state.sortDir === 'asc' ? (va > vb ? 1 : va < vb ? -1 : 0) : (va < vb ? 1 : va > vb ? -1 : 0);
  });
}

function renderTablePage() {
  const { page, pageSize, tableData } = state;
  const start = (page - 1) * pageSize;
  const slice = tableData.slice(start, start + pageSize);

  document.getElementById('tableCount').textContent = tableData.length.toLocaleString('pl-PL');
  document.getElementById('offersTableBody').innerHTML = slice.map(row => `<tr>${
    COLUMNS.map(c => {
      const val = row[c.key];
      if (c.key === 'nabywca_typ') {
        const isPrawna = val && val.includes('prawna');
        return `<td><span class="pill ${isPrawna ? 'pill--red' : 'pill--blue'}">${val || '—'}</span></td>`;
      }
      if (c.key === 'KW' && val) return `<td><strong>${val}</strong></td>`;
      return `<td>${fmt(val, c)}</td>`;
    }).join('')
  }</tr>`).join('') || `<tr><td colspan="${COLUMNS.length}" style="text-align:center;padding:32px;color:#9ca3af">Brak danych</td></tr>`;

  renderPagination();
}

function renderPagination() {
  const { page, pageSize, tableData } = state;
  const total      = tableData.length;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const start      = Math.min((page - 1) * pageSize + 1, total);
  const end        = Math.min(page * pageSize, total);

  const btns = [`<button class="pg-btn" id="pgPrev" ${page === 1 ? 'disabled' : ''}>‹</button>`];
  paginationRange(page, totalPages).forEach(p => {
    if (p === '…') { btns.push(`<span style="padding:0 4px;line-height:32px">…</span>`); return; }
    btns.push(`<button class="pg-btn${p === page ? ' active' : ''}" data-page="${p}">${p}</button>`);
  });
  btns.push(`<button class="pg-btn" id="pgNext" ${page === totalPages ? 'disabled' : ''}>›</button>`);

  document.getElementById('pagination').innerHTML = `
    <span>${start}–${end} z ${total.toLocaleString('pl-PL')}</span>
    <div class="pagination-btns">${btns.join('')}</div>
    <span>Strona ${page} z ${totalPages}</span>`;

  document.getElementById('pgPrev').addEventListener('click', () => { state.page--; renderTablePage(); });
  document.getElementById('pgNext').addEventListener('click', () => { state.page++; renderTablePage(); });
  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => { state.page = Number(btn.dataset.page); renderTablePage(); });
  });
}

function paginationRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const p = [1];
  if (current > 3) p.push('…');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) p.push(i);
  if (current < total - 2) p.push('…');
  p.push(total);
  return p;
}

// ── Filters ────────────────────────────────────────────────────
function populateFilterOptions(data) {
  const districts = [...new Set(data.map(r => r.dzielnica).filter(Boolean))].sort();
  document.getElementById('filterDistrict').innerHTML = districts.map(d => `<option value="${d}">${d}</option>`).join('');
}

function getSelected(id) { return [...document.getElementById(id).selectedOptions].map(o => o.value); }

function applyFilters() {
  const districts  = getSelected('filterDistrict');
  const buyer      = document.getElementById('filterBuyer').value;
  const prMin      = Number(document.getElementById('filterPriceMin').value) || 0;
  const prMax      = Number(document.getElementById('filterPriceMax').value) || Infinity;
  const arMin      = Number(document.getElementById('filterAreaMin').value)  || 0;
  const arMax      = Number(document.getElementById('filterAreaMax').value)  || Infinity;
  const dateFrom   = document.getElementById('filterDateFrom').value;
  const dateTo     = document.getElementById('filterDateTo').value;

  state.filteredData = state.rawData.filter(r => {
    if (districts.length && !districts.includes(r.dzielnica)) return false;
    if (buyer && r.nabywca_typ !== buyer) return false;
    if (r.cena && (r.cena < prMin || r.cena > prMax)) return false;
    if (r.powierzchnia_m2 && (r.powierzchnia_m2 < arMin || r.powierzchnia_m2 > arMax)) return false;
    if (dateFrom && r.data_transakcji < dateFrom) return false;
    if (dateTo   && r.data_transakcji > dateTo)   return false;
    return true;
  });

  state.tableData = [...state.filteredData];
  state.page = 1;
  applyTableSort();
  renderKPIs(state.filteredData);
  renderCharts(state.filteredData);
  renderTablePage();
  loadMapData(state.filteredData);
}

function resetFilters() {
  ['filterDistrict'].forEach(id => { document.getElementById(id).selectedIndex = -1; });
  ['filterBuyer','filterPriceMin','filterPriceMax','filterAreaMin','filterAreaMax',
   'filterDateFrom','filterDateTo','tableSearch'].forEach(id => {
    document.getElementById(id).value = '';
  });
  state.filteredData = [...state.rawData];
  state.tableData    = [...state.rawData];
  state.page = 1;
  applyTableSort();
  renderKPIs(state.rawData);
  renderCharts(state.rawData);
  renderTablePage();
  loadMapData(state.rawData);
}

// ── Search ─────────────────────────────────────────────────────
function applySearch(query) {
  const q = query.toLowerCase().trim();
  state.tableData = q
    ? state.filteredData.filter(r => COLUMNS.some(c => String(r[c.key] ?? '').toLowerCase().includes(q)))
    : [...state.filteredData];
  state.page = 1;
  applyTableSort();
  renderTablePage();
}

// ── Export CSV ─────────────────────────────────────────────────
function exportCSV() {
  const header = COLUMNS.map(c => c.label).join(',');
  const rows   = state.tableData.map(r =>
    COLUMNS.map(c => { const v = r[c.key] ?? ''; return String(v).includes(',') ? `"${v}"` : v; }).join(',')
  );
  const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a    = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'rcn_dzialki_krakow.csv' });
  a.click();
}

// ── Load data into app ─────────────────────────────────────────
function loadData(data, sourceLabel) {
  if (!Array.isArray(data) || !data.length) { setStatus('Plik nie zawiera danych.', 'error'); return; }

  // Normalize numerics
  data.forEach(r => {
    ['cena','cena_za_m2','powierzchnia_m2'].forEach(k => {
      if (r[k] != null && r[k] !== '') r[k] = Number(r[k]);
    });
    if (!r.cena_za_m2 && r.cena && r.powierzchnia_m2) {
      r.cena_za_m2 = Math.round(r.cena / r.powierzchnia_m2);
    }
  });

  state.rawData      = data;
  state.filteredData = [...data];
  state.tableData    = [...data];
  state.page         = 1;
  state.sortCol      = null;
  state.sortDir      = 'asc';

  document.getElementById('emptyState').classList.add('hidden');
  document.querySelector('.tabs-bar').parentElement; // header already visible

  // Show all tab-content sections (they toggle via tab logic)
  showTab('dashboard');

  populateFilterOptions(data);
  renderKPIs(data);
  renderCharts(data);
  renderTableHead();
  renderTablePage();
  loadMapData(data);

  setStatus(`✓ Załadowano ${data.length.toLocaleString('pl-PL')} transakcji (${sourceLabel})`, 'success');
}

// ── Tab navigation ─────────────────────────────────────────────
function showTab(name) {
  state.activeTab = name;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.add('hidden'));

  const tabMap = { dashboard: 'tabDashboard', map: 'tabMap', table: 'tabTable' };
  const el = document.getElementById(tabMap[name]);
  if (el) el.classList.remove('hidden');

  // Invalidate Leaflet map size when switching to map tab
  if (name === 'map' && mapState.map) {
    setTimeout(() => mapState.map.invalidateSize(), 50);
  }
}

// ── File import ────────────────────────────────────────────────
function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    if (file.name.endsWith('.json')) {
      try { loadData(JSON.parse(text), file.name); } catch { setStatus('Błąd parsowania JSON.', 'error'); }
    } else {
      const res = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: true });
      loadData(res.data, file.name);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

// ── Fetch live data from GUGiK WFS ────────────────────────────
async function fetchLiveData() {
  const btn = document.getElementById('btnFetchRCN');
  btn.disabled = true;
  btn.textContent = '⏳ Pobieranie…';
  setStatus('Łączenie z serwisem GUGiK RCN (WFS)…');

  await tryFetchLiveData(
    (records, endpoint) => {
      loadData(records, `GUGiK WFS (${endpoint.typeName})`);
      btn.disabled = false;
      btn.innerHTML = '<span id="fetchIcon">⬇</span> Pobierz dane z GUGiK';
    },
    (errMsg) => {
      setStatus(errMsg + ' Załadowano dane demonstracyjne.', 'error');
      loadData(generateSampleData(250), 'dane demonstracyjne (GUGiK niedostępny)');
      btn.disabled = false;
      btn.innerHTML = '<span id="fetchIcon">⬇</span> Pobierz dane z GUGiK';
    },
    (statusMsg) => setStatus(statusMsg),
  );
}

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.rawData.length === 0) return; // no data yet
      showTab(btn.dataset.tab);
    });
  });

  // File inputs
  ['fileInput', 'fileInput2'].forEach(id => {
    document.getElementById(id).addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });
  });

  // Fetch live
  document.getElementById('btnFetchRCN').addEventListener('click', fetchLiveData);
  document.getElementById('btnFetchRCNBig').addEventListener('click', fetchLiveData);

  // Sample data
  document.getElementById('btnLoadSample').addEventListener('click', () => loadData(generateSampleData(250), 'dane demonstracyjne'));
  document.getElementById('btnLoadSampleBig').addEventListener('click', () => loadData(generateSampleData(250), 'dane demonstracyjne'));

  // Filters
  document.getElementById('btnApplyFilters').addEventListener('click', applyFilters);
  document.getElementById('btnResetFilters').addEventListener('click', resetFilters);

  // Map filter
  document.getElementById('btnApplyMapFilters').addEventListener('click', applyMapFilter);

  // Table search
  let searchTimer;
  document.getElementById('tableSearch').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applySearch(e.target.value), 250);
  });

  // Export
  document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
});
