'use strict';

/* ============================================================
   RCN Offers Analyzer – main application script
   ============================================================ */

// ── State ────────────────────────────────────────────────────
const state = {
  rawData:      [],   // full dataset
  filteredData: [],   // after filters
  tableData:    [],   // after search + sort
  page:         1,
  pageSize:     20,
  sortCol:      null,
  sortDir:      'asc',
  charts:       {},
};

// ── Column definitions ────────────────────────────────────────
const COLUMNS = [
  { key: 'id',                   label: 'ID' },
  { key: 'data_oferty',          label: 'Data oferty' },
  { key: 'typ_nieruchomosci',    label: 'Typ' },
  { key: 'wojewodztwo',          label: 'Województwo' },
  { key: 'miasto',               label: 'Miasto' },
  { key: 'dzielnica',            label: 'Dzielnica' },
  { key: 'powierzchnia_m2',      label: 'Pow. (m²)',       num: true },
  { key: 'cena',                 label: 'Cena (PLN)',       num: true, currency: true },
  { key: 'cena_za_m2',           label: 'Cena/m² (PLN)',   num: true, currency: true },
  { key: 'liczba_pokoi',         label: 'Pokoje',           num: true },
  { key: 'rok_budowy',           label: 'Rok budowy',       num: true },
  { key: 'stan_techniczny',      label: 'Stan' },
];

// ── Sample data generator ─────────────────────────────────────
function generateSampleData(n = 300) {
  const types = ['Mieszkanie', 'Dom', 'Działka', 'Lokal użytkowy', 'Garaż'];
  const voivodeships = [
    'Mazowieckie', 'Małopolskie', 'Śląskie', 'Wielkopolskie',
    'Dolnośląskie', 'Łódzkie', 'Pomorskie', 'Lubelskie',
  ];
  const cities = {
    'Mazowieckie':   ['Warszawa', 'Radom', 'Płock'],
    'Małopolskie':   ['Kraków', 'Nowy Sącz', 'Tarnów'],
    'Śląskie':       ['Katowice', 'Gliwice', 'Bytom'],
    'Wielkopolskie': ['Poznań', 'Kalisz', 'Konin'],
    'Dolnośląskie':  ['Wrocław', 'Legnica', 'Wałbrzych'],
    'Łódzkie':       ['Łódź', 'Piotrków Trybunalski', 'Skierniewice'],
    'Pomorskie':     ['Gdańsk', 'Gdynia', 'Sopot'],
    'Lubelskie':     ['Lublin', 'Zamość', 'Chełm'],
  };
  const districts = ['Centrum', 'Śródmieście', 'Praga', 'Wola', 'Mokotów', 'Krowodrza', 'Nowa Huta', 'Ligota'];
  const conditions = ['Bardzo dobry', 'Dobry', 'Do remontu', 'Nowy', 'W budowie'];
  const basePrices = {
    'Mieszkanie': 8500, 'Dom': 6000, 'Działka': 300,
    'Lokal użytkowy': 7000, 'Garaż': 3000,
  };

  const rows = [];
  const now = new Date(2026, 2, 14);
  for (let i = 1; i <= n; i++) {
    const type = types[Math.floor(Math.random() * types.length)];
    const voiv = voivodeships[Math.floor(Math.random() * voivodeships.length)];
    const cityList = cities[voiv];
    const city = cityList[Math.floor(Math.random() * cityList.length)];
    const area = type === 'Działka'
      ? Math.round(300 + Math.random() * 2000)
      : type === 'Garaż'
        ? Math.round(15 + Math.random() * 20)
        : Math.round(25 + Math.random() * 175);
    const basePrice = basePrices[type];
    const cityMultiplier = city === 'Warszawa' ? 1.6 : city === 'Kraków' ? 1.35 : city === 'Wrocław' ? 1.3 : city === 'Gdańsk' ? 1.25 : 1.0;
    const pricePerM2 = Math.round((basePrice * cityMultiplier * (0.85 + Math.random() * 0.3)));
    const price = Math.round(pricePerM2 * area);
    const daysAgo = Math.floor(Math.random() * 730);
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    const rooms = type === 'Mieszkanie' ? Math.min(Math.ceil(area / 25), 6) : type === 'Dom' ? Math.min(Math.ceil(area / 30), 8) : null;

    rows.push({
      id:                 i,
      data_oferty:        date.toISOString().slice(0, 10),
      typ_nieruchomosci:  type,
      wojewodztwo:        voiv,
      miasto:             city,
      dzielnica:          districts[Math.floor(Math.random() * districts.length)],
      powierzchnia_m2:    area,
      cena:               price,
      cena_za_m2:         pricePerM2,
      liczba_pokoi:       rooms,
      rok_budowy:         rooms ? Math.round(1950 + Math.random() * 74) : null,
      stan_techniczny:    conditions[Math.floor(Math.random() * conditions.length)],
    });
  }
  return rows;
}

// ── Formatting helpers ────────────────────────────────────────
function fmt(value, col) {
  if (value === null || value === undefined || value === '') return '—';
  if (col.currency) return Number(value).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
  if (col.num)      return Number(value).toLocaleString('pl-PL');
  return value;
}

function condPill(val) {
  if (!val) return '—';
  const map = { 'Nowy': 'green', 'Bardzo dobry': 'green', 'Dobry': 'blue', 'Do remontu': 'orange', 'W budowie': 'gray' };
  const cls = map[val] || 'gray';
  return `<span class="pill pill--${cls}">${val}</span>`;
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── KPIs ─────────────────────────────────────────────────────
function renderKPIs(data) {
  const prices   = data.map(r => r.cena).filter(Boolean);
  const priceM2  = data.map(r => r.cena_za_m2).filter(Boolean);
  const areas    = data.map(r => r.powierzchnia_m2).filter(Boolean);

  const kpis = [
    { label: 'Liczba ofert',          value: data.length.toLocaleString('pl-PL'),              sub: 'w bazie',             color: 'blue' },
    { label: 'Śred. cena',            value: avg(prices).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }), sub: 'arytmetyczna', color: 'green' },
    { label: 'Mediana ceny/m²',       value: median(priceM2).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }), sub: 'mediana', color: 'orange' },
    { label: 'Śred. pow.',            value: avg(areas).toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + ' m²', sub: 'arytmetyczna', color: 'purple' },
    { label: 'Maks. cena',            value: Math.max(...prices).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }), sub: 'najdroższa oferta', color: 'red' },
  ];

  document.getElementById('kpiGrid').innerHTML = kpis.map(k => `
    <div class="kpi-card kpi-card--${k.color}">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-sub">${k.sub}</div>
    </div>
  `).join('');
}

// ── Charts ───────────────────────────────────────────────────
const PALETTE = [
  '#1e6fd9','#12a05c','#e07b1a','#7c3aed','#d93b2b',
  '#0891b2','#b45309','#be185d','#4338ca','#059669',
];

function destroyChart(key) {
  if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
}

function renderCharts(data) {
  renderChartPriceByVoivodeship(data);
  renderChartOffersByType(data);
  renderChartPriceTrend(data);
  renderChartAreaDist(data);
  renderChartCondition(data);
}

function renderChartPriceByVoivodeship(data) {
  destroyChart('voiv');
  const groups = {};
  data.forEach(r => {
    if (!r.wojewodztwo || !r.cena_za_m2) return;
    (groups[r.wojewodztwo] = groups[r.wojewodztwo] || []).push(r.cena_za_m2);
  });
  const labels = Object.keys(groups).sort();
  const values = labels.map(l => Math.round(avg(groups[l])));
  state.charts.voiv = new Chart(document.getElementById('chartPriceByVoivodeship'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Śred. cena/m² (PLN)', data: values, backgroundColor: PALETTE[0], borderRadius: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.parsed.y.toLocaleString('pl-PL') + ' PLN/m²' } } },
      scales: { y: { ticks: { callback: v => v.toLocaleString('pl-PL') } } },
    },
  });
}

function renderChartOffersByType(data) {
  destroyChart('type');
  const counts = {};
  data.forEach(r => { counts[r.typ_nieruchomosci] = (counts[r.typ_nieruchomosci] || 0) + 1; });
  const labels = Object.keys(counts);
  const values = labels.map(l => counts[l]);
  state.charts.type = new Chart(document.getElementById('chartOffersByType'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: PALETTE.slice(0, labels.length), hoverOffset: 8 }],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { position: 'right' } },
    },
  });
}

function renderChartPriceTrend(data) {
  destroyChart('trend');
  // Group by month
  const monthly = {};
  data.forEach(r => {
    if (!r.data_oferty || !r.cena_za_m2) return;
    const month = r.data_oferty.slice(0, 7); // YYYY-MM
    (monthly[month] = monthly[month] || []).push(r.cena_za_m2);
  });
  const labels = Object.keys(monthly).sort();
  const values = labels.map(l => Math.round(avg(monthly[l])));
  state.charts.trend = new Chart(document.getElementById('chartPriceTrend'), {
    type: 'line',
    data: {
      labels: labels.map(l => { const [y, m] = l.split('-'); return `${m}.${y}`; }),
      datasets: [{
        label: 'Śred. cena/m² (PLN)',
        data: values,
        borderColor: PALETTE[0],
        backgroundColor: 'rgba(30,111,217,.08)',
        fill: true,
        tension: 0.35,
        pointRadius: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.parsed.y.toLocaleString('pl-PL') + ' PLN/m²' } } },
      scales: { y: { ticks: { callback: v => v.toLocaleString('pl-PL') } } },
    },
  });
}

function renderChartAreaDist(data) {
  destroyChart('area');
  const buckets = [
    { label: '<30', min: 0,   max: 30 },
    { label: '30–50', min: 30,  max: 50 },
    { label: '50–80', min: 50,  max: 80 },
    { label: '80–120', min: 80,  max: 120 },
    { label: '120–200', min: 120, max: 200 },
    { label: '>200', min: 200, max: Infinity },
  ];
  const counts = buckets.map(b => data.filter(r => r.powierzchnia_m2 >= b.min && r.powierzchnia_m2 < b.max).length);
  state.charts.area = new Chart(document.getElementById('chartAreaDist'), {
    type: 'bar',
    data: {
      labels: buckets.map(b => b.label + ' m²'),
      datasets: [{ label: 'Liczba ofert', data: counts, backgroundColor: PALETTE[2], borderRadius: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });
}

function renderChartCondition(data) {
  destroyChart('cond');
  const counts = {};
  data.forEach(r => { if (r.stan_techniczny) counts[r.stan_techniczny] = (counts[r.stan_techniczny] || 0) + 1; });
  const labels = Object.keys(counts);
  const values = labels.map(l => counts[l]);
  state.charts.cond = new Chart(document.getElementById('chartCondition'), {
    type: 'pie',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: [PALETTE[1], PALETTE[0], PALETTE[2], PALETTE[6], PALETTE[3]] }],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { position: 'right' } },
    },
  });
}

// ── Table ────────────────────────────────────────────────────
function renderTableHead() {
  document.getElementById('offersTableHead').innerHTML = `<tr>${
    COLUMNS.map(c => `<th data-key="${c.key}">${c.label} <span class="sort-icon">↕</span></th>`).join('')
  }</tr>`;
  document.querySelectorAll('#offersTableHead th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (state.sortCol === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortCol = key;
        state.sortDir = 'asc';
      }
      document.querySelectorAll('#offersTableHead th').forEach(t => t.classList.remove('sorted'));
      th.classList.add('sorted');
      th.querySelector('.sort-icon').textContent = state.sortDir === 'asc' ? '↑' : '↓';
      state.page = 1;
      applyTableSort();
      renderTablePage();
    });
  });
}

function applyTableSort() {
  const { sortCol, sortDir } = state;
  if (!sortCol) return;
  const col = COLUMNS.find(c => c.key === sortCol);
  state.tableData.sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol];
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    if (col && col.num) { va = Number(va); vb = Number(vb); }
    else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
    return sortDir === 'asc' ? (va > vb ? 1 : va < vb ? -1 : 0) : (va < vb ? 1 : va > vb ? -1 : 0);
  });
}

function renderTablePage() {
  const { page, pageSize, tableData } = state;
  const start = (page - 1) * pageSize;
  const slice = tableData.slice(start, start + pageSize);

  document.getElementById('tableCount').textContent = tableData.length.toLocaleString('pl-PL');
  document.getElementById('offersTableBody').innerHTML = slice.map(row => `
    <tr>${COLUMNS.map(c => {
      const val = row[c.key];
      if (c.key === 'stan_techniczny') return `<td>${condPill(val)}</td>`;
      return `<td>${fmt(val, c)}</td>`;
    }).join('')}</tr>
  `).join('') || '<tr><td colspan="' + COLUMNS.length + '" style="text-align:center;padding:32px;color:#9ca3af">Brak danych</td></tr>';

  renderPagination();
}

function renderPagination() {
  const { page, pageSize, tableData } = state;
  const total = tableData.length;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const start = Math.min((page - 1) * pageSize + 1, total);
  const end   = Math.min(page * pageSize, total);

  const btns = [];
  btns.push(`<button class="pg-btn" id="pgPrev" ${page === 1 ? 'disabled' : ''}>‹</button>`);
  const range = paginationRange(page, totalPages);
  range.forEach(p => {
    if (p === '…') { btns.push(`<span style="padding:0 4px;line-height:32px">…</span>`); return; }
    btns.push(`<button class="pg-btn${p === page ? ' active' : ''}" data-page="${p}">${p}</button>`);
  });
  btns.push(`<button class="pg-btn" id="pgNext" ${page === totalPages ? 'disabled' : ''}>›</button>`);

  document.getElementById('pagination').innerHTML = `
    <span>${start}–${end} z ${total.toLocaleString('pl-PL')}</span>
    <div class="pagination-btns">${btns.join('')}</div>
    <span>Strona ${page} z ${totalPages}</span>
  `;

  document.getElementById('pgPrev').addEventListener('click', () => { state.page--; renderTablePage(); });
  document.getElementById('pgNext').addEventListener('click', () => { state.page++; renderTablePage(); });
  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => { state.page = Number(btn.dataset.page); renderTablePage(); });
  });
}

function paginationRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  pages.push(1);
  if (current > 3) pages.push('…');
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push('…');
  pages.push(total);
  return pages;
}

// ── Search ───────────────────────────────────────────────────
function applySearch(query) {
  const q = query.toLowerCase().trim();
  state.tableData = q
    ? state.filteredData.filter(r => COLUMNS.some(c => String(r[c.key] ?? '').toLowerCase().includes(q)))
    : [...state.filteredData];
  state.page = 1;
  applyTableSort();
  renderTablePage();
}

// ── Filters ──────────────────────────────────────────────────
function populateFilterOptions(data) {
  const types = [...new Set(data.map(r => r.typ_nieruchomosci).filter(Boolean))].sort();
  const voivs = [...new Set(data.map(r => r.wojewodztwo).filter(Boolean))].sort();
  document.getElementById('filterType').innerHTML = types.map(t => `<option value="${t}">${t}</option>`).join('');
  document.getElementById('filterVoivodeship').innerHTML = voivs.map(v => `<option value="${v}">${v}</option>`).join('');
}

function getSelectedOptions(selectEl) {
  return [...selectEl.selectedOptions].map(o => o.value);
}

function applyFilters() {
  const types = getSelectedOptions(document.getElementById('filterType'));
  const voivs = getSelectedOptions(document.getElementById('filterVoivodeship'));
  const prMin = Number(document.getElementById('filterPriceMin').value) || 0;
  const prMax = Number(document.getElementById('filterPriceMax').value) || Infinity;
  const arMin = Number(document.getElementById('filterAreaMin').value)  || 0;
  const arMax = Number(document.getElementById('filterAreaMax').value)  || Infinity;

  state.filteredData = state.rawData.filter(r => {
    if (types.length && !types.includes(r.typ_nieruchomosci)) return false;
    if (voivs.length && !voivs.includes(r.wojewodztwo))       return false;
    if (r.cena && (r.cena < prMin || r.cena > prMax))         return false;
    if (r.powierzchnia_m2 && (r.powierzchnia_m2 < arMin || r.powierzchnia_m2 > arMax)) return false;
    return true;
  });

  state.page = 1;
  state.tableData = [...state.filteredData];
  applyTableSort();
  renderKPIs(state.filteredData);
  renderCharts(state.filteredData);
  renderTablePage();
}

function resetFilters() {
  document.getElementById('filterType').selectedIndex = -1;
  document.getElementById('filterVoivodeship').selectedIndex = -1;
  ['filterPriceMin','filterPriceMax','filterAreaMin','filterAreaMax','tableSearch'].forEach(id => {
    document.getElementById(id).value = '';
  });
  state.filteredData = [...state.rawData];
  state.tableData    = [...state.rawData];
  state.page = 1;
  applyTableSort();
  renderKPIs(state.rawData);
  renderCharts(state.rawData);
  renderTablePage();
}

// ── CSV Export ───────────────────────────────────────────────
function exportCSV() {
  const header = COLUMNS.map(c => c.label).join(',');
  const rows   = state.tableData.map(r => COLUMNS.map(c => {
    const v = r[c.key] ?? '';
    return typeof v === 'string' && v.includes(',') ? `"${v}"` : v;
  }).join(','));
  const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'rcn_oferty.csv' });
  a.click();
  URL.revokeObjectURL(url);
}

// ── File import ──────────────────────────────────────────────
function parseAndLoad(data) {
  if (!Array.isArray(data) || !data.length) { alert('Plik nie zawiera danych.'); return; }
  // Normalize numeric fields
  data.forEach(r => {
    ['cena','cena_za_m2','powierzchnia_m2','liczba_pokoi','rok_budowy'].forEach(k => {
      if (r[k] !== null && r[k] !== undefined && r[k] !== '') r[k] = Number(r[k]);
    });
    // Auto-compute cena_za_m2 if missing
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
  document.getElementById('dashboard').classList.remove('hidden');

  populateFilterOptions(data);
  renderKPIs(data);
  renderCharts(data);
  renderTableHead();
  renderTablePage();
}

function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    if (file.name.endsWith('.json')) {
      try { parseAndLoad(JSON.parse(text)); } catch { alert('Błąd parsowania JSON.'); }
    } else {
      const result = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: true });
      parseAndLoad(result.data);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

// ── Bootstrap ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // File inputs
  ['fileInput', 'fileInput2'].forEach(id => {
    document.getElementById(id).addEventListener('change', e => {
      handleFile(e.target.files[0]);
      e.target.value = '';
    });
  });

  // Sample data buttons
  ['btnLoadSample', 'btnLoadSampleBig'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => parseAndLoad(generateSampleData(300)));
  });

  // Filter buttons
  document.getElementById('btnApplyFilters').addEventListener('click', applyFilters);
  document.getElementById('btnResetFilters').addEventListener('click', resetFilters);

  // Search
  let searchTimer;
  document.getElementById('tableSearch').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applySearch(e.target.value), 250);
  });

  // Export
  document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
});
