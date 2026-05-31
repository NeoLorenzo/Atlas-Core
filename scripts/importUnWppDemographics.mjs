import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GAME_START_DATE = "2025-01-01";
const PREFERRED_DATA_YEAR = 2024;
const FALLBACK_DATA_YEAR = 2023;

const UN_API_BASE = "https://population.un.org/dataportalapi/api/v1";
const WPP_BASE = "https://population.un.org/wpp/";
const DOWNLOADS_MANIFEST_URL = `${WPP_BASE}assets/downloads.json`;

const REQUIRED_FILE_PATTERNS = {
  locations: /WPP2024_Locations_notes\.csv$/i,
  demographicIndicators: /WPP2024_Demographic_Indicators_Medium\.csv\.gz$/i,
  agePercentages: /WPP2024_PopulationByAge5GroupSex_Percentage_Medium\.csv\.gz$/i,
};

const DEMOGRAPHIC_KEYS = [
  "medianAgeYears",
  "fertilityRateBirthsPerWoman",
  "populationGrowthRatePct",
  "netMigration",
  "youthSharePct",
  "workingAgeSharePct",
  "elderlySharePct",
  "childDependencyRatio",
  "oldAgeDependencyRatio",
  "totalDependencyRatio",
];

function isValidIso3(value) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value.trim().toUpperCase());
}

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function forEachCsvRow(csvText, onRow) {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) {
    return;
  }

  const headerLine = lines[0].replace(/^\uFEFF/, "");
  const header = parseCsvLine(headerLine);

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line || !line.trim()) {
      continue;
    }
    const values = parseCsvLine(line);
    const row = {};
    for (let index = 0; index < header.length; index += 1) {
      row[header[index]] = values[index] ?? "";
    }
    onRow(row);
  }
}

function parseNumber(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyIndicatorMap() {
  return Object.fromEntries(DEMOGRAPHIC_KEYS.map((key) => [key, null]));
}

function chooseYearValue(yearToValue) {
  const preferred = yearToValue.get(PREFERRED_DATA_YEAR);
  if (typeof preferred === "number" && Number.isFinite(preferred)) {
    return { value: preferred, year: PREFERRED_DATA_YEAR };
  }

  const fallback = yearToValue.get(FALLBACK_DATA_YEAR);
  if (typeof fallback === "number" && Number.isFinite(fallback)) {
    return { value: fallback, year: FALLBACK_DATA_YEAR };
  }

  return { value: null, year: null };
}

function normalizeAssetUrl(path) {
  const normalized = path.replace(/^\/+/, "");
  return `${WPP_BASE}${normalized}`;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/csv,application/json,*/*",
      "Accept-Encoding": "*",
      "Accept-Language": "*",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return response.text();
}

async function fetchGunzippedCsv(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/octet-stream,text/csv,*/*",
      "Accept-Encoding": "*",
      "Accept-Language": "*",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  const compressed = Buffer.from(await response.arrayBuffer());
  return gunzipSync(compressed).toString("utf8");
}

async function discoverWppFiles() {
  const response = await fetch(DOWNLOADS_MANIFEST_URL, {
    headers: {
      Accept: "application/json,*/*",
      "Accept-Encoding": "*",
      "Accept-Language": "*",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${DOWNLOADS_MANIFEST_URL}`);
  }

  const manifest = await response.json();
  const files = [];

  for (const folder of manifest?.Folders ?? []) {
    for (const group of folder?.MajorGroup ?? []) {
      for (const subGroup of group?.SubGroup ?? []) {
        for (const item of subGroup?.Item ?? []) {
          for (const file of item?.File ?? []) {
            if (typeof file?.Path === "string" && file.Path.trim()) {
              files.push(file.Path.trim());
            }
          }
        }
      }
    }
  }

  const required = {};
  for (const [name, pattern] of Object.entries(REQUIRED_FILE_PATTERNS)) {
    const matchedPath = files.find((path) => pattern.test(path));
    if (!matchedPath) {
      throw new Error(`Could not locate required WPP file (${name}) in downloads manifest.`);
    }
    required[name] = normalizeAssetUrl(matchedPath);
  }

  return required;
}

async function probeApiAccess() {
  const indicatorsUrl = `${UN_API_BASE}/indicators?format=csv&sort=name&pageSize=10`;
  const dataProbeUrl = `${UN_API_BASE}/data/indicators/67/locations/840/start/2024/end/2024?format=csv`;

  const [indicatorsResponse, dataResponse] = await Promise.all([
    fetch(indicatorsUrl, { headers: { Accept: "text/csv,*/*" } }).catch(() => null),
    fetch(dataProbeUrl, { headers: { Accept: "text/csv,*/*" } }).catch(() => null),
  ]);

  return {
    indicatorsCatalogAccessible: Boolean(indicatorsResponse?.ok),
    dataEndpointAccessible: Boolean(dataResponse?.ok),
    dataEndpointStatus: dataResponse?.status ?? null,
  };
}

function initializeCountryRecord(iso3, name) {
  return {
    iso3,
    name,
    source: "UN WPP 2024",
    gameStartDate: GAME_START_DATE,
    preferredDataYear: PREFERRED_DATA_YEAR,
    fallbackDataYear: FALLBACK_DATA_YEAR,
    indicators: emptyIndicatorMap(),
    indicatorYears: emptyIndicatorMap(),
  };
}

async function main() {
  console.info("Probing UN Data Portal API access...");
  const apiProbe = await probeApiAccess();

  console.info("Discovering official WPP 2024 bulk CSV files...");
  const files = await discoverWppFiles();

  console.info("Downloading WPP locations metadata...");
  const locationsCsv = await fetchText(files.locations);

  console.info("Downloading WPP demographic indicators (Medium)...");
  const demographicCsv = await fetchGunzippedCsv(files.demographicIndicators);

  console.info("Downloading WPP age-structure percentages (Medium)...");
  const agePercentCsv = await fetchGunzippedCsv(files.agePercentages);

  const locationInfoByIso3 = new Map();

  forEachCsvRow(locationsCsv, (row) => {
    const iso3 = typeof row.ISO3_code === "string" ? row.ISO3_code.trim().toUpperCase() : "";
    const name = typeof row.Location === "string" ? row.Location.trim() : iso3;
    if (!isValidIso3(iso3)) {
      return;
    }
    locationInfoByIso3.set(iso3, { name });
  });

  const metricBucketsByIso3 = new Map();
  const ageBucketByIso3 = new Map();
  const areaIdsChecked = new Set();
  const areaIdsMatchedToIso = new Set();

  const ensureMetricBucket = (iso3, name) => {
    if (!metricBucketsByIso3.has(iso3)) {
      metricBucketsByIso3.set(iso3, {
        name,
        medianAgeYears: new Map(),
        fertilityRateBirthsPerWoman: new Map(),
        populationGrowthRatePct: new Map(),
        netMigration: new Map(),
      });
    }
    return metricBucketsByIso3.get(iso3);
  };

  const targetYears = new Set([PREFERRED_DATA_YEAR, FALLBACK_DATA_YEAR]);

  forEachCsvRow(demographicCsv, (row) => {
    const locId = typeof row.LocID === "string" ? row.LocID.trim() : "";
    if (locId) {
      areaIdsChecked.add(locId);
    }

    const iso3 = typeof row.ISO3_code === "string" ? row.ISO3_code.trim().toUpperCase() : "";
    if (!isValidIso3(iso3)) {
      return;
    }
    if (locId) {
      areaIdsMatchedToIso.add(locId);
    }

    const year = Number.parseInt(row.Time ?? "", 10);
    if (!targetYears.has(year)) {
      return;
    }

    const variant = (row.Variant ?? "").trim().toLowerCase();
    if (variant && variant !== "medium") {
      return;
    }

    const name = (row.Location ?? locationInfoByIso3.get(iso3)?.name ?? iso3).trim();
    const bucket = ensureMetricBucket(iso3, name);

    const medianAge = parseNumber(row.MedianAgePop);
    const fertilityRate = parseNumber(row.TFR);
    const populationGrowth = parseNumber(row.PopGrowthRate);
    const netMigration = parseNumber(row.NetMigrations);

    if (medianAge !== null) {
      bucket.medianAgeYears.set(year, medianAge);
    }
    if (fertilityRate !== null) {
      bucket.fertilityRateBirthsPerWoman.set(year, fertilityRate);
    }
    if (populationGrowth !== null) {
      bucket.populationGrowthRatePct.set(year, populationGrowth);
    }
    if (netMigration !== null) {
      bucket.netMigration.set(year, netMigration);
    }
  });

  const ensureAgeBucket = (iso3, name, year) => {
    if (!ageBucketByIso3.has(iso3)) {
      ageBucketByIso3.set(iso3, new Map());
    }
    const byYear = ageBucketByIso3.get(iso3);
    if (!byYear.has(year)) {
      byYear.set(year, {
        name,
        youthSharePct: 0,
        workingAgeSharePct: 0,
        elderlySharePct: 0,
        totalSharePct: 0,
      });
    }
    return byYear.get(year);
  };

  forEachCsvRow(agePercentCsv, (row) => {
    const iso3 = typeof row.ISO3_code === "string" ? row.ISO3_code.trim().toUpperCase() : "";
    if (!isValidIso3(iso3)) {
      return;
    }

    const year = Number.parseInt(row.Time ?? "", 10);
    if (!targetYears.has(year)) {
      return;
    }

    const variant = (row.Variant ?? "").trim().toLowerCase();
    if (variant && variant !== "medium") {
      return;
    }

    const ageStart = Number.parseInt(row.AgeGrpStart ?? "", 10);
    const popTotalShare = parseNumber(row.PopTotal);
    if (!Number.isFinite(ageStart) || popTotalShare === null) {
      return;
    }

    const name = (row.Location ?? locationInfoByIso3.get(iso3)?.name ?? iso3).trim();
    const yearBucket = ensureAgeBucket(iso3, name, year);

    yearBucket.totalSharePct += popTotalShare;
    if (ageStart <= 14) {
      yearBucket.youthSharePct += popTotalShare;
    } else if (ageStart <= 64) {
      yearBucket.workingAgeSharePct += popTotalShare;
    } else {
      yearBucket.elderlySharePct += popTotalShare;
    }
  });

  const countriesByIso3 = {};
  const missingIndicatorsByCountry = {};
  let completeDataCount = 0;
  let partialDataCount = 0;
  let noDataCount = 0;

  const allIso3 = Array.from(
    new Set([...locationInfoByIso3.keys(), ...metricBucketsByIso3.keys(), ...ageBucketByIso3.keys()]),
  ).sort();

  for (const iso3 of allIso3) {
    const locationName = locationInfoByIso3.get(iso3)?.name ?? metricBucketsByIso3.get(iso3)?.name ?? iso3;
    const metricBucket = metricBucketsByIso3.get(iso3);
    const ageByYear = ageBucketByIso3.get(iso3) ?? new Map();

    const record = initializeCountryRecord(iso3, locationName);

    const medianAge = chooseYearValue(metricBucket?.medianAgeYears ?? new Map());
    const fertilityRate = chooseYearValue(metricBucket?.fertilityRateBirthsPerWoman ?? new Map());
    const populationGrowth = chooseYearValue(metricBucket?.populationGrowthRatePct ?? new Map());
    const netMigration = chooseYearValue(metricBucket?.netMigration ?? new Map());

    record.indicators.medianAgeYears = medianAge.value;
    record.indicatorYears.medianAgeYears = medianAge.year;
    record.indicators.fertilityRateBirthsPerWoman = fertilityRate.value;
    record.indicatorYears.fertilityRateBirthsPerWoman = fertilityRate.year;
    record.indicators.populationGrowthRatePct = populationGrowth.value;
    record.indicatorYears.populationGrowthRatePct = populationGrowth.year;
    record.indicators.netMigration = netMigration.value;
    record.indicatorYears.netMigration = netMigration.year;

    const chosenAgeYear = ageByYear.has(PREFERRED_DATA_YEAR)
      ? PREFERRED_DATA_YEAR
      : ageByYear.has(FALLBACK_DATA_YEAR)
        ? FALLBACK_DATA_YEAR
        : null;

    if (chosenAgeYear !== null) {
      const age = ageByYear.get(chosenAgeYear);
      const youthShare = age.youthSharePct;
      const workingShare = age.workingAgeSharePct;
      const elderlyShare = age.elderlySharePct;

      record.indicators.youthSharePct = youthShare;
      record.indicators.workingAgeSharePct = workingShare;
      record.indicators.elderlySharePct = elderlyShare;
      record.indicatorYears.youthSharePct = chosenAgeYear;
      record.indicatorYears.workingAgeSharePct = chosenAgeYear;
      record.indicatorYears.elderlySharePct = chosenAgeYear;

      if (workingShare > 0) {
        record.indicators.childDependencyRatio = (youthShare / workingShare) * 100;
        record.indicators.oldAgeDependencyRatio = (elderlyShare / workingShare) * 100;
        record.indicators.totalDependencyRatio = ((youthShare + elderlyShare) / workingShare) * 100;
        record.indicatorYears.childDependencyRatio = chosenAgeYear;
        record.indicatorYears.oldAgeDependencyRatio = chosenAgeYear;
        record.indicatorYears.totalDependencyRatio = chosenAgeYear;
      }

      record.ageStructure = {
        totalPopulationFromAgeData: null,
        youthPopulation0To14: null,
        workingAgePopulation15To64: null,
        elderlyPopulation65Plus: null,
      };
    }

    const missingIndicators = DEMOGRAPHIC_KEYS.filter((key) => record.indicators[key] === null);
    const availableCount = DEMOGRAPHIC_KEYS.length - missingIndicators.length;

    if (availableCount === 0) {
      noDataCount += 1;
    } else if (missingIndicators.length === 0) {
      completeDataCount += 1;
    } else {
      partialDataCount += 1;
    }

    if (missingIndicators.length > 0) {
      missingIndicatorsByCountry[iso3] = {
        name: record.name,
        missingIndicators,
      };
    }

    countriesByIso3[iso3] = record;
  }

  const generatedAt = new Date().toISOString();
  const output = {
    source: "UN WPP 2024",
    gameStartDate: GAME_START_DATE,
    preferredDataYear: PREFERRED_DATA_YEAR,
    fallbackDataYear: FALLBACK_DATA_YEAR,
    generatedAt,
    countriesByIso3,
  };

  const coverage = {
    generatedAt,
    totalCountriesAreasChecked: areaIdsChecked.size,
    countriesAreasMatchedToIso3: areaIdsMatchedToIso.size,
    countriesWithCompleteDemographicData: completeDataCount,
    countriesWithPartialDemographicData: partialDataCount,
    countriesWithNoDemographicData: noDataCount,
    missingIndicatorsByCountry,
    notes: {
      apiProbe,
      directImportMetrics: [
        "medianAgeYears",
        "fertilityRateBirthsPerWoman",
        "populationGrowthRatePct",
        "netMigration",
      ],
      computedFromAgeStructureMetrics: [
        "youthSharePct",
        "workingAgeSharePct",
        "elderlySharePct",
        "childDependencyRatio",
        "oldAgeDependencyRatio",
        "totalDependencyRatio",
      ],
      sourceFiles: {
        locations: files.locations,
        demographicIndicators: files.demographicIndicators,
        agePercentages: files.agePercentages,
      },
      comments: [
        "UN Data Portal API indicator metadata endpoints are accessible in this environment, but data endpoints may require bearer authorization (observed 401).",
        "Fallback uses official UN WPP 2024 bulk CSV files discovered from the official downloads manifest.",
        "Age structure shares and dependency ratios were computed using the official PopulationByAge5GroupSex_Percentage_Medium dataset.",
      ],
    },
  };

  const outputDir = resolve(__dirname, "..", "public", "data");
  const outputPath = resolve(outputDir, "un-wpp-demographics.json");
  const coveragePath = resolve(outputDir, "un-wpp-demographics-coverage.json");

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");

  console.info(`Wrote ${outputPath}`);
  console.info(`Wrote ${coveragePath}`);
  console.info(`Imported ISO3 records: ${Object.keys(countriesByIso3).length}`);
}

main().catch((error) => {
  console.error("Failed to import UN WPP demographics.", error);
  process.exitCode = 1;
});
