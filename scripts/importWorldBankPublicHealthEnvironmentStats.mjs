import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GAME_START_DATE = "2025-01-01";
const PREFERRED_DATA_YEAR = 2024;
const FALLBACK_DATA_YEAR = 2023;
const MINIMUM_ALLOWED_YEAR = 2022;

const INDICATORS = {
  safelyManagedDrinkingWaterPct: "SH.H2O.SMDW.ZS",
  safelyManagedSanitationPct: "SH.STA.SMSS.ZS",
  basicHandwashingFacilitiesPct: "SH.STA.HYGN.ZS",
  accessToElectricityPct: "EG.ELC.ACCS.ZS",
  ruralElectricityAccessPct: "EG.ELC.ACCS.RU.ZS",
  urbanElectricityAccessPct: "EG.ELC.ACCS.UR.ZS",
  cleanCookingFuelAccessPct: "EG.CFT.ACCS.ZS",
};

const WASH_KEYS = new Set([
  "safelyManagedDrinkingWaterPct",
  "safelyManagedSanitationPct",
  "basicHandwashingFacilitiesPct",
]);

const indicatorEntries = Object.entries(INDICATORS);
const indicatorKeys = indicatorEntries.map(([key]) => key);
const indicatorCodeToKey = Object.fromEntries(indicatorEntries.map(([key, code]) => [code, key]));
const indicatorCodeList = indicatorEntries.map(([, code]) => code).join(";");

const PUBLIC_HEALTH_ENVIRONMENT_URL =
  `https://api.worldbank.org/v2/country/all/indicator/${indicatorCodeList}?source=2&format=json&per_page=20000`;
const COUNTRY_META_URL = "https://api.worldbank.org/v2/country?format=json&per_page=400";

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

  if (country.region?.id === "NA") {
    return true;
  }

  if (!isValidIso3(country.id)) {
    return true;
  }

  const lowerName = typeof country.name === "string" ? country.name.toLowerCase() : "";
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

function isWorldBankMeta(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.pages === "number" &&
    Number.isFinite(value.pages)
  );
}

async function fetchWorldBankRows(baseUrl) {
  const firstPage = await fetchJson(baseUrl);
  const meta = isWorldBankMeta(firstPage?.[0]) ? firstPage[0] : null;
  const initialRows = Array.isArray(firstPage?.[1]) ? firstPage[1] : [];

  if (!meta || meta.pages <= 1) {
    return initialRows;
  }

  const pageResponses = await Promise.all(
    Array.from({ length: meta.pages - 1 }, (_, index) => fetchJson(`${baseUrl}&page=${index + 2}`)),
  );

  return initialRows.concat(...pageResponses.map((response) => (Array.isArray(response?.[1]) ? response[1] : [])));
}

function getIndicatorSource(key) {
  return WASH_KEYS.has(key)
    ? "World Bank WDI / WHO-UNICEF JMP"
    : "World Bank WDI / SDG7";
}

function chooseYearValue(bucket) {
  const preferred = bucket.get(String(PREFERRED_DATA_YEAR));
  if (typeof preferred === "number") {
    return { value: preferred, year: PREFERRED_DATA_YEAR, freshnessBucket: "2024" };
  }

  const fallback = bucket.get(String(FALLBACK_DATA_YEAR));
  if (typeof fallback === "number") {
    return { value: fallback, year: FALLBACK_DATA_YEAR, freshnessBucket: "2023" };
  }

  const latestAvailableEntry = Array.from(bucket.entries())
    .map(([year, value]) => ({
      year: Number.parseInt(year, 10),
      value,
    }))
    .filter((entry) => Number.isFinite(entry.year) && typeof entry.value === "number")
    .sort((a, b) => b.year - a.year)[0];

  if (!latestAvailableEntry) {
    return { value: null, year: null, freshnessBucket: "missing" };
  }

  if (latestAvailableEntry.year < MINIMUM_ALLOWED_YEAR) {
    return { value: null, year: null, freshnessBucket: "stale_before_2022" };
  }

  if (latestAvailableEntry.year === 2022) {
    return { value: latestAvailableEntry.value, year: 2022, freshnessBucket: "2022" };
  }

  return {
    value: latestAvailableEntry.value,
    year: latestAvailableEntry.year,
    freshnessBucket: String(latestAvailableEntry.year),
  };
}

function sortYearDistribution(distribution) {
  return Object.fromEntries(
    Object.entries(distribution)
      .map(([year, count]) => [Number.parseInt(year, 10), count])
      .filter(([year, count]) => Number.isFinite(year) && Number.isFinite(count))
      .sort((a, b) => b[0] - a[0]),
  );
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

  console.info("Fetching World Bank public health environment indicator data...");
  const indicatorRows = await fetchWorldBankRows(PUBLIC_HEALTH_ENVIRONMENT_URL);

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
    if (typeof year !== "string" || typeof value !== "number") {
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
  const perFieldCoverageCount = Object.fromEntries(indicatorKeys.map((key) => [key, 0]));
  const perFieldSelectedYearDistribution = Object.fromEntries(indicatorKeys.map((key) => [key, {}]));
  const perFieldMissingCount = Object.fromEntries(indicatorKeys.map((key) => [key, 0]));
  const freshnessBuckets = Object.fromEntries(indicatorKeys.map((key) => [key, {
    2024: 0,
    2023: 0,
    2022: 0,
    missing: 0,
    stale_before_2022: 0,
  }]));
  const countriesWithNoPublicHealthEnvironmentFields = [];
  let countriesWithAtLeastOneField = 0;

  for (const [iso3, countryMeta] of countryByIso3.entries()) {
    const indicatorBuckets = rawSeriesByIso3.get(iso3) ?? {};
    const publicHealthEnvironment = {};
    let availableCount = 0;

    for (const key of indicatorKeys) {
      const chosen = chooseYearValue(indicatorBuckets[key] ?? new Map());
      const freshnessBucketKey =
        chosen.freshnessBucket === "2024" ||
        chosen.freshnessBucket === "2023" ||
        chosen.freshnessBucket === "2022" ||
        chosen.freshnessBucket === "missing" ||
        chosen.freshnessBucket === "stale_before_2022"
          ? chosen.freshnessBucket
          : chosen.year >= 2024
            ? "2024"
            : chosen.year === 2023
              ? "2023"
              : chosen.year === 2022
                ? "2022"
                : "missing";

      freshnessBuckets[key][freshnessBucketKey] += 1;

      if (chosen.value === null || chosen.year === null) {
        perFieldMissingCount[key] += 1;
        continue;
      }

      availableCount += 1;
      perFieldCoverageCount[key] += 1;
      perFieldSelectedYearDistribution[key][chosen.year] =
        (perFieldSelectedYearDistribution[key][chosen.year] ?? 0) + 1;

      publicHealthEnvironment[key] = {
        value: chosen.value,
        year: chosen.year,
        source: getIndicatorSource(key),
      };
    }

    if (availableCount === 0) {
      countriesWithNoPublicHealthEnvironmentFields.push({
        iso3,
        countryName: countryMeta.name,
      });
      continue;
    }

    countriesWithAtLeastOneField += 1;
    countriesByIso3[iso3] = {
      countryIso3: countryMeta.iso3,
      countryName: countryMeta.name,
      iso2: countryMeta.iso2,
      region: countryMeta.region,
      incomeLevel: countryMeta.incomeLevel,
      gameStartDate: GAME_START_DATE,
      publicHealthEnvironment,
    };
  }

  const coverageOutput = {
    generatedAt: new Date().toISOString(),
    source: "World Bank public health environment indicators",
    preferredDataYear: PREFERRED_DATA_YEAR,
    fallbackDataYear: FALLBACK_DATA_YEAR,
    minimumAllowedYear: MINIMUM_ALLOWED_YEAR,
    totalCountriesConsidered: countryByIso3.size,
    matchedCountryCount: Object.keys(countriesByIso3).length,
    countriesWithAtLeastOneField,
    perFieldCoverageCount,
    perFieldSelectedYearDistribution: Object.fromEntries(
      indicatorKeys.map((key) => [key, sortYearDistribution(perFieldSelectedYearDistribution[key])]),
    ),
    perFieldMissingCount,
    countriesWithNoPublicHealthEnvironmentFields,
    freshnessBuckets,
  };

  const statsPath = resolve(__dirname, "..", "public", "data", "public-health-environment-stats.json");
  const coveragePath = resolve(
    __dirname,
    "..",
    "public",
    "data",
    "public-health-environment-stats-coverage.json",
  );

  await mkdir(resolve(__dirname, "..", "public", "data"), { recursive: true });
  await writeFile(statsPath, `${JSON.stringify(countriesByIso3, null, 2)}\n`, "utf8");
  await writeFile(coveragePath, `${JSON.stringify(coverageOutput, null, 2)}\n`, "utf8");

  console.info(`Wrote ${statsPath}`);
  console.info(`Wrote ${coveragePath}`);
  console.info(`Matched countries with public-health-environment data: ${Object.keys(countriesByIso3).length}`);
}

main().catch((error) => {
  console.error("Failed to import World Bank public health environment stats.", error);
  process.exitCode = 1;
});
