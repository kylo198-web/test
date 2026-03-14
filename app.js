'use strict';
/* ============================================================
   RCN Offers Analyzer – Bieżanów-Prokocim, Kraków
   ============================================================ */

// ── Columns ───────────────────────────────────────────────────
const COLUMNS = [
  { key: 'data_transakcji',  label: 'Data transakcji' },
  { key: 'rodzaj',           label: 'Rodzaj' },
  { key: 'ulica',            label: 'Ulica' },
  { key: 'numer_dzialki',    label: 'Nr działki' },
  { key: 'powierzchnia_m2',  label: 'Pow. m²',       num: true },
  { key: 'cena',             label: 'Cena PLN',       num: true, currency: true },
  { key: 'cena_za_m2',       label: 'Cena/m² PLN',   num: true, currency: true },
  { key: 'nabywca_typ',      label: 'Nabywca' },
  { key: 'forma_nabycia',    label: 'Forma nabycia' },
  { key: 'numer_repo',       label: 'Nr repozytorium' },
  { key: 'KW',               label: 'Nr KW' },
];

// ── State ─────────────────────────────────────────────────────
const state = {
  raw:      [],
  filtered: [],
  table:    [],
  page:     1,
  pageSize: 25,
  sortCol:  null,
  sortDir:  'asc',
  charts:   {},
};

// ── Helpers ───────────────────────────────────────────────────
const fmtPLN = v => v != null ? Number(v).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }) : '—';
const fmtNum = v => v != null ? Number(v).toLocaleString('pl-PL') : '—';
const avg    = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const median = arr => { if (!arr.length) return 0; const s = [...arr].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2 ? s[m] : (s[m-1]+s[m])/2; };

function fmtCell(v, col) {
  if (v === null || v === undefined || v === '') return '—';
  if (col.currency) return fmtPLN(v);
  if (col.num) return fmtNum(v);
  return v;
}

// ── Status bar ────────────────────────────────────────────────
function setStatus(msg, type) {
  const el = document.getElementById('statusBar');
  el.className = 'status-bar' + (type === 'error' ? ' error' : type === 'success' ? ' success' : '');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 5000);
}

// ── KPIs ──────────────────────────────────────────────────────
function renderKPIs(data) {
  const prices = data.map(r => r.cena).filter(Boolean);
  const pm2    = data.map(r => r.cena_za_m2).filter(Boolean);
  const areas  = data.map(r => r.powierzchnia_m2).filter(Boolean);
  const prawne = data.filter(r => r.nabywca_typ === 'Osoba prawna').length;
  document.getElementById('kpiGrid').innerHTML = [
    { label: 'Transakcje',      value: data.length.toLocaleString('pl-PL'), sub: 'łącznie',            color: 'blue' },
    { label: 'Śred. cena',      value: fmtPLN(avg(prices)),                  sub: 'arytmetyczna',       color: 'green' },
    { label: 'Mediana cena/m²', value: fmtPLN(median(pm2)),                  sub: 'mediana',            color: 'orange' },
    { label: 'Śred. pow.',      value: avg(areas).toLocaleString('pl-PL', {maximumFractionDigits:0}) + ' m²', sub: 'arytmetyczna', color: 'purple' },
    { label: 'Osoby prawne',    value: prawne.toLocaleString('pl-PL'),        sub: ((prawne/data.length||0)*100).toFixed(1)+'%', color: 'red' },
  ].map(k => `<div class="kpi-card kpi-card--${k.color}">
    <div class="kpi-label">${k.label}</div>
    <div class="kpi-value">${k.value}</div>
    <div class="kpi-sub">${k.sub}</div>
  </div>`).join('');
}

// ── Charts ────────────────────────────────────────────────────
const PAL = ['#1e6fd9','#12a05c','#e07b1a','#7c3aed','#d93b2b','#0891b2','#b45309','#be185d'];
function destroyChart(k) { if (state.charts[k]) { state.charts[k].destroy(); delete state.charts[k]; } }
function baseOpts(unit) {
  return {
    responsive: true, maintainAspectRatio: true,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y.toLocaleString('pl-PL') + ' ' + unit } } },
    scales:  { y: { ticks: { callback: v => v.toLocaleString('pl-PL') } } },
  };
}

function renderCharts(data) {
  // Trend
  destroyChart('trend');
  const mo = {};
  data.forEach(r => { if (r.data_transakcji && r.cena_za_m2) { const m = r.data_transakcji.slice(0,7); (mo[m]=mo[m]||[]).push(r.cena_za_m2); } });
  const mkeys = Object.keys(mo).sort();
  state.charts.trend = new Chart(document.getElementById('chartPriceTrend'), {
    type: 'line',
    data: { labels: mkeys.map(l => l.slice(5)+'.'+l.slice(0,4)), datasets: [{ label: 'Śred. cena/m²', data: mkeys.map(l => Math.round(avg(mo[l]))), borderColor: PAL[0], backgroundColor: 'rgba(30,111,217,.08)', fill: true, tension: 0.35, pointRadius: 3 }] },
    options: baseOpts('PLN/m²'),
  });

  // Price by street
  destroyChart('street');
  const sg = {};
  data.forEach(r => { if (r.ulica && r.cena_za_m2) (sg[r.ulica]=sg[r.ulica]||[]).push(r.cena_za_m2); });
  const slabs = Object.keys(sg).sort((a,b) => avg(sg[b])-avg(sg[a])).slice(0, 12);
  state.charts.street = new Chart(document.getElementById('chartPriceByStreet'), {
    type: 'bar',
    data: { labels: slabs, datasets: [{ data: slabs.map(l => Math.round(avg(sg[l]))), backgroundColor: PAL[0], borderRadius: 5 }] },
    options: { ...baseOpts('PLN/m²'), plugins: { legend: { display: false }, tooltip: baseOpts('PLN/m²').plugins.tooltip } },
  });

  // Area distribution
  destroyChart('area');
  const buckets = [['<300',0,300],['300–600',300,600],['600–1k',600,1000],['1k–2k',1000,2000],['>2k',2000,Infinity]];
  state.charts.area = new Chart(document.getElementById('chartAreaDist'), {
    type: 'bar',
    data: { labels: buckets.map(b=>b[0]+' m²'), datasets: [{ data: buckets.map(([,mn,mx]) => data.filter(r=>r.powierzchnia_m2>=mn&&r.powierzchnia_m2<mx).length), backgroundColor: PAL[2], borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } } },
  });

  // Buyer type
  destroyChart('buyer');
  const bg = {};
  data.forEach(r => { if (r.nabywca_typ) bg[r.nabywca_typ]=(bg[r.nabywca_typ]||0)+1; });
  const bkeys = Object.keys(bg);
  state.charts.buyer = new Chart(document.getElementById('chartBuyerType'), {
    type: 'doughnut',
    data: { labels: bkeys, datasets: [{ data: bkeys.map(k=>bg[k]), backgroundColor: [PAL[0],PAL[4]], hoverOffset: 8 }] },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } },
  });

  // Rodzaj
  destroyChart('rodzaj');
  const rg = {};
  data.forEach(r => { if (r.rodzaj) rg[r.rodzaj]=(rg[r.rodzaj]||0)+1; });
  const rkeys = Object.keys(rg);
  state.charts.rodzaj = new Chart(document.getElementById('chartRodzaj'), {
    type: 'pie',
    data: { labels: rkeys, datasets: [{ data: rkeys.map(k=>rg[k]), backgroundColor: PAL.slice(0,rkeys.length), hoverOffset: 8 }] },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } },
  });
}

// ── Table head ────────────────────────────────────────────────
function renderTableHead() {
  document.getElementById('offersTableHead').innerHTML = '<tr>' +
    COLUMNS.map(c => `<th data-key="${c.key}">${c.label} <span class="sort-icon">↕</span></th>`).join('') + '</tr>';
  document.querySelectorAll('#offersTableHead th').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.key;
      state.sortDir = state.sortCol === k && state.sortDir === 'asc' ? 'desc' : 'asc';
      state.sortCol = k;
      document.querySelectorAll('#offersTableHead th').forEach(t => { t.classList.remove('sorted'); t.querySelector('.sort-icon').textContent = '↕'; });
      th.classList.add('sorted');
      th.querySelector('.sort-icon').textContent = state.sortDir === 'asc' ? '↑' : '↓';
      state.page = 1; sortTable(); renderPage();
    });
  });
}

function sortTable() {
  if (!state.sortCol) return;
  const col = COLUMNS.find(c => c.key === state.sortCol);
  state.table.sort((a, b) => {
    let va = a[state.sortCol], vb = b[state.sortCol];
    if (va == null) return 1; if (vb == null) return -1;
    if (col?.num) { va = Number(va); vb = Number(vb); }
    else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
    return state.sortDir === 'asc' ? (va > vb ? 1 : va < vb ? -1 : 0) : (va < vb ? 1 : va > vb ? -1 : 0);
  });
}

function renderPage() {
  const { page, pageSize, table } = state;
  const slice = table.slice((page-1)*pageSize, page*pageSize);
  document.getElementById('tableCount').textContent = table.length.toLocaleString('pl-PL');
  document.getElementById('offersTableBody').innerHTML = slice.map(row =>
    '<tr>' + COLUMNS.map(c => {
      const v = row[c.key];
      if (c.key === 'nabywca_typ') {
        const red = v && v.includes('prawna');
        return `<td><span class="pill ${red?'pill--red':'pill--blue'}">${v||'—'}</span></td>`;
      }
      if (c.key === 'KW' && v) return `<td><strong>${v}</strong></td>`;
      return `<td>${fmtCell(v, c)}</td>`;
    }).join('') + '</tr>'
  ).join('') || `<tr><td colspan="${COLUMNS.length}" class="empty-row">Brak danych</td></tr>`;
  renderPagination();
}

function renderPagination() {
  const total = state.table.length;
  const pages = Math.ceil(total / state.pageSize) || 1;
  const p = state.page;
  const start = Math.min((p-1)*state.pageSize+1, total);
  const end   = Math.min(p*state.pageSize, total);

  const range = [];
  if (pages <= 7) { for (let i=1;i<=pages;i++) range.push(i); }
  else {
    range.push(1);
    if (p > 3) range.push('…');
    for (let i=Math.max(2,p-1); i<=Math.min(pages-1,p+1); i++) range.push(i);
    if (p < pages-2) range.push('…');
    range.push(pages);
  }

  document.getElementById('pagination').innerHTML = `
    <span>${start}–${end} z ${total.toLocaleString('pl-PL')}</span>
    <div class="pg-btns">
      <button class="pg-btn" id="pgPrev" ${p===1?'disabled':''}>‹</button>
      ${range.map(r => r==='…' ? '<span class="pg-dots">…</span>' : `<button class="pg-btn${r===p?' active':''}" data-page="${r}">${r}</button>`).join('')}
      <button class="pg-btn" id="pgNext" ${p===pages?'disabled':''}>›</button>
    </div>
    <span>str. ${p} / ${pages}</span>`;

  document.getElementById('pgPrev').addEventListener('click', () => { state.page--; renderPage(); });
  document.getElementById('pgNext').addEventListener('click', () => { state.page++; renderPage(); });
  document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { state.page = +b.dataset.page; renderPage(); }));
}

// ── Filters ───────────────────────────────────────────────────
function populateFilters(data) {
  const rodzaje = [...new Set(data.map(r=>r.rodzaj).filter(Boolean))].sort();
  document.getElementById('filterRodzaj').innerHTML = rodzaje.map(v=>`<option value="${v}">${v}</option>`).join('');
}

function applyFilters() {
  const rodzaj  = [...document.getElementById('filterRodzaj').selectedOptions].map(o=>o.value);
  const ulica   = document.getElementById('filterUlica').value.toLowerCase().trim();
  const buyer   = document.getElementById('filterBuyer').value;
  const prMin   = +document.getElementById('filterPriceMin').value || 0;
  const prMax   = +document.getElementById('filterPriceMax').value || Infinity;
  const arMin   = +document.getElementById('filterAreaMin').value  || 0;
  const arMax   = +document.getElementById('filterAreaMax').value  || Infinity;
  const dtFrom  = document.getElementById('filterDateFrom').value;
  const dtTo    = document.getElementById('filterDateTo').value;

  state.filtered = state.raw.filter(r => {
    if (rodzaj.length  && !rodzaj.includes(r.rodzaj))                         return false;
    if (ulica          && !String(r.ulica||'').toLowerCase().includes(ulica)) return false;
    if (buyer          && r.nabywca_typ !== buyer)                             return false;
    if (r.cena         && (r.cena < prMin || r.cena > prMax))                 return false;
    if (r.powierzchnia_m2 && (r.powierzchnia_m2 < arMin || r.powierzchnia_m2 > arMax)) return false;
    if (dtFrom         && (r.data_transakcji||'') < dtFrom)                   return false;
    if (dtTo           && (r.data_transakcji||'') > dtTo)                     return false;
    return true;
  });
  state.table = [...state.filtered];
  state.page  = 1;
  sortTable();
  renderKPIs(state.filtered);
  renderCharts(state.filtered);
  renderPage();
  loadMapData(state.filtered);
}

function resetFilters() {
  document.getElementById('filterRodzaj').selectedIndex = -1;
  ['filterUlica','filterBuyer','filterPriceMin','filterPriceMax',
   'filterAreaMin','filterAreaMax','filterDateFrom','filterDateTo','tableSearch']
    .forEach(id => { document.getElementById(id).value = ''; });
  state.filtered = [...state.raw];
  state.table    = [...state.raw];
  state.page     = 1;
  sortTable();
  renderKPIs(state.raw);
  renderCharts(state.raw);
  renderPage();
  loadMapData(state.raw);
}

// ── Search ────────────────────────────────────────────────────
function applySearch(q) {
  q = q.toLowerCase().trim();
  state.table = q
    ? state.filtered.filter(r => COLUMNS.some(c => String(r[c.key]??'').toLowerCase().includes(q)))
    : [...state.filtered];
  state.page = 1;
  sortTable();
  renderPage();
}

// ── Export CSV ────────────────────────────────────────────────
function exportCSV() {
  const hdr  = COLUMNS.map(c=>c.label).join(',');
  const rows = state.table.map(r => COLUMNS.map(c => { const v=r[c.key]??''; return String(v).includes(',')?`"${v}"`:v; }).join(','));
  const a    = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([hdr+'\n'+rows.join('\n')], {type:'text/csv'})), download: 'rcn_biezanow_prokocim.csv' });
  a.click();
}

// ── Load data ─────────────────────────────────────────────────
function loadData(data, label) {
  if (!data?.length) { setStatus('Brak danych.', 'error'); return; }
  data.forEach(r => {
    ['cena','cena_za_m2','powierzchnia_m2','_lat','_lon'].forEach(k => {
      if (r[k] != null && r[k] !== '') r[k] = Number(r[k]);
    });
    if (!r.cena_za_m2 && r.cena && r.powierzchnia_m2) r.cena_za_m2 = Math.round(r.cena / r.powierzchnia_m2);
  });

  state.raw      = data;
  state.filtered = [...data];
  state.table    = [...data];
  state.page     = 1;
  state.sortCol  = null;
  state.sortDir  = 'asc';

  document.getElementById('emptyState').classList.add('hidden');
  showTab('dashboard');
  populateFilters(data);
  renderKPIs(data);
  renderCharts(data);
  renderTableHead();
  renderPage();
  loadMapData(data);          // stores in pendingData if map tab not yet visible
  setStatus(`✓ ${data.length.toLocaleString('pl-PL')} transakcji (${label})`, 'success');
}

// ── Tab navigation ────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.add('hidden'));
  const ids = { dashboard: 'tabDashboard', map: 'tabMap', table: 'tabTable' };
  document.getElementById(ids[name])?.classList.remove('hidden');

  if (name === 'map') {
    // Initialize map NOW (div is visible) if not already done
    if (!mapState.initialized) {
      initMap();
    }
    // Render pending data
    if (mapState.pendingData) {
      const d = mapState.pendingData;
      mapState.pendingData = null;
      loadMapData(d);
    }
    // Fix tile rendering after reveal
    setTimeout(() => mapState.map?.invalidateSize(), 120);
  }
}

// ── Sample data (Bieżanów-Prokocim, realistic) ───────────────
function generateSampleData(n = 300) {
  const streets = [
    { name: 'ul. Konrada Walenroda',      lat: [50.000, 50.010], lon: [20.000, 20.015], base: 1100 },
    { name: 'ul. ks. Piotra Ściegiennego', lat: [50.012, 50.025], lon: [19.968, 19.985], base: 1050 },
    { name: 'ul. Prokocimska',              lat: [50.005, 50.020], lon: [19.975, 19.995], base: 1000 },
    { name: 'ul. Bieżanowska',              lat: [49.998, 50.010], lon: [20.010, 20.030], base: 980  },
    { name: 'ul. Wielicka',                 lat: [50.008, 50.018], lon: [19.980, 20.005], base: 1150 },
    { name: 'ul. Christo Botewa',           lat: [50.015, 50.025], lon: [19.990, 20.010], base: 1020 },
    { name: 'ul. Turniejowa',               lat: [50.002, 50.012], lon: [19.965, 19.985], base: 960  },
    { name: 'ul. Łużycka',                  lat: [50.010, 50.020], lon: [20.015, 20.035], base: 950  },
  ];
  const formy    = ['Akt notarialny', 'Przetarg', 'Umowa warunkowa'];
  const rodzaje  = ['Grunt budowlany', 'Dom jednorodzinny', 'Grunt niezabudowany'];
  const rows = [];
  const now  = new Date(2026, 2, 14);

  for (let i = 1; i <= n; i++) {
    const s         = streets[Math.floor(Math.random() * streets.length)];
    const lat       = s.lat[0] + Math.random() * (s.lat[1] - s.lat[0]);
    const lon       = s.lon[0] + Math.random() * (s.lon[1] - s.lon[0]);
    const area      = Math.round(250 + Math.random() * 1800);
    const priceM2   = Math.round(s.base * (0.82 + Math.random() * 0.36));
    const isPrawna  = Math.random() < 0.16;
    const daysAgo   = Math.floor(Math.random() * 1200); // ~3.3 years back from 2026
    const date      = new Date(now); date.setDate(date.getDate() - daysAgo);
    const repoNum   = `KR.${Math.floor(1000 + Math.random()*9000)}.${date.getFullYear()}`;

    rows.push({
      data_transakcji: date.toISOString().slice(0, 10),
      rodzaj:          rodzaje[Math.floor(Math.random() * rodzaje.length)],
      ulica:           s.name,
      dzielnica:       'Bieżanów-Prokocim',
      numer_dzialki:   `${Math.floor(100 + Math.random()*900)}/${Math.floor(1+Math.random()*9)}`,
      powierzchnia_m2: area,
      cena:            Math.round(priceM2 * area),
      cena_za_m2:      priceM2,
      nabywca_typ:     isPrawna ? 'Osoba prawna' : 'Osoba fizyczna',
      forma_nabycia:   formy[Math.floor(Math.random() * formy.length)],
      numer_repo:      repoNum,
      KW:              isPrawna ? `KR1P/${Math.floor(10000+Math.random()*90000)}/0` : null,
      zrodlo:          'Dane demonstracyjne',
      _lat:            lat,
      _lon:            lon,
    });
  }
  return rows;
}

// ── Fetch live data from GUGiK ────────────────────────────────
async function fetchLiveData() {
  const btn = document.getElementById('btnFetchRCN');
  btn.disabled = true;
  btn.textContent = '⏳ Pobieranie…';
  setStatus('Łączenie z GUGiK RCN…');

  // 1. Try local Node.js proxy (npm start)
  try {
    const resp = await fetch('/api/rcn', { signal: AbortSignal.timeout(8000) });
    if (resp.ok) {
      const json = await resp.json();
      if (json.ok && json.records?.length > 0) {
        loadData(json.records, `GUGiK RCN WFS (${json.count} rekordów)`);
        btn.disabled = false; btn.textContent = '⬇ Pobierz z GUGiK';
        return;
      }
      if (json.ok) {
        setStatus('Serwer proxy działa ale GUGiK zwrócił 0 rekordów. Sprawdź /api/capabilities.', 'error');
        btn.disabled = false; btn.textContent = '⬇ Pobierz z GUGiK'; return;
      }
    }
  } catch (_) { /* proxy not running */ }

  // 2. Direct WFS from browser
  await tryFetchLiveData(
    (records, ep) => {
      loadData(records, `GUGiK WFS ${ep.typeName}`);
      btn.disabled = false; btn.textContent = '⬇ Pobierz z GUGiK';
    },
    () => {
      setStatus(
        'GUGiK WFS blokuje zapytania z przeglądarki (CORS). ' +
        'Aby pobrać prawdziwe dane uruchom: npm install && npm start, ' +
        'lub pobierz CSV z geoportal.gov.pl i użyj "Importuj CSV/JSON". ' +
        'Na razie załadowano dane demonstracyjne.',
        'error'
      );
      loadData(generateSampleData(300), 'dane demonstracyjne');
      btn.disabled = false; btn.textContent = '⬇ Pobierz z GUGiK';
    },
    msg => setStatus(msg),
  );
}

// ── File import ───────────────────────────────────────────────
function handleFile(file) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = e => {
    const txt = e.target.result;
    if (file.name.endsWith('.json')) {
      try { loadData(JSON.parse(txt), file.name); } catch { setStatus('Błąd JSON', 'error'); }
    } else {
      const res = Papa.parse(txt, { header: true, skipEmptyLines: true, dynamicTyping: true });
      loadData(res.data, file.name);
    }
  };
  rd.readAsText(file, 'UTF-8');
}

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Tabs — only switch if data loaded
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => { if (state.raw.length) showTab(btn.dataset.tab); })
  );

  // Fetch / sample buttons
  document.getElementById('btnFetchRCN').addEventListener('click', fetchLiveData);
  document.getElementById('btnFetchRCNBig').addEventListener('click', fetchLiveData);
  document.getElementById('btnLoadSample').addEventListener('click', () => loadData(generateSampleData(300), 'dane demonstracyjne'));
  document.getElementById('btnLoadSampleBig').addEventListener('click', () => loadData(generateSampleData(300), 'dane demonstracyjne'));

  // File inputs
  ['fileInput','fileInput2'].forEach(id =>
    document.getElementById(id).addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value=''; })
  );

  // Dashboard filters
  document.getElementById('btnApplyFilters').addEventListener('click', applyFilters);
  document.getElementById('btnResetFilters').addEventListener('click', resetFilters);

  // Table search
  let t;
  document.getElementById('tableSearch').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => applySearch(e.target.value), 250); });

  // Export
  document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
});
