import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GAME_START_DATE = "2025-01-01";
const PREFERRED_DATA_YEAR = 2024;
const FALLBACK_DATA_YEAR = 2023;
const IMF_BASE_URL = "https://www.imf.org/external/datamapper/api/v1";
const COUNTRY_META_URL = `${IMF_BASE_URL}/countries`;
const CHUNK_SIZE = 50;

const IMF_WEO_INDICATORS = {
  realGdpGrowthPct: "NGDP_RPCH",
  gdpCurrentUsdBillions: "NGDPD",
  gdpPerCapitaCurrentUsd: "NGDPDPC",
  inflationAverageConsumerPricesPct: "PCPIPCH",
  currentAccountBalancePctOfGdp: "BCA_NGDPD",
  governmentNetLendingBorrowingPctOfGdp: "GGXCNL_NGDP",
  governmentGrossDebtPctOfGdp: "GGXWDG_NGDP",
};

const indicatorEntries = Object.entries(IMF_WEO_INDICATORS);
const indicatorKeys = indicatorEntries.map(([key]) => key);
const indicatorCodeToKey = Object.fromEntries(indicatorEntries.map(([key, code]) => [code, key]));

function isValidIso3(value) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

function isLikelyAggregateName(name) {
  const normalized = String(name ?? "").toLowerCase();
  const aggregateKeywords = [
    "world",
    "advanced economies",
    "emerging market",
    "developing",
    "euro area",
    "sub-saharan",
    "latin america",
    "asia",
    "middle east",
    "africa",
    "group",
    "union",
    "income",
  ];
  return aggregateKeywords.some((keyword) => normalized.includes(keyword));
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function parseNumeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "*",
      "Accept-Language": "*",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return response.json();
}

async function fetchJsonWithStatus(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "*",
      "Accept-Language": "*",
    },
  });

  if (!response.ok) {
    return { ok: false, status: response.status, body: null };
  }

  return {
    ok: true,
    status: response.status,
    body: await response.json(),
  };
}

function emptyIndicatorMap() {
  return Object.fromEntries(indicatorKeys.map((key) => [key, null]));
}

function chooseYearValue(bucket) {
  const preferred = bucket.get(String(PREFERRED_DATA_YEAR));
  if (typeof preferred === "number") {
    return { value: preferred, year: PREFERRED_DATA_YEAR };
  }

  const fallback = bucket.get(String(FALLBACK_DATA_YEAR));
  if (typeof fallback === "number") {
    return { value: fallback, year: FALLBACK_DATA_YEAR };
  }

  return { value: null, year: null };
}

function recordIndicatorValues(indicatorCode, indicatorValues, countryByIso3, rawSeriesByIso3) {
  if (!indicatorValues || typeof indicatorValues !== "object") {
    return;
  }

  const indicatorKey = indicatorCodeToKey[indicatorCode];
  if (!indicatorKey) {
    return;
  }

  for (const [countryCode, series] of Object.entries(indicatorValues)) {
    if (!countryByIso3.has(countryCode) || !series || typeof series !== "object") {
      continue;
    }

    if (!rawSeriesByIso3.has(countryCode)) {
      rawSeriesByIso3.set(countryCode, {});
    }

    const buckets = rawSeriesByIso3.get(countryCode);
    if (!buckets[indicatorKey]) {
      buckets[indicatorKey] = new Map();
    }

    for (const [year, rawValue] of Object.entries(series)) {
      if (year !== String(PREFERRED_DATA_YEAR) && year !== String(FALLBACK_DATA_YEAR)) {
        continue;
      }
      const value = parseNumeric(rawValue);
      if (value !== null) {
        buckets[indicatorKey].set(year, value);
      }
    }
  }
}

async function fetchIndicatorChunk(indicatorCode, countryCodes, countryByIso3, rawSeriesByIso3) {
  if (countryCodes.length === 0) {
    return;
  }

  const path = countryCodes.join("/");
  const url = `${IMF_BASE_URL}/${indicatorCode}/${path}?periods=${FALLBACK_DATA_YEAR},${PREFERRED_DATA_YEAR}`;
  const response = await fetchJsonWithStatus(url);

  if (response.ok) {
    recordIndicatorValues(indicatorCode, response.body?.values?.[indicatorCode], countryByIso3, rawSeriesByIso3);
    return;
  }

  if (response.status === 404) {
    if (countryCodes.length === 1) {
      console.warn(`Skipping IMF code not supported for indicator ${indicatorCode}: ${countryCodes[0]}`);
      return;
    }

    const midpoint = Math.ceil(countryCodes.length / 2);
    const left = countryCodes.slice(0, midpoint);
    const right = countryCodes.slice(midpoint);
    await fetchIndicatorChunk(indicatorCode, left, countryByIso3, rawSeriesByIso3);
    await fetchIndicatorChunk(indicatorCode, right, countryByIso3, rawSeriesByIso3);
    return;
  }

  throw new Error(`Request failed (${response.status}) for ${url}`);
}

async function main() {
  console.info("Fetching IMF DataMapper country metadata...");
  const countryMetaResponse = await fetchJson(COUNTRY_META_URL);
  const rawCountries = countryMetaResponse?.countries ?? {};

  const countryByIso3 = new Map();
  for (const [code, info] of Object.entries(rawCountries)) {
    if (!isValidIso3(code)) {
      continue;
    }
    if (typeof info?.label !== "string") {
      continue;
    }
    const name = info.label.trim();
    if (!name || isLikelyAggregateName(name)) {
      continue;
    }
    countryByIso3.set(code, { iso3: code, name });
  }

  const countryCodes = Array.from(countryByIso3.keys()).sort();
  const countryChunks = chunkArray(countryCodes, CHUNK_SIZE);
  const rawSeriesByIso3 = new Map();

  console.info(`Fetching IMF indicator data for ${countryCodes.length} countries...`);
  for (const [, indicatorCode] of indicatorEntries) {
    for (const chunk of countryChunks) {
      await fetchIndicatorChunk(indicatorCode, chunk, countryByIso3, rawSeriesByIso3);
    }
  }

  const countriesByIso3 = {};
  const missingIndicatorsByCountry = {};
  let completeDataCount = 0;
  let partialDataCount = 0;
  let noDataCount = 0;

  for (const [iso3, countryMeta] of countryByIso3.entries()) {
    const indicatorBuckets = rawSeriesByIso3.get(iso3) ?? {};
    const indicators = emptyIndicatorMap();
    const indicatorYears = emptyIndicatorMap();
    const missingIndicators = [];

    for (const indicatorKey of indicatorKeys) {
      const bucket = indicatorBuckets[indicatorKey] ?? new Map();
      const chosen = chooseYearValue(bucket);
      indicators[indicatorKey] = chosen.value;
      indicatorYears[indicatorKey] = chosen.year;
      if (chosen.value === null) {
        missingIndicators.push(indicatorKey);
      }
    }

    const availableCount = indicatorKeys.length - missingIndicators.length;
    if (availableCount === 0) {
      noDataCount += 1;
    } else if (missingIndicators.length === 0) {
      completeDataCount += 1;
    } else {
      partialDataCount += 1;
    }

    if (missingIndicators.length > 0) {
      missingIndicatorsByCountry[iso3] = {
        name: countryMeta.name,
        missingIndicators,
      };
    }

    countriesByIso3[iso3] = {
      iso3,
      name: countryMeta.name,
      source: "IMF WEO / DataMapper",
      gameStartDate: GAME_START_DATE,
      preferredDataYear: PREFERRED_DATA_YEAR,
      fallbackDataYear: FALLBACK_DATA_YEAR,
      indicators,
      indicatorYears,
    };
  }

  const generatedAt = new Date().toISOString();
  const output = {
    source: "IMF WEO / DataMapper",
    gameStartDate: GAME_START_DATE,
    preferredDataYear: PREFERRED_DATA_YEAR,
    fallbackDataYear: FALLBACK_DATA_YEAR,
    generatedAt,
    countriesByIso3,
  };

  const coverage = {
    generatedAt,
    totalImfCountriesChecked: countryByIso3.size,
    countriesWithCompleteData: completeDataCount,
    countriesWithPartialData: partialDataCount,
    countriesWithNoData: noDataCount,
    missingIndicatorsByCountry,
  };

  const outputDir = resolve(__dirname, "..", "public", "data");
  const statsPath = resolve(outputDir, "imf-weo-stats.json");
  const coveragePath = resolve(outputDir, "imf-weo-stats-coverage.json");

  await mkdir(outputDir, { recursive: true });
  await writeFile(statsPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");

  console.info(`Wrote ${statsPath}`);
  console.info(`Wrote ${coveragePath}`);
  console.info(`Imported countries: ${countryByIso3.size}`);
}

main().catch((error) => {
  console.error("Failed to import IMF WEO stats.", error);
  process.exitCode = 1;
});
