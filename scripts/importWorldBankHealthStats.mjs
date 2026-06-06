import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GAME_START_DATE = "2025-01-01";
const PREFERRED_DATA_YEAR = 2024;
const FALLBACK_DATA_YEAR = 2023;
const SOURCE_LABEL = "World Bank WDI / WHO";

const INDICATORS = {
  hospitalBedsPer1000: "SH.MED.BEDS.ZS",
  physiciansPer1000: "SH.MED.PHYS.ZS",
  nursesMidwivesPer1000: "SH.MED.NUMW.P3",
  currentHealthExpenditurePerCapitaUsd: "SH.XPD.CHEX.PC.CD",
  currentHealthExpenditurePctOfGdp: "SH.XPD.CHEX.GD.ZS",
};

const indicatorEntries = Object.entries(INDICATORS);
const indicatorKeys = indicatorEntries.map(([key]) => key);
const indicatorCodeToKey = Object.fromEntries(indicatorEntries.map(([key, code]) => [code, key]));
const indicatorCodeList = indicatorEntries.map(([, code]) => code).join(";");

const HEALTH_URL = `https://api.worldbank.org/v2/country/all/indicator/${indicatorCodeList}?source=2&format=json&per_page=20000`;
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

function roundNumber(value, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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

  const latestAvailableEntry = Array.from(bucket.entries())
    .map(([year, value]) => ({
      year: Number.parseInt(year, 10),
      value,
    }))
    .filter((entry) => Number.isFinite(entry.year) && typeof entry.value === "number")
    .sort((a, b) => b.year - a.year)[0];

  if (latestAvailableEntry) {
    return {
      value: latestAvailableEntry.value,
      year: latestAvailableEntry.year,
    };
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

  console.info("Fetching World Bank health indicator data...");
  const indicatorRows = await fetchWorldBankRows(HEALTH_URL);

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
  const fieldStats = Object.fromEntries(
    indicatorKeys.map((key) => [
      key,
      {
        presentCount: 0,
        missingIso3s: [],
        selectedYearDistribution: {},
      },
    ]),
  );

  let completeDataCount = 0;
  let partialDataCount = 0;
  let noDataCount = 0;

  for (const [iso3, countryMeta] of countryByIso3.entries()) {
    const indicatorBuckets = rawSeriesByIso3.get(iso3) ?? {};
    const healthSystem = {};
    let availableCount = 0;

    for (const key of indicatorKeys) {
      const chosen = chooseYearValue(indicatorBuckets[key] ?? new Map());
      const fieldStat = fieldStats[key];

      if (chosen.value === null || chosen.year === null) {
        fieldStat.missingIso3s.push(iso3);
        continue;
      }

      availableCount += 1;
      fieldStat.presentCount += 1;
      fieldStat.selectedYearDistribution[chosen.year] = (fieldStat.selectedYearDistribution[chosen.year] ?? 0) + 1;
      healthSystem[key] = {
        value: chosen.value,
        year: chosen.year,
        source: SOURCE_LABEL,
      };
    }

    if (availableCount === 0) {
      noDataCount += 1;
      continue;
    }

    if (availableCount === indicatorKeys.length) {
      completeDataCount += 1;
    } else {
      partialDataCount += 1;
    }

    countriesByIso3[iso3] = {
      iso3: countryMeta.iso3,
      iso2: countryMeta.iso2,
      countryName: countryMeta.name,
      name: countryMeta.name,
      region: countryMeta.region,
      incomeLevel: countryMeta.incomeLevel,
      gameStartDate: GAME_START_DATE,
      preferredDataYear: PREFERRED_DATA_YEAR,
      fallbackDataYear: FALLBACK_DATA_YEAR,
      healthSystem,
    };
  }

  const coverageByField = Object.fromEntries(
    indicatorKeys.map((key) => {
      const presentCount = fieldStats[key].presentCount;
      const missingCount = countryByIso3.size - presentCount;
      const ageBucketCounts = {
        yearGte2023: 0,
        year2020To2022: 0,
        year2015To2019: 0,
        year2010To2014: 0,
        yearBefore2010: 0,
      };
      for (const [yearText, count] of Object.entries(fieldStats[key].selectedYearDistribution)) {
        const year = Number.parseInt(yearText, 10);
        if (!Number.isFinite(year)) {
          continue;
        }
        if (year >= 2023) {
          ageBucketCounts.yearGte2023 += count;
        } else if (year >= 2020) {
          ageBucketCounts.year2020To2022 += count;
        } else if (year >= 2015) {
          ageBucketCounts.year2015To2019 += count;
        } else if (year >= 2010) {
          ageBucketCounts.year2010To2014 += count;
        } else {
          ageBucketCounts.yearBefore2010 += count;
        }
      }
      return [
        key,
        {
          presentCount,
          missingCount,
          coveragePct: roundNumber((presentCount / Math.max(1, countryByIso3.size)) * 100, 2),
          selectedYearDistribution: Object.fromEntries(
            Object.entries(fieldStats[key].selectedYearDistribution)
              .map(([year, count]) => [Number.parseInt(year, 10), count])
              .sort((a, b) => b[0] - a[0]),
          ),
          selectedYearAgeBuckets: ageBucketCounts,
          missingIso3s: fieldStats[key].missingIso3s.sort(),
        },
      ];
    }),
  );

  const healthStatsOutput = {
    source: SOURCE_LABEL,
    gameStartDate: GAME_START_DATE,
    preferredDataYear: PREFERRED_DATA_YEAR,
    fallbackDataYear: FALLBACK_DATA_YEAR,
    generatedAt: new Date().toISOString(),
    countriesByIso3,
  };

  const coverageOutput = {
    generatedAt: new Date().toISOString(),
    source: SOURCE_LABEL,
    totalEligibleCountriesChecked: countryByIso3.size,
    matchedCountryCount: Object.keys(countriesByIso3).length,
    countriesWithCompleteHealthData: completeDataCount,
    countriesWithPartialHealthData: partialDataCount,
    countriesWithNoHealthData: noDataCount,
    coverageByField,
  };

  const statsPath = resolve(__dirname, "..", "public", "data", "health-stats.json");
  const coveragePath = resolve(__dirname, "..", "public", "data", "health-stats-coverage.json");

  await mkdir(resolve(__dirname, "..", "public", "data"), { recursive: true });
  await writeFile(statsPath, `${JSON.stringify(healthStatsOutput, null, 2)}\n`, "utf8");
  await writeFile(coveragePath, `${JSON.stringify(coverageOutput, null, 2)}\n`, "utf8");

  console.info(`Wrote ${statsPath}`);
  console.info(`Wrote ${coveragePath}`);
  console.info(`Matched countries with health data: ${Object.keys(countriesByIso3).length}`);
}

main().catch((error) => {
  console.error("Failed to import World Bank health stats.", error);
  process.exitCode = 1;
});
