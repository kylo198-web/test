'use strict';

/**
 * KW Tracker – Monitor Roszczeń Deweloperskich
 *
 * Serwer do śledzenia Działu III księgi wieczystej.
 * Zlicza roszczenia o wybudowanie i ustanowienie odrębnej własności lokalu
 * (umowy deweloperskie) i śledzi zmiany w czasie.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const ekw = require('./ekw');

const app = express();
const PORT = process.env.PORT || 3000;

// Plik do przechowywania historii sprawdzeń
const DATA_FILE = path.join(__dirname, 'kw-data.json');

// ── Persystencja ──────────────────────────────────────────────
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[Data] Błąd odczytu:', e.message);
  }
  return { trackedKW: {}, history: [] };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[Data] Błąd zapisu:', e.message);
  }
}

let appData = loadData();

// ── Middleware ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));
app.use(express.json({ limit: '5mb' }));

// ── API: Pobierz stan Działu III ──────────────────────────────
app.get('/api/ekw', async (req, res) => {
  try {
    const kwNumber = (req.query.kw || '').trim();
    if (!kwNumber) {
      return res.status(400).json({ ok: false, error: 'Podaj numer KW (np. ?kw=KR1P/00291452/4)' });
    }

    if (req.query.refresh) {
      ekw.clearKWCache(kwNumber);
    }

    const data = await ekw.fetchKWCached(kwNumber);

    // Zapisz w historii
    const historyEntry = {
      timestamp: new Date().toISOString(),
      kwNumber,
      developerClaimsCount: data.dzialIII?.developerClaimsCount || 0,
      totalEntriesCount: data.dzialIII?.totalEntriesCount || 0,
      success: data.success,
      error: data.error,
    };
    appData.history.push(historyEntry);

    // Zapisz aktualny stan KW
    if (data.success) {
      appData.trackedKW[kwNumber] = {
        lastCheck: historyEntry.timestamp,
        developerClaimsCount: historyEntry.developerClaimsCount,
        totalEntriesCount: historyEntry.totalEntriesCount,
        entries: data.dzialIII?.entries || [],
      };
    }

    saveData(appData);

    res.json({
      ok: data.success,
      kwNumber,
      fetchedAt: data.fetchedAt,
      error: data.error,
      info: data.info,
      dzialIII: {
        entries: data.dzialIII?.entries || [],
        developerClaimsCount: data.dzialIII?.developerClaimsCount || 0,
        totalEntriesCount: data.dzialIII?.totalEntriesCount || 0,
      },
    });
  } catch (err) {
    console.error('[API] Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── API: Ręczne wklejenie HTML Działu III ─────────────────────
app.post('/api/ekw/manual', (req, res) => {
  try {
    const { kwNumber, htmlContent, entries } = req.body;
    if (!kwNumber) {
      return res.status(400).json({ ok: false, error: 'Podaj numer KW' });
    }

    let parsedEntries = entries || [];
    if (htmlContent && parsedEntries.length === 0) {
      parsedEntries = ekw.parseDzialIII(htmlContent);
    }

    const developerClaimsCount = parsedEntries.filter(e => e.isDeveloperClaim).length;
    const now = new Date().toISOString();

    // Sprawdź czy pojawiły się nowe wpisy
    const previous = appData.trackedKW[kwNumber];
    const previousCount = previous?.developerClaimsCount || 0;
    const newEntries = developerClaimsCount - previousCount;

    // Zapisz
    appData.trackedKW[kwNumber] = {
      lastCheck: now,
      developerClaimsCount,
      totalEntriesCount: parsedEntries.length,
      entries: parsedEntries,
    };
    appData.history.push({
      timestamp: now,
      kwNumber,
      developerClaimsCount,
      totalEntriesCount: parsedEntries.length,
      success: true,
      source: 'manual',
    });
    saveData(appData);

    res.json({
      ok: true,
      kwNumber,
      fetchedAt: now,
      newEntries,
      dzialIII: {
        entries: parsedEntries,
        developerClaimsCount,
        totalEntriesCount: parsedEntries.length,
      },
      message: newEntries > 0
        ? `Znaleziono ${newEntries} NOWYCH roszczeń! (razem: ${developerClaimsCount})`
        : `Zapisano ${developerClaimsCount} roszczeń deweloperskich (bez zmian)`,
    });
  } catch (err) {
    console.error('[API Manual] Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── API: Historia sprawdzeń ───────────────────────────────────
app.get('/api/ekw/history', (req, res) => {
  const kwNumber = (req.query.kw || '').trim();
  if (!kwNumber) {
    return res.json({ ok: true, history: appData.history });
  }
  const filtered = appData.history.filter(h => h.kwNumber === kwNumber);
  const current = appData.trackedKW[kwNumber] || null;
  res.json({ ok: true, kwNumber, current, history: filtered });
});

// ── API: Walidacja numeru KW ──────────────────────────────────
app.get('/api/ekw/validate', (req, res) => {
  try {
    const kwNumber = (req.query.kw || '').trim();
    const parsed = ekw.parseKWNumber(kwNumber);
    res.json({ ok: true, ...parsed });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  KW Tracker – Monitor Roszczen Deweloperskich`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Sledzonych KW: ${Object.keys(appData.trackedKW).length}\n`);
});
