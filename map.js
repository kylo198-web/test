'use strict';
/* ============================================================
   RCN Map – full-screen layout, hover tooltips, detail panel
   KW shown when nabywca OR zbywca is osoba prawna
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

// ── Public map state ─────────────────────────────────────────
const mapState = {
  map:        null,
  cluster:    null,
  allMarkers: [],
};

// ── Format helpers (also used in tooltips) ───────────────────
const _fmtPLN = v => v != null ? Number(v).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }) : '—';
const _fmtNum = v => v != null ? Number(v).toLocaleString('pl-PL') : '—';

function _isPrawna(r) {
  return (r.nabywca_typ && r.nabywca_typ.toLowerCase().includes('prawna')) ||
         (r.zbywca_typ  && r.zbywca_typ.toLowerCase().includes('prawna'));
}

// ── Init map (called immediately in app.js DOMContentLoaded) ─
function initMap() {
  mapState.map = L.map('krakowMap', {
    center: [50.010, 20.005],
    zoom:   13,
    zoomControl: false,
  });

  L.control.zoom({ position: 'bottomright' }).addTo(mapState.map);

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

  // Cluster hover: aggregate tooltip
  mapState.cluster.on('clustermouseover', e => {
    const children = e.layer.getAllChildMarkers();
    const prices = children.map(m => m._rcnRecord?.cena).filter(v => v != null && isFinite(+v));
    const pm2s   = children.map(m => m._rcnRecord?.cena_za_m2).filter(v => v != null && isFinite(+v));
    const totalCena = prices.reduce((a, b) => a + +b, 0);
    const avgPm2    = pm2s.length ? Math.round(pm2s.reduce((a, b) => a + +b, 0) / pm2s.length) : null;
    const tip = `<div class="map-hover-tip">
      <div class="tip-street">${children.length} transakcji w grupie</div>
      <hr class="tip-divider"/>
      ${totalCena ? `<div class="tip-row"><span>Suma cen:</span><strong>${_fmtPLN(totalCena)}</strong></div>` : ''}
      ${avgPm2   ? `<div class="tip-row"><span>Śred. cena/m²:</span><strong>${_fmtPLN(avgPm2)}</strong></div>` : ''}
    </div>`;
    e.layer.bindTooltip(tip, { className: 'rcn-tooltip', sticky: true, direction: 'top' }).openTooltip();
  });

  mapState.map.addLayer(mapState.cluster);
}

// ── Marker icon ──────────────────────────────────────────────
function makeIcon(nabywcaTyp, zbywcaTyp) {
  const red = (nabywcaTyp && nabywcaTyp.toLowerCase().includes('prawna')) ||
              (zbywcaTyp  && zbywcaTyp.toLowerCase().includes('prawna'));
  const c   = red ? '#ef4444' : '#3b82f6';
  return L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30">
      <path d="M11 0C4.9 0 0 4.9 0 11c0 8.3 11 19 11 19S22 19.3 22 11C22 4.9 17.1 0 11 0z"
            fill="${c}" stroke="#fff" stroke-width="1.5"/>
      <circle cx="11" cy="11" r="4.5" fill="#fff"/>
    </svg>`,
    className:   '',
    iconSize:    [22, 30],
    iconAnchor:  [11, 30],
    popupAnchor: [0, -32],
  });
}

// ── Hover tooltip (single marker) ───────────────────────────
function makeTip(r) {
  const prawna = _isPrawna(r);
  return `<div class="map-hover-tip">
    <div class="tip-street">${r.ulica || 'ul. nieznana'}</div>
    <hr class="tip-divider"/>
    <div class="tip-row"><span>Data:</span><strong>${r.data_transakcji || '—'}</strong></div>
    <div class="tip-row"><span>Cena:</span><strong>${_fmtPLN(r.cena)}</strong></div>
    <div class="tip-row"><span>Cena/m²:</span><strong>${_fmtPLN(r.cena_za_m2)}</strong></div>
    <div class="tip-row"><span>Pow.:</span><strong>${_fmtNum(r.powierzchnia_m2)} m²</strong></div>
    ${prawna && r.KW ? `<hr class="tip-divider"/><div class="tip-row tip-kw"><span>Nr KW:</span><strong>${r.KW}</strong></div>` : ''}
  </div>`;
}

// ── Load records onto map ────────────────────────────────────
function loadMapData(records) {
  mapState.cluster.clearLayers();
  mapState.allMarkers = [];

  records.forEach(r => {
    if (r._lat == null || r._lon == null) return;
    const lat = Number(r._lat), lon = Number(r._lon);
    if (!isFinite(lat) || !isFinite(lon)) return;

    const marker = L.marker([lat, lon], { icon: makeIcon(r.nabywca_typ, r.zbywca_typ) });
    marker._rcnRecord = r;

    // Hover tooltip
    marker.bindTooltip(makeTip(r), {
      className:  'rcn-tooltip',
      sticky:     false,
      direction:  'top',
      offset:     [0, -28],
    });

    // Click: show detail panel + highlight sidebar item
    marker.on('click', () => {
      if (typeof showDetail === 'function') showDetail(r);
      document.querySelectorAll('.tx-item.active').forEach(el => el.classList.remove('active'));
      const el = document.querySelector(`.tx-item[data-id="${r._id}"]`);
      if (el) { el.classList.add('active'); el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    });

    mapState.allMarkers.push({ marker, record: r });
    mapState.cluster.addLayer(marker);
  });

  const el = document.getElementById('mapCount');
  if (el) el.textContent = mapState.allMarkers.length.toLocaleString('pl-PL');

  if (mapState.allMarkers.length > 0) {
    mapState.map.fitBounds(mapState.cluster.getBounds(), { padding: [30, 30], maxZoom: 16 });
  }
}

// ── EPSG:2180 → WGS84 ────────────────────────────────────────
function toWGS84(x, y) {
  try {
    const [lon, lat] = proj4('EPSG:2180', 'WGS84', [x, y]);
    if (lat > 49 && lat < 51 && lon > 18 && lon < 22) return [lat, lon];
  } catch (_) {}
  return null;
}

// ── WFS URL builder ──────────────────────────────────────────
function wfsURL(base, typeName, fmt) {
  const { minX, minY, maxX, maxY } = BP_BBOX;
  return `${base}?SERVICE=WFS&REQUEST=GetFeature&VERSION=2.0.0` +
    `&TYPENAMES=${typeName}&SRSNAME=urn:ogc:def:crs:EPSG::2180` +
    `&BBOX=${minX},${minY},${maxX},${maxY},urn:ogc:def:crs:EPSG::2180` +
    `&outputFormat=${encodeURIComponent(fmt)}&count=2000`;
}

// ── GeoJSON parser ───────────────────────────────────────────
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

// ── GML parser ───────────────────────────────────────────────
function parseGML(txt) {
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
      dataTransakcji:      getTag('dataTransakcji')      || getTag('data_transakcji'),
      rodzajNieruchomosci: getTag('rodzajNieruchomosci') || getTag('rodzaj'),
      ulica:               getTag('ulica'),
      numerDzialki:        getTag('numerDzialki')        || getTag('nrDzialki'),
      powierzchnia:        getTag('powierzchnia'),
      cena:                getTag('cena')                || getTag('cenaTransakcji'),
      cenaZaM2:            getTag('cenaZaM2')            || getTag('cena_za_m2'),
      typNabywcy:          getTag('typNabywcy')          || getTag('nabywca_typ'),
      typZbywcy:           getTag('typZbywcy')           || getTag('zbywca_typ'),
      formaAktu:           getTag('formaAktu')           || getTag('forma_nabycia'),
      numerRepo:           getTag('numerRepo')           || getTag('identyfikator'),
      numerKW:             getTag('numerKW')             || getTag('KW'),
    }, latlon));
  }
  return records;
}

// ── Normalize (shared for GeoJSON + GML) ────────────────────
let _idSeq = 0;
function normalize(p, latlon) {
  const g = (...keys) => {
    for (const k of keys) {
      const v = p[k] ?? p[k?.toLowerCase()];
      if (v != null && v !== '') return String(v).trim();
    }
    return null;
  };
  const cena = parseFloat(g('cena', 'cenaTransakcji')) || null;
  const area = parseFloat(g('powierzchnia', 'powierzchnia_m2', 'pole')) || null;
  return {
    _id:             ++_idSeq,
    data_transakcji: g('dataTransakcji', 'data_transakcji', 'dataWpisania'),
    rodzaj:          g('rodzajNieruchomosci', 'rodzaj', 'typ') || 'grunt',
    ulica:           g('ulica', 'adres', 'nazwaUlicy'),
    dzielnica:       g('dzielnica', 'jednostkaEwidencyjna', 'obreb'),
    numer_dzialki:   g('numerDzialki', 'nrDzialki', 'identyfikatorDzialki'),
    powierzchnia_m2: area,
    cena:            cena,
    cena_za_m2:      cena && area ? Math.round(cena / area) : parseFloat(g('cenaZaM2', 'cena_za_m2')) || null,
    nabywca_typ:     g('typNabywcy', 'nabywca_typ', 'nabywca') || 'Osoba fizyczna',
    zbywca_typ:      g('typZbywcy', 'zbywca_typ', 'zbywca') || null,
    forma_nabycia:   g('formaAktu', 'forma_nabycia', 'formaPrawna'),
    numer_repo:      g('numerRepo', 'numer_repo', 'identyfikator'),
    KW:              g('numerKW', 'KW', 'ksiegaWieczysta'),
    zrodlo:          'GUGiK RCN',
    _lat:            latlon[0],
    _lon:            latlon[1],
  };
}

// ── Try all WFS endpoints ────────────────────────────────────
async function tryFetchLiveData(onSuccess, onError, onStatus) {
  for (const ep of WFS_ENDPOINTS) {
    try {
      onStatus(`Próba: ${ep.typeName}…`);
      // Try JSON first
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
