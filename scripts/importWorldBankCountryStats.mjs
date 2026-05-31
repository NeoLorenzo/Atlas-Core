import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GAME_START_DATE = "2025-01-01";
const PREFERRED_DATA_YEAR = 2024;
const FALLBACK_DATA_YEAR = 2023;

const WDI_INDICATORS = {
  population: "SP.POP.TOTL",
  gdpCurrentUsd: "NY.GDP.MKTP.CD",
  gdpPerCapitaCurrentUsd: "NY.GDP.PCAP.CD",
  gdpGrowthAnnualPct: "NY.GDP.MKTP.KD.ZG",
  inflationConsumerAnnualPct: "FP.CPI.TOTL.ZG",
  unemploymentPct: "SL.UEM.TOTL.ZS",
  urbanPopulationPct: "SP.URB.TOTL.IN.ZS",
  lifeExpectancyYears: "SP.DYN.LE00.IN",
  tradePctOfGdp: "NE.TRD.GNFS.ZS",
};

const indicatorEntries = Object.entries(WDI_INDICATORS);
const indicatorKeys = indicatorEntries.map(([key]) => key);
const indicatorCodeToKey = Object.fromEntries(
  indicatorEntries.map(([key, code]) => [code, key]),
);
const indicatorCodeList = indicatorEntries.map(([, code]) => code).join(";");

const WDI_URL = `https://api.worldbank.org/v2/country/all/indicator/${indicatorCodeList}?source=2&date=${FALLBACK_DATA_YEAR}:${PREFERRED_DATA_YEAR}&format=json&per_page=20000`;
const COUNTRY_META_URL = "https://api.worldbank.org/v2/country?format=json&per_page=400";

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isValidIso3(iso3) {
  return typeof iso3 === "string" && /^[A-Z]{3}$/.test(iso3);
}

function isValidIso2(iso2) {
  return typeof iso2 === "string" && /^[A-Z]{2}$/.test(iso2);
}

function isLikelyAggregate(country) {
  if (!country || typeof country !== "object") {
    return true;
  }

  const regionId = country.region?.id;
  if (regionId === "NA") {
    return true;
  }

  if (!isValidIso3(country.id)) {
    return true;
  }

  const name = typeof country.name === "string" ? country.name : "";
  const lowerName = name.toLowerCase();
  const aggregateKeywords = [
    "income",
    "ida",
    "ibrd",
    "blend",
    "world",
    "oecd",
    "euro area",
    "arab world",
    "fragile",
    "excluding",
    "least developed",
    "small states",
    "union",
    "dividend",
  ];
  return aggregateKeywords.some((keyword) => lowerName.includes(keyword));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
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

async function main() {
  console.info("Fetching World Bank country metadata...");
  const countryMetaResponse = await fetchJson(COUNTRY_META_URL);
  const countryMetaRows = Array.isArray(countryMetaResponse?.[1]) ? countryMetaResponse[1] : [];

  const countryByIso3 = new Map();
  for (const row of countryMetaRows) {
    if (isLikelyAggregate(row)) {
      continue;
    }

    const iso3 = row.id;
    if (!isValidIso3(iso3)) {
      continue;
    }

    countryByIso3.set(iso3, {
      iso3,
      iso2: isValidIso2(row.iso2Code) ? row.iso2Code : null,
      name: typeof row.name === "string" ? row.name : iso3,
      region: typeof row.region?.value === "string" ? row.region.value : null,
      incomeLevel: typeof row.incomeLevel?.value === "string" ? row.incomeLevel.value : null,
    });
  }

  console.info("Fetching World Bank indicator data...");
  const indicatorResponse = await fetchJson(WDI_URL);
  const indicatorRows = Array.isArray(indicatorResponse?.[1]) ? indicatorResponse[1] : [];

  const rawSeriesByIso3 = new Map();
  for (const row of indicatorRows) {
    const iso3 = row?.countryiso3code;
    if (!isValidIso3(iso3) || !countryByIso3.has(iso3)) {
      continue;
    }

    const indicatorCode = row?.indicator?.id;
    const indicatorKey = indicatorCodeToKey[indicatorCode];
    if (!indicatorKey) {
      continue;
    }

    const year = row?.date;
    const value = row?.value;
    if ((year !== String(PREFERRED_DATA_YEAR) && year !== String(FALLBACK_DATA_YEAR)) || typeof value !== "number") {
      continue;
    }

    if (!rawSeriesByIso3.has(iso3)) {
      rawSeriesByIso3.set(iso3, {});
    }
    const indicatorBuckets = rawSeriesByIso3.get(iso3);
    if (!indicatorBuckets[indicatorKey]) {
      indicatorBuckets[indicatorKey] = new Map();
    }
    indicatorBuckets[indicatorKey].set(year, value);
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

    for (const key of indicatorKeys) {
      const bucket = indicatorBuckets[key] ?? new Map();
      const chosen = chooseYearValue(bucket);
      indicators[key] = chosen.value;
      indicatorYears[key] = chosen.year;
      if (chosen.value === null) {
        missingIndicators.push(key);
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
      iso3: countryMeta.iso3,
      iso2: countryMeta.iso2,
      name: countryMeta.name,
      region: countryMeta.region,
      incomeLevel: countryMeta.incomeLevel,
      source: "World Bank WDI",
      gameStartDate: GAME_START_DATE,
      preferredDataYear: PREFERRED_DATA_YEAR,
      fallbackDataYear: FALLBACK_DATA_YEAR,
      indicators,
      indicatorYears,
    };
  }

  const countryStatsOutput = {
    source: "World Bank WDI",
    gameStartDate: GAME_START_DATE,
    preferredDataYear: PREFERRED_DATA_YEAR,
    fallbackDataYear: FALLBACK_DATA_YEAR,
    generatedAt: new Date().toISOString(),
    countriesByIso3,
  };

  const coverageOutput = {
    generatedAt: new Date().toISOString(),
    totalCountriesImported: countryByIso3.size,
    countriesWithCompleteData: completeDataCount,
    countriesWithPartialData: partialDataCount,
    countriesWithNoData: noDataCount,
    missingIndicatorsByCountry,
  };

  const statsPath = resolve(__dirname, "..", "public", "data", "country-stats.json");
  const coveragePath = resolve(__dirname, "..", "public", "data", "country-stats-coverage.json");

  await mkdir(resolve(__dirname, "..", "public", "data"), { recursive: true });
  await writeFile(statsPath, `${JSON.stringify(countryStatsOutput, null, 2)}\n`, "utf8");
  await writeFile(coveragePath, `${JSON.stringify(coverageOutput, null, 2)}\n`, "utf8");

  console.info(`Wrote ${statsPath}`);
  console.info(`Wrote ${coveragePath}`);
  console.info(`Imported countries: ${countryByIso3.size}`);
}

main().catch((error) => {
  console.error("Failed to import World Bank country stats.", error);
  process.exitCode = 1;
});
