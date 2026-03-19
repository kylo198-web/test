'use strict';

/**
 * EKW Scraper Module
 * ------------------
 * Pobiera dane z przeglądarki Elektronicznych Ksiąg Wieczystych (przegladarka-ekw.ms.gov.pl).
 * Skupia się na Dziale III (prawa, roszczenia, ograniczenia) – szczególnie na roszczeniach
 * z umów deweloperskich, które świadczą o podpisaniu umowy deweloperskiej.
 *
 * Numer KW: KR1P/00291452/4
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

/**
 * Parsuje numer KW w formacie "KR1P/00291452/4" na składowe.
 */
function parseKWNumber(kwNumber) {
  const parts = kwNumber.trim().split('/');
  if (parts.length !== 3) {
    throw new Error(`Nieprawidłowy format numeru KW: ${kwNumber}. Oczekiwany: XXXX/NNNNNNNN/K`);
  }
  return {
    kodWydzialu: parts[0],
    numerKw: parts[1],
    cyfraKontrolna: parts[2],
  };
}

/**
 * Wyciąga ciasteczka z nagłówka Set-Cookie.
 */
function extractCookies(response) {
  const raw = response.headers.raw()['set-cookie'] || [];
  return raw.map(c => c.split(';')[0]).join('; ');
}

/**
 * Łączy ciasteczka z wielu odpowiedzi.
 */
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

/**
 * Parsuje wpisy Działu III z surowego HTML.
 * Wpisy to roszczenia, prawa i ograniczenia.
 * Szukamy wpisów dotyczących roszczeń o wybudowanie/ustanowienie odrębnej własności lokalu.
 */
function parseDzialIII(html) {
  const entries = [];

  // Szukamy wpisów w tabeli Działu III
  // Typowy wpis roszczenia deweloperskiego zawiera:
  // - "roszczenie"
  // - "umowa deweloperska" lub "umowa przedwstępna"
  // - "wybudowanie" lub "ustanowienie odrębnej własności"
  // - "lokal" / "mieszkanie"

  // Pattern 1: Szukamy wpisów w strukturze tabelarycznej
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    const cells = [];
    const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowHtml)) !== null) {
      cells.push(stripHtml(cellMatch[1]).trim());
    }
    if (cells.length > 0) {
      const text = cells.join(' ').toLowerCase();
      if (text.includes('roszczeni') || text.includes('umow') || text.includes('dewelop') ||
          text.includes('wybudow') || text.includes('lokal') || text.includes('odrębna własność') ||
          text.includes('odrebna wlasnosc') || text.includes('mieszka')) {
        entries.push({
          cells,
          fullText: cells.join(' | '),
          isDeveloperClaim: isDeveloperClaim(text),
        });
      }
    }
  }

  // Pattern 2: Szukamy w divach / paragrafach
  const blockPattern = /<(?:div|p|span)[^>]*class="[^"]*(?:wpis|tresc|roszczenie|entry)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p|span)>/gi;
  let blockMatch;
  while ((blockMatch = blockPattern.exec(html)) !== null) {
    const text = stripHtml(blockMatch[1]).trim();
    if (text.length > 10) {
      entries.push({
        cells: [text],
        fullText: text,
        isDeveloperClaim: isDeveloperClaim(text.toLowerCase()),
      });
    }
  }

  // Pattern 3: Szukamy wpisów po numerze poddziałki (np. "3.1", "3.2" itd.)
  const subSectionPattern = /(?:podrubryka|numer\s*wpisu|lp\.?)\s*[:.]?\s*(\d+[\.\d]*)\s*[^<]*([\s\S]*?)(?=(?:podrubryka|numer\s*wpisu|lp\.?)\s*[:.]?\s*\d|$)/gi;
  let subMatch;
  while ((subMatch = subSectionPattern.exec(html)) !== null) {
    const num = subMatch[1];
    const content = stripHtml(subMatch[2]).trim();
    if (content.length > 20 && isDeveloperClaim(content.toLowerCase())) {
      entries.push({
        cells: [num, content],
        fullText: `${num}: ${content}`,
        isDeveloperClaim: true,
        entryNumber: num,
      });
    }
  }

  // Deduplikacja
  const seen = new Set();
  return entries.filter(e => {
    const key = e.fullText.substring(0, 100);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Sprawdza, czy tekst dotyczy roszczenia deweloperskiego.
 */
function isDeveloperClaim(text) {
  const keywords = [
    'roszczeni',          // roszczenie, roszczenia
    'dewelop',            // dewelopersk*, deweloper
    'wybudow',            // wybudowanie
    'ustanowien',         // ustanowienie
    'odrębna własność',   // odrębna własność lokalu
    'odrebna wlasnosc',
    'umow',               // umowa deweloperska
  ];
  const score = keywords.reduce((s, kw) => s + (text.includes(kw) ? 1 : 0), 0);
  return score >= 2;
}

/**
 * Parsuje ogólne informacje z HTML KW.
 */
function parseKWInfo(html) {
  const info = {};

  // Tytuł / oznaczenie
  const titleMatch = html.match(/Numer\s*(?:księgi|KW)[^<]*<[^>]*>([^<]+)/i);
  if (titleMatch) info.numerKW = stripHtml(titleMatch[1]).trim();

  // Typ nieruchomości
  const typMatch = html.match(/(?:Typ|Rodzaj)\s*(?:nieruchomo|ksi)[^<]*<[^>]*>([^<]+)/i);
  if (typMatch) info.typNieruchomosci = stripHtml(typMatch[1]).trim();

  // Położenie
  const polozMatch = html.match(/(?:Poło[żz]enie|Miejscowo)[^<]*<[^>]*>([^<]+)/i);
  if (polozMatch) info.polozenie = stripHtml(polozMatch[1]).trim();

  return info;
}

/**
 * Parsuje pełne dane ze strony treści KW.
 */
function parseFullKWContent(html) {
  const sections = {
    dzialI: '',
    dzialII: '',
    dzialIII: '',
    dzialIV: '',
  };

  // Szukamy sekcji Dział III
  const dzialIIIPatterns = [
    /(?:Dzia[łl]\s*III|DZIA[ŁL]\s*III|dzia[łl]\s*trzeci)[^]*?(?=(?:Dzia[łl]\s*IV|DZIA[ŁL]\s*IV|$))/i,
    /(?:PRAWA,\s*ROSZCZENIA\s*I\s*OGRANICZENIA)[^]*?(?=(?:HIPOTEKI|Dzia[łl]\s*IV|$))/i,
    /id="[^"]*[Dd]zial[^"]*III[^"]*"[^>]*>([\s\S]*?)(?=id="[^"]*[Dd]zial[^"]*IV|$)/i,
  ];

  for (const pattern of dzialIIIPatterns) {
    const match = html.match(pattern);
    if (match) {
      sections.dzialIII = match[0];
      break;
    }
  }

  return sections;
}

/**
 * Usuwa tagi HTML.
 */
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

/**
 * Główna funkcja – pobiera i parsuje Dział III księgi wieczystej.
 *
 * Flow:
 * 1. GET strona wyszukiwania (pobranie sesji/cookies)
 * 2. POST z danymi KW (kodWydzialu, numerKw, cyfraKontrolna)
 * 3. Nawigacja do Działu III
 * 4. Parsowanie HTML
 *
 * @param {string} kwNumber - numer KW, np. "KR1P/00291452/4"
 * @returns {Object} wynik z informacjami o KW i wpisami Działu III
 */
async function fetchKW(kwNumber) {
  const { kodWydzialu, numerKw, cyfraKontrolna } = parseKWNumber(kwNumber);
  let cookies = '';
  const result = {
    kwNumber,
    kodWydzialu,
    numerKw,
    cyfraKontrolna,
    fetchedAt: new Date().toISOString(),
    success: false,
    error: null,
    info: {},
    dzialIII: {
      rawHtml: '',
      entries: [],
      developerClaimsCount: 0,
      totalEntriesCount: 0,
    },
  };

  try {
    // Step 1: GET strona wyszukiwania – pobranie sesji
    console.log(`[EKW] Step 1: Pobieranie sesji z ${EKW_BASE}/wyszukiwanieKW`);
    const searchPageResp = await fetch(
      `${EKW_BASE}/wyszukiwanieKW?komunikaty=true&kontakt=true&okienkoSerwisowe=false`,
      { headers: HEADERS, redirect: 'follow' }
    );
    cookies = mergeCookies(cookies, extractCookies(searchPageResp));
    const searchPageHtml = await searchPageResp.text();
    console.log(`[EKW] Step 1: Status ${searchPageResp.status}, cookies: ${cookies ? 'tak' : 'brak'}`);

    // Szukamy tokenu CSRF
    let csrfToken = '';
    const csrfMatch = searchPageHtml.match(/name="[^"]*(?:csrf|token|_token)[^"]*"\s*value="([^"]+)"/i);
    if (csrfMatch) {
      csrfToken = csrfMatch[1];
      console.log(`[EKW] CSRF token: ${csrfToken.substring(0, 10)}...`);
    }

    // Step 2: POST wyszukiwania KW
    console.log(`[EKW] Step 2: Wyszukiwanie KW: ${kwNumber}`);
    const formBody = new URLSearchParams();
    formBody.append('kodWydzialuInput', kodWydzialu);
    formBody.append('numerKsiegiWieczystej', numerKw);
    formBody.append('cyfraKontrolna', cyfraKontrolna);
    if (csrfToken) formBody.append('_csrf', csrfToken);

    const searchResp = await fetch(`${EKW_BASE}/wyszukiwanieKW`, {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies,
        'Referer': `${EKW_BASE}/wyszukiwanieKW?komunikaty=true&kontakt=true&okienkoSerwisowe=false`,
      },
      body: formBody.toString(),
      redirect: 'follow',
    });
    cookies = mergeCookies(cookies, extractCookies(searchResp));
    const searchResultHtml = await searchResp.text();
    console.log(`[EKW] Step 2: Status ${searchResp.status}, rozmiar HTML: ${searchResultHtml.length}`);

    // Sprawdź, czy mamy CAPTCHA
    if (searchResultHtml.includes('captcha') || searchResultHtml.includes('reCAPTCHA') || searchResultHtml.includes('g-recaptcha')) {
      result.error = 'CAPTCHA_REQUIRED';
      console.log('[EKW] CAPTCHA wykryta – automatyczne pobieranie zablokowane');
      return result;
    }

    // Sprawdź, czy znaleziono KW
    if (searchResultHtml.includes('nie znaleziono') || searchResultHtml.includes('Nie znaleziono')) {
      result.error = 'KW_NOT_FOUND';
      console.log(`[EKW] Księga wieczysta ${kwNumber} nie znaleziona`);
      return result;
    }

    // Parsujemy informacje ogólne
    result.info = parseKWInfo(searchResultHtml);

    // Step 3: Szukamy linku do Działu III
    console.log('[EKW] Step 3: Szukanie linku do Działu III');

    // Szukamy linku/przycisku do Działu III
    const dzialIIILinkPatterns = [
      /href="([^"]*(?:dzial|dział|section)[^"]*III[^"]*)"/i,
      /href="([^"]*(?:dzialIII|dzial3|dIII|d3)[^"]*)"/i,
      /href="([^"]*(?:contentDzial|pokazDzial)[^"]*3[^"]*)"/i,
      /action="([^"]*(?:dzial|section)[^"]*)"/i,
    ];

    let dzialIIIUrl = null;
    for (const pattern of dzialIIILinkPatterns) {
      const match = searchResultHtml.match(pattern);
      if (match) {
        dzialIIIUrl = match[1];
        if (!dzialIIIUrl.startsWith('http')) {
          dzialIIIUrl = `${EKW_BASE}/${dzialIIIUrl.replace(/^\//, '')}`;
        }
        break;
      }
    }

    let dzialIIIHtml = searchResultHtml; // fallback: cała strona

    if (dzialIIIUrl) {
      console.log(`[EKW] Step 3: Link do Działu III: ${dzialIIIUrl}`);
      const dzialResp = await fetch(dzialIIIUrl, {
        headers: { ...HEADERS, Cookie: cookies, Referer: `${EKW_BASE}/wyszukiwanieKW` },
        redirect: 'follow',
      });
      cookies = mergeCookies(cookies, extractCookies(dzialResp));
      dzialIIIHtml = await dzialResp.text();
      console.log(`[EKW] Step 3: Status ${dzialResp.status}, rozmiar: ${dzialIIIHtml.length}`);
    } else {
      console.log('[EKW] Step 3: Brak bezpośredniego linku – parsowanie pełnej strony');
      // Próbujemy wyciągnąć Dział III z pełnej treści
      const sections = parseFullKWContent(searchResultHtml);
      if (sections.dzialIII) {
        dzialIIIHtml = sections.dzialIII;
      }
    }

    // Step 4: Szukamy wydruku/treści – endpoint pokazWydruk
    if (dzialIIIHtml.length < 500 && !dzialIIIUrl) {
      console.log('[EKW] Step 4: Próba pobrania wydruku KW');
      try {
        const wydrukResp = await fetch(`${EKW_BASE}/pokazWydruk`, {
          method: 'POST',
          headers: {
            ...HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': cookies,
            'Referer': `${EKW_BASE}/wyszukiwanieKW`,
          },
          body: formBody.toString(),
          redirect: 'follow',
        });
        if (wydrukResp.ok) {
          const wydrukHtml = await wydrukResp.text();
          console.log(`[EKW] Step 4: Wydruk pobrany, rozmiar: ${wydrukHtml.length}`);
          const sections = parseFullKWContent(wydrukHtml);
          if (sections.dzialIII) {
            dzialIIIHtml = sections.dzialIII;
          } else {
            dzialIIIHtml = wydrukHtml;
          }
        }
      } catch (e) {
        console.log(`[EKW] Step 4: Błąd wydruku: ${e.message}`);
      }
    }

    // Step 5: Parsowanie wpisów
    console.log('[EKW] Step 5: Parsowanie wpisów Działu III');
    result.dzialIII.rawHtml = dzialIIIHtml.substring(0, 100000); // limit
    result.dzialIII.entries = parseDzialIII(dzialIIIHtml);
    result.dzialIII.developerClaimsCount = result.dzialIII.entries.filter(e => e.isDeveloperClaim).length;
    result.dzialIII.totalEntriesCount = result.dzialIII.entries.length;
    result.success = true;

    console.log(`[EKW] Gotowe: ${result.dzialIII.totalEntriesCount} wpisów, ${result.dzialIII.developerClaimsCount} roszczeń deweloperskich`);

  } catch (err) {
    result.error = err.message;
    console.error(`[EKW] Błąd: ${err.message}`);
  }

  return result;
}

/**
 * Cache wyników – aby nie odpytywać serwera przy każdym requeście.
 */
const kwCache = new Map();
const KW_CACHE_TTL = 60 * 60 * 1000; // 1 godzina

async function fetchKWCached(kwNumber) {
  const cached = kwCache.get(kwNumber);
  if (cached && Date.now() - cached.ts < KW_CACHE_TTL) {
    console.log(`[EKW Cache] Zwracam cached: ${kwNumber}`);
    return cached.data;
  }

  const data = await fetchKW(kwNumber);
  kwCache.set(kwNumber, { data, ts: Date.now() });
  return data;
}

/**
 * Czyści cache.
 */
function clearKWCache(kwNumber) {
  if (kwNumber) {
    kwCache.delete(kwNumber);
  } else {
    kwCache.clear();
  }
}

module.exports = {
  parseKWNumber,
  parseDzialIII,
  isDeveloperClaim,
  parseKWInfo,
  parseFullKWContent,
  fetchKW,
  fetchKWCached,
  clearKWCache,
  stripHtml,
};
