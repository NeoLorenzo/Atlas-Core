import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const INDICATOR_CODE = "SDGIHR2021";
const SOURCE_NAME = "WHO GHO / IHR SPAR second edition";
const FIELD_KEY = "ihrSparAverageScore";
const API_URL = `https://ghoapi.azureedge.net/api/${INDICATOR_CODE}`;
const COUNTRY_STATS_PATH = resolve(__dirname, "..", "public", "data", "country-stats.json");
const OUTPUT_PATH = resolve(__dirname, "..", "public", "data", "who-ihr-spar-stats.json");
const COVERAGE_PATH = resolve(__dirname, "..", "public", "data", "who-ihr-spar-stats-coverage.json");

// Atlas Core is anchored to gameStartDate 2025-01-01, so we do not select 2025 by default.
// Raise this later if the baseline moves forward.
const DEFAULT_MAX_ACCEPTED_YEAR = 2024;
const MINIMUM_ACCEPTED_YEAR = 2022;
const PREFERRED_YEARS = [2024, 2023, 2022];
const UNMATCHED_CODE_SAMPLE_LIMIT = 25;
const MISSING_COUNTRY_SAMPLE_LIMIT = 40;

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function isValidIso3(value) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

function roundNumber(value, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function readJson(path) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

function parseNumericValue(row) {
  const numericValue = row?.NumericValue;
  if (typeof numericValue === "number" && Number.isFinite(numericValue)) {
    return numericValue;
  }

  const value = row?.Value;
  if (typeof value === "string") {
    const normalized = value.replaceAll(",", "").trim();
    if (normalized.length === 0) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseYearCandidate(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? value : Math.trunc(value);
  }

  if (typeof value === "string") {
    const match = value.match(/\b(20\d{2}|19\d{2})\b/);
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }

  return null;
}

function parseObservationYear(row) {
  const candidates = [
    row?.TimeDim,
    row?.TimeDimensionValue,
    row?.TimeDimensionBegin,
    row?.TimeDimensionEnd,
  ];

  for (const candidate of candidates) {
    const year = parseYearCandidate(candidate);
    if (Number.isFinite(year)) {
      return year;
    }
  }

  return null;
}

function extractRows(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.value)) {
    return payload.value;
  }
  if (Array.isArray(payload?.d?.results)) {
    return payload.d.results;
  }
  return null;
}

function formatSchemaKeys(row) {
  if (!isRecord(row)) {
    return "(no object record available)";
  }
  return Object.keys(row).sort().join(", ");
}

function choosePreferredObservation(bucket) {
  for (const year of PREFERRED_YEARS) {
    const observation = bucket.get(year);
    if (observation) {
      return observation;
    }
  }
  return null;
}

async function main() {
  const allowEmpty = process.argv.includes("--allow-empty");

  const countryStats = await readJson(COUNTRY_STATS_PATH);
  if (!isRecord(countryStats?.countriesByIso3)) {
    throw new Error(
      `Expected ${COUNTRY_STATS_PATH} to contain countriesByIso3. Run npm run import:wdi before importing WHO IHR SPAR.`,
    );
  }

  const eligibleCountries = new Map();
  for (const [iso3, record] of Object.entries(countryStats.countriesByIso3)) {
    if (!isValidIso3(iso3) || !isRecord(record)) {
      continue;
    }
    eligibleCountries.set(iso3, {
      iso3,
      name: typeof record.name === "string" ? record.name : iso3,
    });
  }

  console.info(`Fetching WHO GHO IHR SPAR records from ${API_URL}...`);
  const payload = await fetchJson(API_URL);
  const rows = extractRows(payload);

  if (!Array.isArray(rows)) {
    const topLevelKeys = isRecord(payload) ? Object.keys(payload).sort().join(", ") : "(non-object payload)";
    throw new Error(`Unexpected WHO response schema for ${API_URL}. Top-level keys: ${topLevelKeys}`);
  }

  if (rows.length === 0) {
    throw new Error(`WHO response for ${API_URL} contained no rows.`);
  }

  const firstRow = rows[0];
  if (!isRecord(firstRow) || (!("SpatialDim" in firstRow) && !("TimeDim" in firstRow) && !("NumericValue" in firstRow))) {
    throw new Error(
      `Unexpected WHO record schema for ${API_URL}. First record keys: ${formatSchemaKeys(firstRow)}`,
    );
  }

  const observationsByIso3 = new Map();
  const unmatchedCodes = new Set();
  const matchedCountrySet = new Set();
  const invalidOrOutOfRangeSamples = [];

  let aggregateOrNonCountryRowsSkipped = 0;
  let rowsOutsideAcceptedYearWindow = 0;
  let rowsMissingYear = 0;
  let rowsMissingNumericValue = 0;
  let invalidOrOutOfRangeValueCount = 0;

  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }

    if (row.IndicatorCode && row.IndicatorCode !== INDICATOR_CODE) {
      continue;
    }

    if (row.Dim1Type === "IHRSPARCAPACITYLEVEL" && row.Dim1 && row.Dim1 !== "IHRSPARCAPACITYLEVEL_TOTL") {
      continue;
    }
    if (row.Dim2Type === "IHRSPARINDICATORSCORE" && row.Dim2 && row.Dim2 !== "IHRSPARINDICATORSCORE_TOTL") {
      continue;
    }

    if (row.SpatialDimType !== "COUNTRY") {
      aggregateOrNonCountryRowsSkipped += 1;
      continue;
    }

    const iso3 = typeof row.SpatialDim === "string" ? row.SpatialDim.trim().toUpperCase() : null;
    if (!isValidIso3(iso3)) {
      aggregateOrNonCountryRowsSkipped += 1;
      continue;
    }

    if (!eligibleCountries.has(iso3)) {
      unmatchedCodes.add(iso3);
      continue;
    }

    matchedCountrySet.add(iso3);

    const year = parseObservationYear(row);
    if (!Number.isFinite(year)) {
      rowsMissingYear += 1;
      continue;
    }

    if (year < MINIMUM_ACCEPTED_YEAR || year > DEFAULT_MAX_ACCEPTED_YEAR) {
      rowsOutsideAcceptedYearWindow += 1;
      continue;
    }

    const numericValue = parseNumericValue(row);
    if (numericValue === null) {
      rowsMissingNumericValue += 1;
      continue;
    }

    if (numericValue < 0 || numericValue > 100) {
      invalidOrOutOfRangeValueCount += 1;
      if (invalidOrOutOfRangeSamples.length < 20) {
        invalidOrOutOfRangeSamples.push({ iso3, year, value: numericValue });
      }
      continue;
    }

    if (!observationsByIso3.has(iso3)) {
      observationsByIso3.set(iso3, new Map());
    }

    const yearBucket = observationsByIso3.get(iso3);
    const existing = yearBucket.get(year);
    const observation = {
      value: roundNumber(numericValue, 2),
      year,
      source: SOURCE_NAME,
      updatedAt: typeof row.Date === "string" ? row.Date : null,
    };

    if (!existing) {
      yearBucket.set(year, observation);
      continue;
    }

    if (
      observation.updatedAt &&
      existing.updatedAt &&
      Date.parse(observation.updatedAt) > Date.parse(existing.updatedAt)
    ) {
      yearBucket.set(year, observation);
    }
  }

  const output = {};
  const selectedYearDistribution = {
    2024: 0,
    2023: 0,
    2022: 0,
  };
  const countriesMissingSelectedValue = [];

  for (const [iso3, countryMeta] of eligibleCountries.entries()) {
    const selected = choosePreferredObservation(observationsByIso3.get(iso3) ?? new Map());
    if (!selected) {
      countriesMissingSelectedValue.push({
        iso3,
        countryName: countryMeta.name,
      });
      continue;
    }

    selectedYearDistribution[selected.year] += 1;
    output[iso3] = {
      countryIso3: iso3,
      [FIELD_KEY]: {
        value: selected.value,
        year: selected.year,
        source: selected.source,
      },
    };
  }

  if (Object.keys(output).length === 0 && !allowEmpty) {
    throw new Error(
      `No WHO IHR SPAR values were selected from ${API_URL}. First record keys: ${formatSchemaKeys(firstRow)}`,
    );
  }

  const coverage = {
    generatedAt: new Date().toISOString(),
    sourceName: SOURCE_NAME,
    indicatorCode: INDICATOR_CODE,
    apiUrl: API_URL,
    preferredYears: PREFERRED_YEARS,
    minimumAcceptedYear: MINIMUM_ACCEPTED_YEAR,
    defaultMaximumAcceptedYear: DEFAULT_MAX_ACCEPTED_YEAR,
    totalRecordsFetched: rows.length,
    totalEligibleCountries: eligibleCountries.size,
    matchedCountryCount: matchedCountrySet.size,
    countriesWithSelectedValue: Object.keys(output).length,
    countriesMissingSelectedValueCount: countriesMissingSelectedValue.length,
    countriesMissingSelectedValue: countriesMissingSelectedValue,
    countriesMissingSelectedValueSample: countriesMissingSelectedValue.slice(0, MISSING_COUNTRY_SAMPLE_LIMIT),
    selectedYearDistribution,
    invalidOrOutOfRangeValueCount,
    invalidOrOutOfRangeValueSamples: invalidOrOutOfRangeSamples,
    rowsMissingYear,
    rowsMissingNumericValue,
    rowsOutsideAcceptedYearWindow,
    aggregateOrNonCountryRowsSkipped,
    unmatchedCountryOrTerritoryCodes: [...unmatchedCodes].sort().slice(0, UNMATCHED_CODE_SAMPLE_LIMIT),
    unmatchedCountryOrTerritoryCodeCount: unmatchedCodes.size,
    firstRecordKeys: isRecord(firstRow) ? Object.keys(firstRow).sort() : [],
  };

  await mkdir(resolve(__dirname, "..", "public", "data"), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(COVERAGE_PATH, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");

  console.info(`Wrote ${OUTPUT_PATH}`);
  console.info(`Wrote ${COVERAGE_PATH}`);
  console.info(`Countries with selected WHO IHR SPAR value: ${Object.keys(output).length}`);
}

main().catch((error) => {
  console.error("Failed to import WHO IHR SPAR stats.", error);
  process.exitCode = 1;
});
