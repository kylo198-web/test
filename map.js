'use strict';
/* ============================================================
   RCN Map – Leaflet + proj4  (deferred init, fixed CORS fallback)
   Centrum: Bieżanów-Prokocim (50.015, 20.010), zoom 14
   ============================================================ */

try {
  proj4.defs('EPSG:2180',
    '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 ' +
    '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
} catch(e) { console.warn('proj4 not available, coordinate conversion disabled'); }

// WFS endpoints tried in order
const WFS_ENDPOINTS = [
  { url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/RCN/WFS/PointsOfObjects', typeName: 'rcn:ObiektTransakcji' },
  { url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/RCN/WFS/PointsOfObjects', typeName: 'ms:rcn_s_wfs_public' },
  { url: 'https://mapy.geoportal.gov.pl/wss/service/rcn',                            typeName: 'rcn:transakcje' },
  { url: 'https://mapy.geoportal.gov.pl/wss/service/rcn',                            typeName: 'rcn:grunty' },
];

// Bieżanów-Prokocim EPSG:2180 bbox
const BP_BBOX = { minX: 449000, minY: 549000, maxX: 459000, maxY: 556000 };

// ── Public map state (read by app.js) ─────────────────────────
const mapState = {
  map:          null,
  cluster:      null,
  allMarkers:   [],        // { marker, record }
  pendingData:  null,      // data waiting for map to be shown
  initialized:  false,
};

// ── Init map (only when div is visible) ───────────────────────
function initMap() {
  if (mapState.initialized) return;
  mapState.initialized = true;

  mapState.map = L.map('krakowMap', {
    center: [50.0155, 20.005],   // Bieżanów-Prokocim center
    zoom:   14,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(mapState.map);

  mapState.cluster = L.markerClusterGroup({
    maxClusterRadius: 40,
    showCoverageOnHover: false,
    iconCreateFunction: cluster => {
      const n = cluster.getChildCount();
      const cls = n < 10 ? 'sm' : n < 50 ? 'md' : 'lg';
      return L.divIcon({ html: `<div class="ci ci--${cls}">${n}</div>`, className: '', iconSize: [38, 38] });
    },
  });
  mapState.map.addLayer(mapState.cluster);
}

// ── Marker icon ───────────────────────────────────────────────
function makeIcon(nabywcaTyp) {
  const red = nabywcaTyp && nabywcaTyp.toLowerCase().includes('prawna');
  const c   = red ? '#d93b2b' : '#1e6fd9';
  return L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30">
      <path d="M11 0C4.9 0 0 4.9 0 11c0 8.3 11 19 11 19S22 19.3 22 11C22 4.9 17.1 0 11 0z"
            fill="${c}" stroke="#fff" stroke-width="1.5"/>
      <circle cx="11" cy="11" r="4.5" fill="#fff"/>
    </svg>`,
    className: '',
    iconSize:   [22, 30],
    iconAnchor: [11, 30],
    popupAnchor: [0, -30],
  });
}

// ── Popup ─────────────────────────────────────────────────────
function makePopup(r) {
  const fmtPLN = v => v != null ? Number(v).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }) : '—';
  const fmtNum = v => v != null ? Number(v).toLocaleString('pl-PL') : '—';
  const isPrawna = r.nabywca_typ && r.nabywca_typ.toLowerCase().includes('prawna');

  const kwRow = isPrawna && r.KW
    ? `<tr class="kw-row"><td>Nr KW</td><td><strong>${r.KW}</strong></td></tr>`
    : '';

  return `<div class="rcn-popup">
    <div class="rcn-popup-title">
      ${r.rodzaj || 'Grunt / działka'}
      <span class="pill ${isPrawna ? 'pill--red' : 'pill--blue'}">${r.nabywca_typ || '—'}</span>
    </div>
    <table class="rp-table">
      <tr><td>Data transakcji</td><td><strong>${r.data_transakcji || '—'}</strong></td></tr>
      <tr><td>Ulica</td><td>${r.ulica || '—'}</td></tr>
      <tr><td>Nr działki</td><td><code>${r.numer_dzialki || '—'}</code></td></tr>
      <tr><td>Powierzchnia</td><td><strong>${fmtNum(r.powierzchnia_m2)} m²</strong></td></tr>
      <tr><td>Cena</td><td><strong>${fmtPLN(r.cena)}</strong></td></tr>
      <tr><td>Cena / m²</td><td><strong>${fmtPLN(r.cena_za_m2)}</strong></td></tr>
      <tr><td>Forma nabycia</td><td>${r.forma_nabycia || '—'}</td></tr>
      <tr><td>Nr repozytorium</td><td><code>${r.numer_repo || '—'}</code></td></tr>
      ${kwRow}
    </table>
  </div>`;
}

// ── EPSG:2180 → WGS84 ─────────────────────────────────────────
function toWGS84(x, y) {
  try {
    const [lon, lat] = proj4('EPSG:2180', 'WGS84', [x, y]);
    if (lat > 49 && lat < 51 && lon > 18 && lon < 22) return [lat, lon];
  } catch (_) {}
  return null;
}

// ── Load records onto map (ALL, no filter) ────────────────────
function loadMapData(records) {
  // If map not yet initialized, store for later
  if (!mapState.initialized) {
    mapState.pendingData = records;
    return;
  }

  mapState.cluster.clearLayers();
  mapState.allMarkers = [];

  records.forEach(r => {
    if (r._lat == null || r._lon == null) return;
    const lat = Number(r._lat), lon = Number(r._lon);
    if (!isFinite(lat) || !isFinite(lon)) return;

    const marker = L.marker([lat, lon], { icon: makeIcon(r.nabywca_typ) });
    marker.bindPopup(makePopup(r), { maxWidth: 320 });
    mapState.allMarkers.push({ marker, record: r });
    mapState.cluster.addLayer(marker);
  });

  document.getElementById('mapCount').textContent =
    mapState.allMarkers.length.toLocaleString('pl-PL');

  // Fit bounds to markers
  if (mapState.allMarkers.length > 0) {
    mapState.map.fitBounds(mapState.cluster.getBounds(), { padding: [30, 30], maxZoom: 16 });
  }
}

// ── WFS fetch helpers ─────────────────────────────────────────
function wfsURL(base, typeName, fmt) {
  const { minX, minY, maxX, maxY } = BP_BBOX;
  return `${base}?SERVICE=WFS&REQUEST=GetFeature&VERSION=2.0.0` +
    `&TYPENAMES=${typeName}&SRSNAME=urn:ogc:def:crs:EPSG::2180` +
    `&BBOX=${minX},${minY},${maxX},${maxY},urn:ogc:def:crs:EPSG::2180` +
    `&outputFormat=${encodeURIComponent(fmt)}&count=2000`;
}

function parseGeoJSON(gj) {
  if (!gj || !Array.isArray(gj.features)) return [];
  return gj.features.map(f => {
    const p = f.properties || {};
    let latlon = null;
    if (f.geometry?.type === 'Point') {
      const [x, y] = f.geometry.coordinates;
      latlon = (Math.abs(x) < 180) ? [y, x] : toWGS84(x, y);
    }
    if (!latlon) return null;
    return normalize(p, latlon);
  }).filter(Boolean);
}

function parseGML(txt) {
  // Minimal GML parser: extract pos coordinates and property elements
  const records = [];
  const memberRe = /<(?:wfs:)?(?:member|featureMember)>([\s\S]*?)<\/(?:wfs:)?(?:member|featureMember)>/g;
  let m;
  while ((m = memberRe.exec(txt)) !== null) {
    const chunk = m[1];
    const pos = chunk.match(/<(?:\w+:)?pos>([\s\S]*?)<\/(?:\w+:)?pos>/);
    if (!pos) continue;
    const parts = pos[1].trim().split(/\s+/).map(Number);
    if (parts.length < 2) continue;
    const latlon = toWGS84(parts[0], parts[1]);
    if (!latlon) continue;
    const getTag = tag => {
      const re = new RegExp(`<(?:\\w+:)?${tag}[^>]*>([^<]*)<`, 'i');
      const hit = chunk.match(re);
      return hit ? hit[1].trim() : null;
    };
    records.push(normalize({
      dataTransakcji:      getTag('dataTransakcji') || getTag('data_transakcji'),
      rodzajNieruchomosci: getTag('rodzajNieruchomosci') || getTag('rodzaj'),
      ulica:               getTag('ulica'),
      numerDzialki:        getTag('numerDzialki') || getTag('nrDzialki'),
      powierzchnia:        getTag('powierzchnia'),
      cena:                getTag('cena') || getTag('cenaTransakcji'),
      cenaZaM2:            getTag('cenaZaM2') || getTag('cena_za_m2'),
      typNabywcy:          getTag('typNabywcy') || getTag('nabywca_typ'),
      formaAktu:           getTag('formaAktu') || getTag('forma_nabycia'),
      numerRepo:           getTag('numerRepo') || getTag('identyfikator'),
      numerKW:             getTag('numerKW') || getTag('KW'),
    }, latlon));
  }
  return records;
}

function normalize(p, latlon) {
  const g = (...keys) => { for (const k of keys) { const v = p[k] ?? p[k?.toLowerCase()]; if (v != null && v !== '') return String(v).trim(); } return null; };
  const cena = parseFloat(g('cena','cenaTransakcji')) || null;
  const area = parseFloat(g('powierzchnia','powierzchnia_m2','pole')) || null;
  return {
    data_transakcji: g('dataTransakcji','data_transakcji','dataWpisania'),
    rodzaj:          g('rodzajNieruchomosci','rodzaj','typ') || 'grunt',
    ulica:           g('ulica','adres','nazwaUlicy'),
    dzielnica:       g('dzielnica','jednostkaEwidencyjna','obreb'),
    numer_dzialki:   g('numerDzialki','nrDzialki','identyfikatorDzialki'),
    powierzchnia_m2: area,
    cena:            cena,
    cena_za_m2:      cena && area ? Math.round(cena / area) : parseFloat(g('cenaZaM2','cena_za_m2')) || null,
    nabywca_typ:     g('typNabywcy','nabywca_typ','nabywca') || 'Osoba fizyczna',
    forma_nabycia:   g('formaAktu','forma_nabycia','formaPrawna'),
    numer_repo:      g('numerRepo','numer_repo','identyfikator'),
    KW:              g('numerKW','KW','ksiegaWieczysta'),
    zrodlo:          'GUGiK RCN',
    _lat:            latlon[0],
    _lon:            latlon[1],
  };
}

// ── Public: try all WFS endpoints ────────────────────────────
async function tryFetchLiveData(onSuccess, onError, onStatus) {
  for (const ep of WFS_ENDPOINTS) {
    try {
      onStatus(`Próba: ${ep.typeName}…`);
      // Try JSON
      const r1 = await fetch(wfsURL(ep.url, ep.typeName, 'application/json'),
        { signal: AbortSignal.timeout(15000) });
      if (r1.ok) {
        const ct = r1.headers.get('content-type') || '';
        if (ct.includes('json')) {
          const recs = parseGeoJSON(await r1.json());
          if (recs.length > 0) { onSuccess(recs, ep); return; }
        }
      }
      // Try GML
      const r2 = await fetch(wfsURL(ep.url, ep.typeName, 'application/gml+xml; version=3.2'),
        { signal: AbortSignal.timeout(15000) });
      if (r2.ok) {
        const txt = await r2.text();
        if (txt.includes('FeatureCollection')) {
          const recs = parseGML(txt);
          if (recs.length > 0) { onSuccess(recs, ep); return; }
        }
      }
    } catch (e) {
      onStatus(`${ep.typeName}: ${e.message}`);
    }
  }
  onError('Wszystkie endpointy WFS niedostępne z przeglądarki (CORS). Uruchom npm start.');
}
