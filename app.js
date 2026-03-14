'use strict';
/* ============================================================
   RCN App – sidebar UI, detail panel, charts modal
   No tabs – map is always full-screen primary view
   ============================================================ */

// ── State ─────────────────────────────────────────────────────
const state = {
  raw:      [],
  filtered: [],
  table:    [],
  page:     1,
  pageSize: 20,
  charts:   {},
};

// ── Helpers ───────────────────────────────────────────────────
const fmtPLN = v => v != null ? Number(v).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }) : '—';
const fmtNum = v => v != null ? Number(v).toLocaleString('pl-PL') : '—';
const avg    = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const median = arr => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const isPrawna = r =>
  (r.nabywca_typ && r.nabywca_typ.toLowerCase().includes('prawna')) ||
  (r.zbywca_typ  && r.zbywca_typ && r.zbywca_typ.toLowerCase().includes('prawna'));

// ── Status bar ────────────────────────────────────────────────
function setStatus(msg, type) {
  const el = document.getElementById('statusBar');
  el.className = 'map-status' +
    (type === 'error' ? ' error' : type === 'success' ? ' success' : '');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 5000);
}

// ── Sidebar stats strip ───────────────────────────────────────
function renderStats(data) {
  const prices = data.map(r => r.cena).filter(Boolean);
  const pm2    = data.map(r => r.cena_za_m2).filter(Boolean);
  const prawne = data.filter(isPrawna).length;

  document.getElementById('statCount').textContent    = data.length.toLocaleString('pl-PL');
  document.getElementById('statAvgPrice').textContent = prices.length ? fmtPLN(avg(prices)) : '—';
  document.getElementById('statMedianPm2').textContent = pm2.length  ? fmtPLN(median(pm2))  : '—';
  document.getElementById('statPrawne').textContent   =
    `${prawne} (${data.length ? ((prawne / data.length) * 100).toFixed(0) : 0}%)`;
}

// ── Detail panel ──────────────────────────────────────────────
function showDetail(r) {
  const prawna   = isPrawna(r);
  const pillCls  = prawna ? 'dp-pill--red' : 'dp-pill--blue';
  const kwRow    = prawna && r.KW
    ? `<tr class="dp-kw-row"><td>Nr KW</td><td><strong>${r.KW}</strong></td></tr>` : '';

  document.getElementById('dpTitle').textContent = r.ulica || 'Transakcja';
  document.getElementById('dpBody').innerHTML = `
    <div class="dp-rodzaj">
      <span class="dp-rodzaj-name">${r.rodzaj || 'Grunt'}</span>
      <span class="dp-pill ${pillCls}">${r.nabywca_typ || 'Osoba fizyczna'}</span>
      ${r.zbywca_typ
        ? `<span class="dp-pill ${r.zbywca_typ.toLowerCase().includes('prawna') ? 'dp-pill--red' : 'dp-pill--blue'}">${r.zbywca_typ} <small>(zbywca)</small></span>`
        : ''}
    </div>
    <table class="dp-table">
      <tr><td>Data transakcji</td><td><strong>${r.data_transakcji || '—'}</strong></td></tr>
      <tr><td>Ulica</td><td>${r.ulica || '—'}</td></tr>
      <tr><td>Dzielnica</td><td>${r.dzielnica || 'Bieżanów-Prokocim'}</td></tr>
      <tr><td>Nr działki</td><td><code>${r.numer_dzialki || '—'}</code></td></tr>
      <tr><td>Powierzchnia</td><td><strong>${fmtNum(r.powierzchnia_m2)} m²</strong></td></tr>
      <tr><td>Cena</td><td class="dp-price">${fmtPLN(r.cena)}</td></tr>
      <tr><td>Cena / m²</td><td class="dp-price-m2">${fmtPLN(r.cena_za_m2)}</td></tr>
      <tr><td>Nabywca</td><td>${r.nabywca_typ || '—'}</td></tr>
      ${r.zbywca_typ ? `<tr><td>Zbywca</td><td>${r.zbywca_typ}</td></tr>` : ''}
      <tr><td>Forma nabycia</td><td>${r.forma_nabycia || '—'}</td></tr>
      <tr><td>Nr repozytorium</td><td><code>${r.numer_repo || '—'}</code></td></tr>
      ${kwRow}
      <tr><td>Źródło</td><td>${r.zrodlo || '—'}</td></tr>
    </table>`;

  document.getElementById('detailPanel').classList.remove('hidden');
}

// ── Transaction list (sidebar) ───────────────────────────────
function renderList() {
  const { page, pageSize, table } = state;
  const slice = table.slice((page - 1) * pageSize, page * pageSize);
  document.getElementById('listCount').textContent = table.length.toLocaleString('pl-PL');

  const list = document.getElementById('txList');

  if (!table.length) {
    list.innerHTML = '<div class="sb-empty"><p>Brak wyników dla wybranych filtrów</p></div>';
    document.getElementById('sbPagination').innerHTML = '';
    return;
  }

  list.innerHTML = slice.map(r => {
    const red = isPrawna(r);
    return `<div class="tx-item" data-id="${r._id}">
      <div class="tx-street">${r.ulica || '—'}</div>
      <div class="tx-date">${r.data_transakcji || '—'} · ${fmtNum(r.powierzchnia_m2)} m²</div>
      <div class="tx-meta">
        <span class="tx-price">${fmtPLN(r.cena)}</span>
        <span class="tx-pill ${red ? 'tx-pill--red' : 'tx-pill--blue'}">${red ? 'Prawna' : 'Fizyczna'}</span>
      </div>
    </div>`;
  }).join('');

  // Click list item → show detail + pan map
  list.querySelectorAll('.tx-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = +el.dataset.id;
      const r  = table.find(x => x._id === id);
      if (!r) return;
      list.querySelectorAll('.tx-item').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      showDetail(r);
      if (mapState?.map && r._lat && r._lon) {
        mapState.map.setView([+r._lat, +r._lon], 17, { animate: true });
      }
    });
  });

  renderPagination();
}

function renderPagination() {
  const total  = state.table.length;
  const pages  = Math.ceil(total / state.pageSize) || 1;
  const p      = state.page;
  const start  = Math.min((p - 1) * state.pageSize + 1, total);
  const end    = Math.min(p * state.pageSize, total);

  // Build page number range (max 5 visible)
  let range = [];
  if (pages <= 7) {
    for (let i = 1; i <= pages; i++) range.push(i);
  } else {
    range.push(1);
    if (p > 3) range.push('…');
    for (let i = Math.max(2, p - 1); i <= Math.min(pages - 1, p + 1); i++) range.push(i);
    if (p < pages - 2) range.push('…');
    range.push(pages);
  }

  document.getElementById('sbPagination').innerHTML = `
    <span>${start}–${end} / ${total.toLocaleString('pl-PL')}</span>
    <div class="sb-pg-btns">
      <button class="sb-pg-btn" id="pgPrev" ${p === 1 ? 'disabled' : ''}>‹</button>
      ${range.map(r => r === '…'
        ? '<span style="color:var(--sb-muted);font-size:12px;padding:0 2px">…</span>'
        : `<button class="sb-pg-btn${r === p ? ' active' : ''}" data-page="${r}">${r}</button>`
      ).join('')}
      <button class="sb-pg-btn" id="pgNext" ${p === pages ? 'disabled' : ''}>›</button>
    </div>
    <span>${p}/${pages}</span>`;

  document.getElementById('pgPrev').addEventListener('click', () => { state.page--; renderList(); });
  document.getElementById('pgNext').addEventListener('click', () => { state.page++; renderList(); });
  document.querySelectorAll('[data-page]').forEach(b =>
    b.addEventListener('click', () => { state.page = +b.dataset.page; renderList(); })
  );
}

// ── Filters ───────────────────────────────────────────────────
function populateFilters(data) {
  const rodzaje = [...new Set(data.map(r => r.rodzaj).filter(Boolean))].sort();
  document.getElementById('filterRodzaj').innerHTML =
    rodzaje.map(v => `<option value="${v}">${v}</option>`).join('');
}

function applyFilters() {
  const rodzaj = [...document.getElementById('filterRodzaj').selectedOptions].map(o => o.value);
  const ulica  = document.getElementById('filterUlica').value.toLowerCase().trim();
  const buyer  = document.getElementById('filterBuyer').value;
  const prMin  = +document.getElementById('filterPriceMin').value || 0;
  const prMax  = +document.getElementById('filterPriceMax').value || Infinity;
  const arMin  = +document.getElementById('filterAreaMin').value  || 0;
  const arMax  = +document.getElementById('filterAreaMax').value  || Infinity;
  const dtFrom = document.getElementById('filterDateFrom').value;
  const dtTo   = document.getElementById('filterDateTo').value;

  state.filtered = state.raw.filter(r => {
    if (rodzaj.length && !rodzaj.includes(r.rodzaj))                           return false;
    if (ulica         && !String(r.ulica||'').toLowerCase().includes(ulica))   return false;
    if (buyer         && r.nabywca_typ !== buyer)                              return false;
    if (r.cena        && (r.cena < prMin || r.cena > prMax))                   return false;
    if (r.powierzchnia_m2 && (r.powierzchnia_m2 < arMin || r.powierzchnia_m2 > arMax)) return false;
    if (dtFrom        && (r.data_transakcji||'') < dtFrom)                     return false;
    if (dtTo          && (r.data_transakcji||'') > dtTo)                       return false;
    return true;
  });
  state.table = [...state.filtered];
  state.page  = 1;
  renderStats(state.filtered);
  renderList();
  try { loadMapData(state.filtered); } catch(e) { console.error(e); }
}

function resetFilters() {
  document.getElementById('filterRodzaj').selectedIndex = -1;
  ['filterUlica','filterBuyer','filterPriceMin','filterPriceMax',
   'filterAreaMin','filterAreaMax','filterDateFrom','filterDateTo','sidebarSearch']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  state.filtered = [...state.raw];
  state.table    = [...state.raw];
  state.page     = 1;
  renderStats(state.raw);
  renderList();
  try { loadMapData(state.raw); } catch(e) { console.error(e); }
}

// ── Search ────────────────────────────────────────────────────
function applySearch(q) {
  q = q.toLowerCase().trim();
  state.table = q
    ? state.filtered.filter(r =>
        ['ulica', 'data_transakcji', 'rodzaj', 'nabywca_typ', 'zbywca_typ',
         'numer_dzialki', 'numer_repo', 'KW'].some(k => String(r[k]??'').toLowerCase().includes(q))
      )
    : [...state.filtered];
  state.page = 1;
  renderList();
}

// ── Export CSV ────────────────────────────────────────────────
const EXPORT_COLS = [
  'data_transakcji','rodzaj','ulica','dzielnica','numer_dzialki',
  'powierzchnia_m2','cena','cena_za_m2','nabywca_typ','zbywca_typ',
  'forma_nabycia','numer_repo','KW','zrodlo',
];
function exportCSV() {
  const hdr  = EXPORT_COLS.join(',');
  const rows = state.table.map(r =>
    EXPORT_COLS.map(k => { const v = r[k]??''; return String(v).includes(',') ? `"${v}"` : v; }).join(',')
  );
  const a = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(new Blob([hdr + '\n' + rows.join('\n')], { type: 'text/csv' })),
    download: 'rcn_biezanow_prokocim.csv',
  });
  a.click();
}

// ── Charts ────────────────────────────────────────────────────
const PAL = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#0891b2','#b45309','#db2777'];
function destroyChart(k) { if (state.charts[k]) { state.charts[k].destroy(); delete state.charts[k]; } }

function renderCharts(data) {
  // Trend
  destroyChart('trend');
  const mo = {};
  data.forEach(r => {
    if (r.data_transakcji && r.cena_za_m2) {
      const m = r.data_transakcji.slice(0, 7);
      (mo[m] = mo[m] || []).push(+r.cena_za_m2);
    }
  });
  const mkeys = Object.keys(mo).sort();
  if (mkeys.length) {
    state.charts.trend = new Chart(document.getElementById('chartPriceTrend'), {
      type: 'line',
      data: {
        labels: mkeys.map(l => l.slice(5) + '.' + l.slice(0, 4)),
        datasets: [{
          label: 'Śred. cena/m²',
          data: mkeys.map(l => Math.round(avg(mo[l]))),
          borderColor: PAL[0],
          backgroundColor: 'rgba(59,130,246,.08)',
          fill: true, tension: 0.35, pointRadius: 3,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { callback: v => v.toLocaleString('pl-PL') } } },
      },
    });
  }

  // Price by street
  destroyChart('street');
  const sg = {};
  data.forEach(r => { if (r.ulica && r.cena_za_m2) (sg[r.ulica] = sg[r.ulica] || []).push(+r.cena_za_m2); });
  const slabs = Object.keys(sg).sort((a, b) => avg(sg[b]) - avg(sg[a])).slice(0, 10);
  if (slabs.length) {
    state.charts.street = new Chart(document.getElementById('chartPriceByStreet'), {
      type: 'bar',
      data: {
        labels: slabs.map(l => l.replace('ul. ', '')),
        datasets: [{ data: slabs.map(l => Math.round(avg(sg[l]))), backgroundColor: PAL[0], borderRadius: 4 }],
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { callback: v => v.toLocaleString('pl-PL') } } },
      },
    });
  }

  // Area distribution
  destroyChart('area');
  const buckets = [['<300m²',0,300],['300–600',300,600],['600–1k',600,1000],['1k–2k',1000,2000],['>2k',2000,Infinity]];
  state.charts.area = new Chart(document.getElementById('chartAreaDist'), {
    type: 'bar',
    data: {
      labels: buckets.map(b => b[0]),
      datasets: [{
        data: buckets.map(([,mn,mx]) => data.filter(r => r.powierzchnia_m2 >= mn && r.powierzchnia_m2 < mx).length),
        backgroundColor: PAL[2], borderRadius: 4,
      }],
    },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } } },
  });

  // Buyer type
  destroyChart('buyer');
  const bg = {};
  data.forEach(r => { if (r.nabywca_typ) bg[r.nabywca_typ] = (bg[r.nabywca_typ] || 0) + 1; });
  const bkeys = Object.keys(bg);
  if (bkeys.length) {
    state.charts.buyer = new Chart(document.getElementById('chartBuyerType'), {
      type: 'doughnut',
      data: { labels: bkeys, datasets: [{ data: bkeys.map(k => bg[k]), backgroundColor: [PAL[0], PAL[4]], hoverOffset: 6 }] },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } },
    });
  }

  // Rodzaj
  destroyChart('rodzaj');
  const rg = {};
  data.forEach(r => { if (r.rodzaj) rg[r.rodzaj] = (rg[r.rodzaj] || 0) + 1; });
  const rkeys = Object.keys(rg);
  if (rkeys.length) {
    state.charts.rodzaj = new Chart(document.getElementById('chartRodzaj'), {
      type: 'pie',
      data: { labels: rkeys, datasets: [{ data: rkeys.map(k => rg[k]), backgroundColor: PAL.slice(0, rkeys.length), hoverOffset: 6 }] },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } },
    });
  }
}

// ── Demo warning banner ───────────────────────────────────────
function showDemoBanner(show) {
  let el = document.getElementById('demoBanner');
  if (show) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'demoBanner';
      el.className = 'demo-banner';
      el.innerHTML = '⚠️ DANE DEMONSTRACYJNE – pineski są przykładowe, nie rzeczywiste! ' +
        'Aby zobaczyć prawdziwe dane RCN: <code>npm install &amp;&amp; npm start</code> → ' +
        '<a href="http://localhost:3000" target="_blank">localhost:3000</a>';
      document.getElementById('mapWrap').appendChild(el);
    }
    el.style.display = '';
  } else if (el) {
    el.style.display = 'none';
  }
}

// ── Load data ──────────────────────────────────────────────────
function loadData(data, label) {
  if (!data?.length) { setStatus('Brak danych.', 'error'); return; }

  const isDemo = label.includes('demonstracyjne') || label.includes('demonstracyjnych');

  // Normalise numeric fields and assign IDs
  let idCtr = 1;
  data.forEach(r => {
    ['cena', 'cena_za_m2', 'powierzchnia_m2', '_lat', '_lon'].forEach(k => {
      if (r[k] != null && r[k] !== '') r[k] = Number(r[k]);
    });
    if (!r.cena_za_m2 && r.cena && r.powierzchnia_m2)
      r.cena_za_m2 = Math.round(r.cena / r.powierzchnia_m2);
    if (!r._id) r._id = idCtr++;
  });

  state.raw      = data;
  state.filtered = [...data];
  state.table    = [...data];
  state.page     = 1;

  // Hide empty state
  const emptyEl = document.getElementById('sbEmpty');
  if (emptyEl) emptyEl.classList.add('hidden');
  document.getElementById('btnExportCSV').style.display = '';

  showDemoBanner(isDemo);

  try { populateFilters(data); } catch(e) { console.error('populateFilters', e); }
  try { renderStats(data);     } catch(e) { console.error('renderStats', e); }
  try { renderList();          } catch(e) { console.error('renderList', e); }
  try { loadMapData(data);     } catch(e) { console.error('loadMapData', e); }

  if (isDemo) {
    setStatus(
      '⚠️ Dane demonstracyjne — NIE są to prawdziwe transakcje RCN!\n' +
      'Prawdziwe dane: npm install && npm start → http://localhost:3000',
      'error'
    );
  } else {
    setStatus(`✓ Załadowano ${data.length.toLocaleString('pl-PL')} transakcji (${label})`, 'success');
  }
}

// ── Sample data ────────────────────────────────────────────────
function generateSampleData(n = 300) {
  // Street centerpoints from OSM Nominatim (verified).
  // r = max random offset in degrees — VERY SMALL (≈30 m) so pins stay on correct street.
  // DO NOT increase r: larger values cause pins to land on neighbouring streets.
  const streets = [
    // Nowy Bieżanów – NE part of district
    { name: 'ul. Konrada Wallenroda',       clat: 50.0038, clon: 20.0372, r: 0.0003, base: 1100 },
    // Prokocim – ul. Ściegiennego runs N–S, center ~50.016°N 19.984°E
    { name: 'ul. ks. Piotra Ściegiennego',  clat: 50.0160, clon: 19.9840, r: 0.0003, base: 1050 },
    // Prokocimska – main E–W artery through Prokocim
    { name: 'ul. Prokocimska',              clat: 50.0148, clon: 19.9985, r: 0.0003, base: 1000 },
    // Bieżanowska – main N–S road through Bieżanów
    { name: 'ul. Bieżanowska',              clat: 50.0062, clon: 20.0190, r: 0.0003, base:  980 },
    // Wielicka – DK94 major road, runs E–W across district
    { name: 'ul. Wielicka',                 clat: 50.0098, clon: 20.0030, r: 0.0004, base: 1150 },
    // Christo Botewa – Nowy Prokocim, apartment estate ~500 m NE of Ściegiennego
    { name: 'ul. Christo Botewa',           clat: 50.0193, clon: 19.9940, r: 0.0003, base: 1020 },
    // Turniejowa – SW part of district
    { name: 'ul. Turniejowa',               clat: 50.0108, clon: 19.9668, r: 0.0003, base:  960 },
    // Łużycka – Eastern Bieżanów
    { name: 'ul. Łużycka',                  clat: 50.0058, clon: 20.0452, r: 0.0003, base:  950 },
  ];
  const formy    = ['Akt notarialny', 'Przetarg', 'Umowa warunkowa'];
  const rodzaje  = ['Grunt budowlany', 'Dom jednorodzinny', 'Grunt niezabudowany'];
  const zbywcyPrawni = ['Skarb Państwa', 'Gmina Kraków', 'Spółka z o.o.'];
  const zbywcyFiz    = ['Osoba fizyczna'];
  const rows = [];
  const now  = new Date(2026, 2, 14);

  for (let i = 1; i <= n; i++) {
    const s          = streets[Math.floor(Math.random() * streets.length)];
    const lat        = s.clat + (Math.random() - 0.5) * 2 * s.r;
    const lon        = s.clon + (Math.random() - 0.5) * 2 * s.r * 1.4;
    const area       = Math.round(250 + Math.random() * 1800);
    const priceM2    = Math.round(s.base * (0.82 + Math.random() * 0.36));
    const nabPrawna  = Math.random() < 0.16;
    const zbywPrawna = Math.random() < 0.14;
    const daysAgo    = Math.floor(Math.random() * 1200);
    const date       = new Date(now); date.setDate(date.getDate() - daysAgo);
    const repoNum    = `KR.${Math.floor(1000 + Math.random() * 9000)}.${date.getFullYear()}`;
    const showKW     = nabPrawna || zbywPrawna;

    rows.push({
      _id:             i,
      data_transakcji: date.toISOString().slice(0, 10),
      rodzaj:          rodzaje[Math.floor(Math.random() * rodzaje.length)],
      ulica:           s.name,
      dzielnica:       'Bieżanów-Prokocim',
      numer_dzialki:   `${Math.floor(100 + Math.random() * 900)}/${Math.floor(1 + Math.random() * 9)}`,
      powierzchnia_m2: area,
      cena:            Math.round(priceM2 * area),
      cena_za_m2:      priceM2,
      nabywca_typ:     nabPrawna  ? 'Osoba prawna' : 'Osoba fizyczna',
      zbywca_typ:      zbywPrawna
        ? zbywcyPrawni[Math.floor(Math.random() * zbywcyPrawni.length)]
        : zbywcyFiz[0],
      forma_nabycia:   formy[Math.floor(Math.random() * formy.length)],
      numer_repo:      repoNum,
      KW:              showKW ? `KR1P/${Math.floor(10000 + Math.random() * 90000)}/0` : null,
      zrodlo:          'Dane demonstracyjne',
      _lat:            lat,
      _lon:            lon,
    });
  }
  return rows;
}

// ── Fetch live (GUGiK) ────────────────────────────────────────
async function fetchLiveData() {
  const btn = document.getElementById('btnFetchRCN');
  const btnSb = document.getElementById('btnFetchRCNSb');
  [btn, btnSb].forEach(b => { if (b) { b.disabled = true; b.textContent = '⏳ Pobieranie…'; } });
  setStatus('Łączenie z GUGiK RCN…');

  // 1. Try local Node.js proxy (npm start → localhost:3000)
  try {
    const resp = await fetch('/api/rcn', { signal: AbortSignal.timeout(8000) });
    if (resp.ok) {
      const json = await resp.json();
      if (json.ok && json.records?.length > 0) {
        loadData(json.records, `GUGiK RCN WFS (${json.count} rekordów)`);
        [btn, btnSb].forEach(b => { if (b) { b.disabled = false; b.textContent = '⬇ Pobierz z GUGiK'; } });
        return;
      }
      if (json.ok) {
        setStatus('Serwer proxy działa, ale GUGiK zwrócił 0 rekordów.', 'error');
        [btn, btnSb].forEach(b => { if (b) { b.disabled = false; b.textContent = '⬇ Pobierz z GUGiK'; } });
        return;
      }
    }
  } catch (_) { /* proxy not running */ }

  // 2. Direct WFS from browser (usually blocked by CORS)
  await tryFetchLiveData(
    (records, ep) => {
      loadData(records, `GUGiK WFS ${ep.typeName}`);
      [btn, btnSb].forEach(b => { if (b) { b.disabled = false; b.textContent = '⬇ Pobierz z GUGiK'; } });
    },
    () => {
      setStatus(
        '❌ GUGiK WFS zablokowany przez CORS — przeglądarka nie może bezpośrednio pobrać danych rządowych.\n' +
        'Rozwiązanie: npm install && npm start → otwórz http://localhost:3000\n' +
        'Załadowano PRZYKŁADOWE dane demonstracyjne (nie są prawdziwe!).',
        'error'
      );
      loadData(generateSampleData(300), 'dane demonstracyjne');
      [btn, btnSb].forEach(b => { if (b) { b.disabled = false; b.textContent = '⬇ Pobierz z GUGiK'; } });
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
      try { loadData(JSON.parse(txt), file.name); }
      catch { setStatus('Błąd parsowania JSON', 'error'); }
    } else {
      const res = Papa.parse(txt, { header: true, skipEmptyLines: true, dynamicTyping: true });
      loadData(res.data, file.name);
    }
  };
  rd.readAsText(file, 'UTF-8');
}

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Init map immediately (always visible)
  try { initMap(); } catch(e) { console.error('initMap failed:', e); }

  // ── Sidebar collapse / expand ──
  document.getElementById('btnCollapse').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('collapsed');
    document.getElementById('btnExpandSidebar').style.display = '';
    setTimeout(() => mapState?.map?.invalidateSize(), 270);
  });
  document.getElementById('btnExpandSidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('collapsed');
    document.getElementById('btnExpandSidebar').style.display = 'none';
    setTimeout(() => mapState?.map?.invalidateSize(), 270);
  });

  // ── Detail panel close ──
  document.getElementById('btnCloseDetail').addEventListener('click', () => {
    document.getElementById('detailPanel').classList.add('hidden');
    document.querySelectorAll('.tx-item.active').forEach(e => e.classList.remove('active'));
  });

  // ── Charts modal ──
  document.getElementById('btnOpenCharts').addEventListener('click', () => {
    document.getElementById('chartsModal').classList.remove('hidden');
    const src = state.filtered.length ? state.filtered : state.raw;
    if (src.length) try { renderCharts(src); } catch(e) { console.error(e); }
  });
  document.getElementById('btnCloseCharts').addEventListener('click', () => {
    document.getElementById('chartsModal').classList.add('hidden');
  });
  document.getElementById('chartsModal').addEventListener('click', e => {
    if (e.target === document.getElementById('chartsModal'))
      document.getElementById('chartsModal').classList.add('hidden');
  });

  // ── Data source buttons ──
  document.getElementById('btnFetchRCN').addEventListener('click', fetchLiveData);
  document.getElementById('btnFetchRCNSb').addEventListener('click', fetchLiveData);
  document.getElementById('btnLoadSample').addEventListener('click',
    () => loadData(generateSampleData(300), 'dane demonstracyjne'));
  document.getElementById('btnLoadSampleSb').addEventListener('click',
    () => loadData(generateSampleData(300), 'dane demonstracyjne'));
  document.getElementById('fileInput').addEventListener('change', e => {
    handleFile(e.target.files[0]); e.target.value = '';
  });

  // ── Filters ──
  document.getElementById('btnApplyFilters').addEventListener('click', applyFilters);
  document.getElementById('btnResetFilters').addEventListener('click', resetFilters);

  // ── Search (debounced) ──
  let searchTimer;
  document.getElementById('sidebarSearch').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applySearch(e.target.value), 250);
  });

  // ── Export ──
  document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
});
