'use strict';

/* ============================================================
   RCN Map Module – Leaflet map + GUGiK WFS fetcher
   EPSG:2180 (PUWG 1992) → WGS84 coordinate conversion
   ============================================================ */

// ── EPSG:2180 definition for proj4 ───────────────────────────
proj4.defs('EPSG:2180',
  '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 ' +
  '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

// ── WFS endpoints to try ──────────────────────────────────────
const WFS_ENDPOINTS = [
  {
    url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/RCN/WFS/PointsOfObjects',
    typeName: 'rcn:ObiektTransakcji',
  },
  {
    url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/RCN/WFS/PointsOfObjects',
    typeName: 'ms:rcn_s_wfs_public',
  },
  {
    url: 'https://mapy.geoportal.gov.pl/wss/service/rcn',
    typeName: 'rcn:transakcje',
  },
];

// Kraków bounding box in EPSG:2180
const KRAKOW_BBOX_2180 = {
  minX: 437000, minY: 548000,
  maxX: 465000, maxY: 565000,
};

// ── Map state ─────────────────────────────────────────────────
const mapState = {
  map:          null,
  clusterGroup: null,
  allMarkers:   [],   // { marker, record } pairs
  initialized:  false,
};

// ── Init Leaflet map ──────────────────────────────────────────
function initMap() {
  if (mapState.initialized) return;
  mapState.initialized = true;

  mapState.map = L.map('krakowMap', {
    center: [50.0614, 19.9366],
    zoom: 12,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(mapState.map);

  mapState.clusterGroup = L.markerClusterGroup({
    maxClusterRadius: 50,
    showCoverageOnHover: false,
    iconCreateFunction: cluster => {
      const n = cluster.getChildCount();
      const size = n < 10 ? 'sm' : n < 50 ? 'md' : 'lg';
      return L.divIcon({
        html: `<div class="cluster-icon cluster-icon--${size}">${n}</div>`,
        className: '',
        iconSize: L.point(40, 40),
      });
    },
  });
  mapState.map.addLayer(mapState.clusterGroup);
}

// ── Marker icons ──────────────────────────────────────────────
function makeIcon(buyerType) {
  const isPrawna = buyerType && buyerType.toLowerCase().includes('prawna');
  const color    = isPrawna ? '#d93b2b' : '#1e6fd9';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 20 12 20S24 21 24 12C24 5.37 18.63 0 12 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="5" fill="#fff"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize:   [24, 32],
    iconAnchor: [12, 32],
    popupAnchor: [0, -32],
  });
}

// ── Popup HTML ────────────────────────────────────────────────
function buildPopup(r) {
  const isPrawna = r.nabywca_typ && r.nabywca_typ.toLowerCase().includes('prawna');
  const fmtPLN   = v => v != null ? Number(v).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }) : '—';
  const fmtNum   = v => v != null ? Number(v).toLocaleString('pl-PL') : '—';

  let kwRow = '';
  if (isPrawna && r.KW) {
    kwRow = `<tr class="popup-kw"><td>Nr KW</td><td><strong>${r.KW}</strong></td></tr>`;
  }

  return `
    <div class="rcn-popup">
      <div class="rcn-popup-title">
        Działka budowlana
        <span class="pill ${isPrawna ? 'pill--red' : 'pill--blue'}">${r.nabywca_typ || '—'}</span>
      </div>
      <table class="rcn-popup-table">
        <tr><td>Data transakcji</td><td><strong>${r.data_transakcji || '—'}</strong></td></tr>
        <tr><td>Dzielnica</td><td>${r.dzielnica || '—'}</td></tr>
        <tr><td>Powierzchnia</td><td><strong>${fmtNum(r.powierzchnia_m2)} m²</strong></td></tr>
        <tr><td>Cena</td><td><strong>${fmtPLN(r.cena)}</strong></td></tr>
        <tr><td>Cena / m²</td><td><strong>${fmtPLN(r.cena_za_m2)}</strong></td></tr>
        <tr><td>Forma nabycia</td><td>${r.forma_nabycia || '—'}</td></tr>
        <tr><td>Nr w repozytorium</td><td><code>${r.numer_repo || '—'}</code></td></tr>
        ${kwRow}
      </table>
    </div>`;
}

// ── EPSG:2180 → WGS84 ─────────────────────────────────────────
function toWGS84(x, y) {
  try {
    const [lon, lat] = proj4('EPSG:2180', 'WGS84', [x, y]);
    if (isFinite(lat) && isFinite(lon) && lat > 49 && lat < 51 && lon > 18 && lon < 22) {
      return [lat, lon];
    }
  } catch (_) {}
  return null;
}

// ── Parse GML feature collection ─────────────────────────────
function parseGML(xmlText) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(xmlText, 'application/xml');
  const members = doc.querySelectorAll('member, featureMember');
  const records  = [];

  members.forEach(m => {
    // Try to find geometry
    let latlon = null;
    const posEl = m.querySelector('pos, coordinates, Point pos');
    if (posEl) {
      const parts = posEl.textContent.trim().split(/[\s,]+/).map(Number);
      if (parts.length >= 2) latlon = toWGS84(parts[0], parts[1]);
    }

    const getText = sel => {
      const el = m.querySelector(sel);
      return el ? el.textContent.trim() : null;
    };

    if (!latlon) return; // skip features without valid location

    records.push({
      data_transakcji: getText('dataTransakcji, data_transakcji, dataWpisania'),
      powierzchnia_m2: parseFloat(getText('powierzchnia, powierzchnia_m2') || ''),
      cena:            parseFloat(getText('cena, cenaTransakcji') || ''),
      cena_za_m2:      parseFloat(getText('cenaZaM2, cena_za_m2') || ''),
      numer_repo:      getText('numerRepo, numer_repo, identyfikator'),
      KW:              getText('numerKW, KW, ksiegaWieczysta'),
      nabywca_typ:     getText('typNabywcy, nabywca_typ, nabywca') || 'Osoba fizyczna',
      dzielnica:       getText('dzielnica, jednostkaEwidencyjna'),
      forma_nabycia:   getText('formaAktu, forma_nabycia'),
      _lat:            latlon[0],
      _lon:            latlon[1],
    });
  });

  return records;
}

// ── Parse GeoJSON feature collection ─────────────────────────
function parseGeoJSON(obj) {
  if (!obj || !obj.features) return [];
  return obj.features.map(f => {
    const p = f.properties || {};
    let latlon = null;
    if (f.geometry && f.geometry.type === 'Point') {
      const [x, y] = f.geometry.coordinates;
      // Decide if coordinates are already WGS84 or EPSG:2180
      latlon = (Math.abs(x) < 180 && Math.abs(y) < 90)
        ? [y, x]
        : toWGS84(x, y);
    }
    if (!latlon) return null;
    return {
      data_transakcji: p.dataTransakcji || p.data_transakcji || p.dataWpisania || null,
      powierzchnia_m2: parseFloat(p.powierzchnia || p.powierzchnia_m2) || null,
      cena:            parseFloat(p.cena || p.cenaTransakcji) || null,
      cena_za_m2:      parseFloat(p.cenaZaM2 || p.cena_za_m2) || null,
      numer_repo:      p.numerRepo || p.numer_repo || p.identyfikator || null,
      KW:              p.numerKW || p.KW || p.ksiegaWieczysta || null,
      nabywca_typ:     p.typNabywcy || p.nabywca_typ || 'Osoba fizyczna',
      dzielnica:       p.dzielnica || p.jednostkaEwidencyjna || null,
      forma_nabycia:   p.formaAktu || p.forma_nabycia || null,
      _lat:            latlon[0],
      _lon:            latlon[1],
    };
  }).filter(Boolean);
}

// ── Fetch from WFS ────────────────────────────────────────────
async function fetchWFS(endpoint) {
  const { minX, minY, maxX, maxY } = KRAKOW_BBOX_2180;
  const params = new URLSearchParams({
    SERVICE:    'WFS',
    REQUEST:    'GetFeature',
    VERSION:    '2.0.0',
    TYPENAMES:  endpoint.typeName,
    BBOX:       `${minX},${minY},${maxX},${maxY},urn:ogc:def:crs:EPSG::2180`,
    outputFormat: 'application/json',
    count:      '500',
    SRSNAME:    'urn:ogc:def:crs:EPSG::2180',
  });

  // Try JSON first
  const url = `${endpoint.url}?${params}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('json')) {
    return parseGeoJSON(await resp.json());
  }
  // Fall back to GML parsing
  params.set('outputFormat', 'application/gml+xml; version=3.2');
  const respGML = await fetch(`${endpoint.url}?${params}`, { signal: AbortSignal.timeout(15000) });
  return parseGML(await respGML.text());
}

// ── Public: load data onto map ────────────────────────────────
function loadMapData(records) {
  initMap();
  mapState.allMarkers = [];
  mapState.clusterGroup.clearLayers();

  records.forEach(r => {
    if (!r._lat || !r._lon) return;
    const marker = L.marker([r._lat, r._lon], { icon: makeIcon(r.nabywca_typ) });
    marker.bindPopup(buildPopup(r), { maxWidth: 340 });
    mapState.allMarkers.push({ marker, record: r });
  });

  applyMapFilter();
}

// ── Public: apply map filter ──────────────────────────────────
function applyMapFilter() {
  const buyerFilter  = document.getElementById('mapFilterBuyer').value;
  const priceFilter  = parseFloat(document.getElementById('mapFilterPriceM2').value) || 0;

  mapState.clusterGroup.clearLayers();
  let count = 0;

  mapState.allMarkers.forEach(({ marker, record: r }) => {
    if (buyerFilter && r.nabywca_typ !== buyerFilter) return;
    if (priceFilter && (r.cena_za_m2 || 0) < priceFilter) return;
    mapState.clusterGroup.addLayer(marker);
    count++;
  });

  document.getElementById('mapCount').textContent = count.toLocaleString('pl-PL');
}

// ── Public: try live WFS fetch ────────────────────────────────
async function tryFetchLiveData(onSuccess, onError, onStatus) {
  for (const endpoint of WFS_ENDPOINTS) {
    try {
      onStatus(`Próba połączenia: ${endpoint.url} (${endpoint.typeName})…`);
      const records = await fetchWFS(endpoint);
      if (records.length > 0) {
        onSuccess(records, endpoint);
        return;
      }
      onStatus(`Brak danych z ${endpoint.typeName}, próba kolejnego…`);
    } catch (err) {
      onStatus(`Błąd: ${err.message} – próba kolejnego endpointu…`);
    }
  }
  onError('Nie udało się pobrać danych z serwisów GUGiK (CORS lub brak dostępu). Użyto danych testowych.');
}
