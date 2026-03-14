'use strict';

/**
 * RCN Proxy Server
 * ----------------
 * Pobiera dane z serwisu WFS GUGiK po stronie serwera (omija CORS/403 z przeglądarki).
 * Skupia się na: działki i domy – Bieżanów-Prokocim, Kraków.
 * Dane dostępne w RCN: od 31 lipca 2021 r.
 */

const express  = require('express');
const fetch    = require('node-fetch');
const xml2js   = require('xml2js');
const proj4    = require('proj4');
const path     = require('path');

// ── EPSG:2180 (PUWG 1992) definition ──────────────────────────
proj4.defs('EPSG:2180',
  '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 ' +
  '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

const app  = express();
const PORT = process.env.PORT || 3000;

// Serve frontend static files
app.use(express.static(path.join(__dirname)));

// ── WFS endpoint candidates ────────────────────────────────────
const WFS_BASES = [
  'https://mapy.geoportal.gov.pl/wss/service/PZGIK/RCN/WFS/PointsOfObjects',
  'https://mapy.geoportal.gov.pl/wss/service/rcn',
  'https://mapy.geoportal.gov.pl/wss/service/PZGIK/RCN/WFS/TransactionObjects',
];

// Type names to try
const TYPE_NAMES = [
  'rcn:ObiektTransakcji',
  'ms:rcn_s_wfs_public',
  'rcn:transakcje',
  'RCN:PointsOfObjects',
  'rcn:grunty',
  'rcn:DzialkaB',
];

// ── Bieżanów-Prokocim bounding boxes ──────────────────────────
// EPSG:2180 (PUWG 1992) – computed from WGS84 bounds
// WGS84: lat 49.990–50.040, lon 19.960–20.060
const BBOX_2180 = computeBBox([
  [19.960, 49.990],
  [20.060, 50.040],
]);

// Street-specific bounding boxes (WGS84)
const STREETS = {
  'Walenroda': {
    bbox_wgs84: [19.990, 49.998, 20.015, 50.010],
    bbox_2180:  computeBBox([[19.990, 49.998], [20.015, 50.010]]),
  },
  'Sciegiennego': {
    bbox_wgs84: [19.965, 50.010, 19.990, 50.028],
    bbox_2180:  computeBBox([[19.965, 50.010], [19.990, 50.028]]),
  },
};

function computeBBox(corners) {
  const pts = corners.map(([lon, lat]) => proj4('WGS84', 'EPSG:2180', [lon, lat]));
  return {
    minX: Math.min(...pts.map(p => p[0])),
    minY: Math.min(...pts.map(p => p[1])),
    maxX: Math.max(...pts.map(p => p[0])),
    maxY: Math.max(...pts.map(p => p[1])),
  };
}

// ── Coordinate converter ───────────────────────────────────────
function toWGS84(x, y) {
  try {
    const [lon, lat] = proj4('EPSG:2180', 'WGS84', [x, y]);
    if (isFinite(lat) && isFinite(lon) && lat > 49 && lat < 51 && lon > 18 && lon < 22) {
      return { lat, lon };
    }
  } catch (_) {}
  return null;
}

// ── Build WFS GetCapabilities URL ──────────────────────────────
function capsURL(base) {
  return `${base}?SERVICE=WFS&REQUEST=GetCapabilities&VERSION=2.0.0`;
}

// ── Build WFS GetFeature URL ───────────────────────────────────
function featureURL(base, typeName, bbox, outputFormat = 'application/json', count = 1000) {
  const { minX, minY, maxX, maxY } = bbox;
  const p = new URLSearchParams({
    SERVICE:      'WFS',
    REQUEST:      'GetFeature',
    VERSION:      '2.0.0',
    TYPENAMES:    typeName,
    SRSNAME:      'urn:ogc:def:crs:EPSG::2180',
    BBOX:         `${minX},${minY},${maxX},${maxY},urn:ogc:def:crs:EPSG::2180`,
    outputFormat,
    count:        String(count),
  });
  return `${base}?${p}`;
}

// ── Parse GeoJSON response ─────────────────────────────────────
function parseGeoJSON(gj) {
  if (!gj || !gj.features) return [];
  return gj.features.map(f => {
    const p = f.properties || {};
    let coords = null;
    if (f.geometry?.type === 'Point') {
      const [x, y] = f.geometry.coordinates;
      coords = (Math.abs(x) < 180 && Math.abs(y) < 90) ? { lat: y, lon: x } : toWGS84(x, y);
    }
    if (!coords) return null;

    return normalizeRecord(p, coords);
  }).filter(Boolean);
}

// ── Parse GML response ─────────────────────────────────────────
async function parseGML(xmlText) {
  const doc = await xml2js.parseStringPromise(xmlText, { explicitArray: false, tagNameProcessors: [xml2js.processors.stripPrefix] });
  const records = [];

  const findMembers = obj => {
    if (!obj || typeof obj !== 'object') return [];
    if (obj.member)        return Array.isArray(obj.member)        ? obj.member        : [obj.member];
    if (obj.featureMember) return Array.isArray(obj.featureMember) ? obj.featureMember : [obj.featureMember];
    return [];
  };

  const members = findMembers(doc.FeatureCollection || doc['wfs:FeatureCollection'] || doc);

  members.forEach(m => {
    const feature = Object.values(m).find(v => v && typeof v === 'object') || m;
    const p = feature.$ ? feature : feature;

    // Extract geometry
    let coords = null;
    const posStr = getNestedStr(p, ['Point', 'pos']) || getNestedStr(p, ['geometry', 'Point', 'pos']) || getNestedStr(p, ['geometria', 'Point', 'pos']);
    if (posStr) {
      const [x, y] = posStr.trim().split(/\s+/).map(Number);
      if (isFinite(x) && isFinite(y)) coords = toWGS84(x, y);
    }
    if (!coords) return;

    records.push(normalizeRecord(p, coords));
  });

  return records;
}

function getNestedStr(obj, path) {
  let cur = obj;
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return null;
    cur = cur[k] || cur[k.toLowerCase()];
  }
  return cur && typeof cur === 'string' ? cur : (cur?._ ?? null);
}

// ── Normalize a raw property object into our schema ────────────
function normalizeRecord(p, coords) {
  const get = (...keys) => {
    for (const k of keys) {
      const v = p[k] ?? p[k.toLowerCase()] ?? p[k.toUpperCase()];
      if (v !== undefined && v !== null && v !== '') return String(v).trim();
    }
    return null;
  };

  const cena         = parseFloat(get('cena', 'cenaTransakcji', 'wartosc', 'price')) || null;
  const powierzchnia = parseFloat(get('powierzchnia', 'powierzchnia_m2', 'pole', 'area')) || null;
  const cenaM2       = cena && powierzchnia ? Math.round(cena / powierzchnia) : parseFloat(get('cenaZaM2', 'cena_za_m2')) || null;

  return {
    data_transakcji: get('dataTransakcji', 'data_transakcji', 'dataWpisania', 'dataCzynnosci', 'date'),
    rodzaj:          get('rodzajNieruchomosci', 'rodzaj', 'typ', 'type', 'typNieruchomosci') || 'grunt',
    dzielnica:       get('dzielnica', 'jednostkaEwidencyjna', 'obreb', 'district'),
    ulica:           get('ulica', 'adres', 'nazwaUlicy', 'street'),
    numer_dzialki:   get('numerDzialki', 'nrDzialki', 'parcelNumber', 'identyfikatorDzialki'),
    powierzchnia_m2: powierzchnia,
    cena:            cena,
    cena_za_m2:      cenaM2,
    nabywca_typ:     get('typNabywcy', 'nabywca_typ', 'nabywca', 'buyerType') || 'Osoba fizyczna',
    forma_nabycia:   get('formaAktu', 'forma_nabycia', 'formaPrawna', 'acquisitionForm'),
    numer_repo:      get('numerRepo', 'numer_repo', 'identyfikator', 'id'),
    KW:              get('numerKW', 'KW', 'ksiegaWieczysta', 'landRegister'),
    zrodlo:          'GUGiK RCN WFS',
    _lat:            coords.lat,
    _lon:            coords.lon,
  };
}

// ── Try to fetch from one WFS base + typeName ──────────────────
async function tryFetch(base, typeName, bbox) {
  const headers = {
    'User-Agent': 'RCN-Analyzer/2.0 (educational; contact: rcn-analyzer@example.com)',
    'Accept': 'application/json, application/gml+xml;version=3.2, text/xml',
  };

  // Try JSON first
  const urlJSON = featureURL(base, typeName, bbox, 'application/json');
  console.log(`[WFS] Trying JSON: ${urlJSON}`);
  try {
    const resp = await fetch(urlJSON, { headers, timeout: 20000 });
    if (resp.ok) {
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('json')) {
        const data = await resp.json();
        if (data.features?.length) {
          console.log(`[WFS] ✓ JSON: ${data.features.length} features from ${typeName}`);
          return parseGeoJSON(data);
        }
      }
    }
    console.log(`[WFS] JSON response: ${resp.status}`);
  } catch (e) {
    console.log(`[WFS] JSON error: ${e.message}`);
  }

  // Try GML
  const urlGML = featureURL(base, typeName, bbox, 'application/gml+xml; version=3.2');
  console.log(`[WFS] Trying GML: ${urlGML}`);
  try {
    const resp = await fetch(urlGML, { headers, timeout: 20000 });
    if (resp.ok) {
      const text = await resp.text();
      if (text.includes('FeatureCollection') || text.includes('featureMember')) {
        const records = await parseGML(text);
        if (records.length) {
          console.log(`[WFS] ✓ GML: ${records.length} features from ${typeName}`);
          return records;
        }
      }
      console.log(`[WFS] GML empty or error response`);
    } else {
      console.log(`[WFS] GML response: ${resp.status}`);
    }
  } catch (e) {
    console.log(`[WFS] GML error: ${e.message}`);
  }

  return null;
}

// ── Get capabilities to discover type names ────────────────────
async function getCapabilities(base) {
  try {
    const resp = await fetch(capsURL(base), {
      headers: { 'User-Agent': 'RCN-Analyzer/2.0' },
      timeout: 10000,
    });
    if (!resp.ok) return [];
    const text = await resp.text();
    const matches = text.match(/Name[^>]*>([^<]+)</g) || [];
    return matches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(n => n && n.includes(':'));
  } catch (_) {
    return [];
  }
}

// ── Simple in-memory cache ─────────────────────────────────────
const cache = { data: null, ts: 0 };
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// ── Main fetch logic ───────────────────────────────────────────
async function fetchRCNData() {
  if (cache.data && Date.now() - cache.ts < CACHE_TTL) {
    console.log('[Cache] Returning cached data');
    return cache.data;
  }

  const results = [];

  for (const base of WFS_BASES) {
    // First try to discover type names from capabilities
    console.log(`\n[WFS] Querying capabilities: ${base}`);
    const discoveredTypes = await getCapabilities(base);
    const typeNamesToTry = discoveredTypes.length > 0
      ? [...new Set([...discoveredTypes, ...TYPE_NAMES])]
      : TYPE_NAMES;

    for (const typeName of typeNamesToTry) {
      const records = await tryFetch(base, typeName, BBOX_2180);
      if (records && records.length > 0) {
        results.push(...records);
        // Also try specific street bboxes for higher granularity
        for (const [streetName, streetInfo] of Object.entries(STREETS)) {
          const streetRecords = await tryFetch(base, typeName, streetInfo.bbox_2180);
          if (streetRecords) {
            // Merge, avoid duplicates by numer_repo
            const existing = new Set(results.map(r => r.numer_repo).filter(Boolean));
            streetRecords.forEach(r => {
              if (!r.numer_repo || !existing.has(r.numer_repo)) {
                r.ulica_hint = streetName;
                results.push(r);
              }
            });
          }
        }

        // Cache and return first working combination
        cache.data = results;
        cache.ts   = Date.now();
        return results;
      }
    }
  }

  return results; // empty if all failed
}

// ── API routes ─────────────────────────────────────────────────

/**
 * GET /api/rcn
 * Returns all available RCN transactions for Bieżanów-Prokocim.
 * Query params:
 *   street=walenroda|sciegiennego  (optional – filter by street bbox)
 *   refresh=1                       (optional – bust cache)
 */
app.get('/api/rcn', async (req, res) => {
  try {
    if (req.query.refresh) {
      cache.data = null;
      console.log('[Cache] Cleared by request');
    }

    const data = await fetchRCNData();

    // Optional street filter
    const street = (req.query.street || '').toLowerCase();
    let filtered = data;
    if (street === 'walenroda') {
      const b = STREETS.Walenroda.bbox_wgs84;
      filtered = data.filter(r => r._lat >= b[1] && r._lat <= b[3] && r._lon >= b[0] && r._lon <= b[2]);
    } else if (street === 'sciegiennego') {
      const b = STREETS.Sciegiennego.bbox_wgs84;
      filtered = data.filter(r => r._lat >= b[1] && r._lat <= b[3] && r._lon >= b[0] && r._lon <= b[2]);
    }

    res.json({
      ok:      true,
      count:   filtered.length,
      source:  filtered.length > 0 ? 'GUGiK RCN WFS' : 'empty',
      note:    'Dane RCN dostępne od 31 lipca 2021 r. (data uruchomienia rejestru).',
      records: filtered,
    });
  } catch (err) {
    console.error('[API] Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/capabilities
 * Returns WFS GetCapabilities info for debugging.
 */
app.get('/api/capabilities', async (req, res) => {
  const results = {};
  for (const base of WFS_BASES) {
    results[base] = await getCapabilities(base);
  }
  res.json(results);
});

/**
 * GET /api/status
 * Health check + data summary.
 */
app.get('/api/status', (req, res) => {
  res.json({
    ok:          true,
    cachedCount: cache.data?.length ?? 0,
    cacheAge:    cache.ts ? Math.round((Date.now() - cache.ts) / 1000) + 's' : 'empty',
    coverage:    'Bieżanów-Prokocim, Kraków',
    rcnSince:    '2021-07-31',
  });
});

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║   RCN Proxy Server – Bieżanów-Prokocim, Kraków  ║`);
  console.log(`║   http://localhost:${PORT}                          ║`);
  console.log(`║   API: http://localhost:${PORT}/api/rcn              ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);
  console.log(`ℹ  Dane RCN dostępne od: 31 lipca 2021 r.`);
  console.log(`ℹ  Obszar: Bieżanów-Prokocim + ul. Walenroda + ul. Ściegiennego\n`);
});
