'use strict';

/**
 * EKW Parser Module
 * -----------------
 * Parsuje dane z przegladarki Elektronicznych Ksiag Wieczystych.
 * Obsluguje tekst skopiowany ze strony EKW (plain text, nie HTML).
 *
 * Format danych z EKW:
 * - Wzmianki: na gorze, format "N.REP.C. / NOTA / ... - data - opis"
 * - Wpisy: "Lp. N.---Nr podstawy wpisuNumer wpisuXXYYRodzaj wpisuTYPTresc wpisu..."
 */

const fetch = require('node-fetch');

const EKW_BASE = 'https://przegladarka-ekw.ms.gov.pl/eukw_prz/KsiegiWieczyste';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

function parseKWNumber(kwNumber) {
  const parts = kwNumber.trim().split('/');
  if (parts.length !== 3) {
    throw new Error(`Nieprawidlowy format numeru KW: ${kwNumber}. Oczekiwany: XXXX/NNNNNNNN/K`);
  }
  return {
    kodWydzialu: parts[0],
    numerKw: parts[1],
    cyfraKontrolna: parts[2],
  };
}

/**
 * Parsuje wzmianki z tekstu Dzialu III.
 * Wzmianki to zapowiedzi przyszlych wpisow - traktujemy je jako oczekujace roszczenia.
 *
 * W tekscie wzmianki ida ciagiem, np:
 * "1.REP.C. / NOTA / 220025 / 26 - 2026-03-16, 13:57:56
 *  1. 1DZ. KW. / KR1P / 31663 / 26 / 1 - 2026-03-19, 09:52:56 - WPIS ROSZCZENIA..."
 *
 * Kazda wzmianka DZ.KW z opisem "WPIS ROSZCZENIA O USTANOWIENIE" = oczekujacy wpis deweloperski.
 */
function parseWzmianki(text) {
  const wzmianki = [];

  // Szukamy sekcji Wzmianki
  const wzmiankiStart = text.indexOf('Wzmianki');
  if (wzmiankiStart === -1) return wzmianki;

  // Wzmianki koncza sie przed pierwszym "Lp. 1.---"
  const lpStart = text.indexOf('Lp. 1.---');
  const wzmiankiText = lpStart > wzmiankiStart
    ? text.substring(wzmiankiStart, lpStart)
    : text.substring(wzmiankiStart, Math.min(wzmiankiStart + 3000, text.length));

  // Szukamy wszystkich wzmianek DZ.KW z opisem roszczenia
  // Timestamp konczy sie na SS i nastepny numer wzmianki zaczyna sie bezposrednio
  // np: "13:57:561. 1DZ." -> czas=13:57:56, potem "1. 1DZ."
  const dzKwPattern = /DZ\.\s*KW\.\s*\/\s*([A-Z0-9]+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*-\s*(\d{4}-\d{2}-\d{2}),?\s*(\d{2}:\d{2}:\d{2})\s*-\s*([\s\S]*?)(?=\d+\.\s*(?:REP\.C\.|DZ\.)|$)/gi;

  let match;
  let wzNr = 0;
  while ((match = dzKwPattern.exec(wzmiankiText)) !== null) {
    wzNr++;
    const description = match[7].trim().replace(/\s+/g, ' ');
    const documentRef = `DZ. KW. / ${match[1]} / ${match[2]} / ${match[3]} / ${match[4]}`;
    wzmianki.push({
      wzmiankaNr: String(wzNr),
      documentRef,
      date: match[5],
      time: match[6] || '',
      description,
      isDeveloperClaim: /roszczeni|ustanowien|odr[eę]bn|w[łl]asno[sś]|lokalu|przeniesien/i.test(description),
    });
  }

  return wzmianki;
}

/**
 * Parsuje wpisy Dzialu III z tekstu skopiowanego z EKW.
 *
 * Struktura tekstu:
 * "Lp. N.---Nr podstawy wpisuNumer wpisuXXYYRodzaj wpisuTYPTresc wpisuTEKST..."
 *
 * Kazdy wpis zaczyna sie od "Lp. N.---" i konczy przed nastepnym "Lp. N+1.---"
 */
function parseDzialIII(text) {
  const entries = [];

  // Usun tagi HTML jesli sa
  const cleanText = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

  // 1. Parsuj wzmianki
  const wzmianki = parseWzmianki(cleanText);
  for (const wz of wzmianki) {
    if (wz.isDeveloperClaim) {
      entries.push({
        type: 'wzmianka',
        entryNumber: `Wzmianka ${wz.wzmiankaNr}`,
        rodzajWpisu: 'WZMIANKA (oczekujacy wpis)',
        fullText: `${wz.description} [${wz.documentRef}] z dnia ${wz.date}`,
        isDeveloperClaim: true,
        apartmentNumber: null,
        people: [],
        date: wz.date,
      });
    }
  }

  // 2. Parsuj wpisy - rozdzielamy po "Lp. N.---"
  const entryBlocks = cleanText.split(/(?=Lp\.\s*\d+\.\s*---)/);

  for (const block of entryBlocks) {
    const lpMatch = block.match(/^Lp\.\s*(\d+)\.\s*---/);
    if (!lpMatch) continue;

    const lp = lpMatch[1];

    // Numer wpisu - szukamy miedzy "Numer wpisu" a "Rodzaj wpisu"
    const numerWpisuMatch = block.match(/Numer\s*wpisu\s*(\d[\d,\s]*)/i);
    const numerWpisu = numerWpisuMatch ? numerWpisuMatch[1].trim() : '';

    // Rodzaj wpisu - wszystko miedzy "Rodzaj wpisu" a "Tresc wpisu"
    const rodzajMatch = block.match(/Rodzaj\s*wpisu\s*([\s\S]*?)(?=Tre[sś][cć]\s*wpisu)/i);
    const rodzajWpisu = rodzajMatch ? rodzajMatch[1].trim() : '';

    // Tresc wpisu - miedzy "Tresc wpisu" a "Osoba fizyczna" lub "Wskazania" lub koniec
    const trescMatch = block.match(/Tre[sś][cć]\s*wpisu\s*([\s\S]*?)(?=Osoba\s*fizyczna|Wskazania\s*innej|Rodzaj\s*zmiany|$)/i);
    const trescWpisu = trescMatch ? trescMatch[1].trim() : '';

    // Numer mieszkania
    const aptMatch = trescWpisu.match(/(?:NUMER(?:EM)?|OZNACZON(?:EGO|YM)\s*ROBOCZO\s*NUMEREM)\s*(\d+)/i);
    const apartmentNumber = aptMatch ? aptMatch[1] : null;

    // Osoby
    const people = extractPeople(block);

    // Czy to roszczenie deweloperskie
    const isDev = isDeveloperClaim(trescWpisu) || isDeveloperClaim(rodzajWpisu + ' ' + trescWpisu);

    entries.push({
      type: 'wpis',
      entryNumber: `Lp. ${lp} (wpis nr ${numerWpisu})`,
      lp: parseInt(lp),
      numerWpisu,
      rodzajWpisu,
      fullText: trescWpisu,
      isDeveloperClaim: isDev,
      apartmentNumber,
      people,
    });
  }

  return entries;
}

/**
 * Wyciaga osoby z bloku wpisu.
 */
function extractPeople(block) {
  const people = [];
  // Szukamy osob po "Lp. N." wewnatrz sekcji "Osoba fizyczna"
  const personSection = block.match(/Osoba\s*fizyczna[^)]*\)([\s\S]*?)(?=Lp\.\s*\d+\.\s*---|$)/i);
  if (!personSection) return people;

  const personText = personSection[1];
  // Kazda osoba: "Lp. N.IMIE NAZWISKO , ..."
  const personPattern = /Lp\.\s*\d+\.\s*([A-ZŁŚŻŹĆŃÓĘĄ][A-ZŁŚŻŹĆŃÓĘĄ\s-]+?)\s*,\s*([A-ZŁŚŻŹĆŃÓĘĄ]+)\s*,\s*([A-ZŁŚŻŹĆŃÓĘĄ]+)\s*,\s*(\d{11})/gi;
  let match;
  while ((match = personPattern.exec(personText)) !== null) {
    people.push({
      name: match[1].trim(),
      fatherName: match[2].trim(),
      motherName: match[3].trim(),
      pesel: match[4],
    });
  }
  return people;
}

/**
 * Sprawdza czy tekst dotyczy roszczenia deweloperskiego.
 */
function isDeveloperClaim(text) {
  const lower = text.toLowerCase();
  const patterns = [
    /roszczeni/,
    /wybudow/,
    /ustanowien.*odr[eę]bn/,
    /odr[eę]bn.*w[łl]asno[sś]/,
    /lokalu?\s*mieszk/,
    /przeniesieni.*praw/,
    /wyodr[eę]bni/,
  ];
  const score = patterns.reduce((s, p) => s + (p.test(lower) ? 1 : 0), 0);
  return score >= 2;
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Fetch (automatyczny - blokowany przez CAPTCHA) ────────────

function extractCookies(response) {
  const raw = response.headers.raw()['set-cookie'] || [];
  return raw.map(c => c.split(';')[0]).join('; ');
}

function mergeCookies(existing, newCookies) {
  if (!newCookies) return existing;
  const map = {};
  [existing, newCookies].forEach(str => {
    if (!str) return;
    str.split('; ').filter(Boolean).forEach(pair => {
      const [key] = pair.split('=');
      map[key] = pair;
    });
  });
  return Object.values(map).join('; ');
}

async function fetchKW(kwNumber) {
  const { kodWydzialu, numerKw, cyfraKontrolna } = parseKWNumber(kwNumber);
  let cookies = '';
  const result = {
    kwNumber,
    fetchedAt: new Date().toISOString(),
    success: false,
    error: null,
    info: { numerKW: kwNumber },
    dzialIII: { entries: [], developerClaimsCount: 0, totalEntriesCount: 0 },
  };

  try {
    console.log(`[EKW] Pobieranie sesji...`);
    const searchPageResp = await fetch(
      `${EKW_BASE}/wyszukiwanieKW?komunikaty=true&kontakt=true&okienkoSerwisowe=false`,
      { headers: HEADERS, redirect: 'follow' }
    );
    cookies = mergeCookies(cookies, extractCookies(searchPageResp));
    const searchPageHtml = await searchPageResp.text();

    if (searchPageHtml.includes('captcha') || searchPageHtml.includes('reCAPTCHA') || searchPageHtml.includes('g-recaptcha')) {
      result.error = 'CAPTCHA_REQUIRED';
      return result;
    }

    result.error = 'CAPTCHA_REQUIRED';
    return result;
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

const kwCache = new Map();
const KW_CACHE_TTL = 60 * 60 * 1000;

async function fetchKWCached(kwNumber) {
  const cached = kwCache.get(kwNumber);
  if (cached && Date.now() - cached.ts < KW_CACHE_TTL) {
    return cached.data;
  }
  const data = await fetchKW(kwNumber);
  kwCache.set(kwNumber, { data, ts: Date.now() });
  return data;
}

function clearKWCache(kwNumber) {
  if (kwNumber) kwCache.delete(kwNumber);
  else kwCache.clear();
}

module.exports = {
  parseKWNumber,
  parseDzialIII,
  parseWzmianki,
  isDeveloperClaim,
  extractPeople,
  fetchKW,
  fetchKWCached,
  clearKWCache,
  stripHtml,
};
