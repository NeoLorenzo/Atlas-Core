import { mkdir, rm, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import * as unzipper from "unzipper";
import { parse as csvParse } from "csv-parse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GAME_START_DATE = "2025-01-01";
const PREFERRED_DATA_YEAR = 2024;
const FALLBACK_DATA_YEAR = 2023;
const ATLAS_BUCKET_BASE_URL = "https://intl-atlas-downloads.s3.amazonaws.com";
const ATLAS_INDEX_API_URL = `${ATLAS_BUCKET_BASE_URL}/?list-type=2&max-keys=1000`;

const OUTPUT_PATH = resolve(__dirname, "..", "public", "data", "atlas-trade-profiles.json");
const COVERAGE_PATH = resolve(__dirname, "..", "public", "data", "atlas-trade-profiles-coverage.json");
const TEMP_DIR = resolve(__dirname, "..", "public", "data", ".tmp");

const COUNTRY_COLUMN_CANDIDATES = [
  "location_code",
  "country_iso3_code",
  "country_code",
  "iso3",
  "iso_a3",
  "location",
  "country",
  "origin_code",
  "exporter_code",
];

const COUNTRY_NAME_COLUMN_CANDIDATES = [
  "location_name",
  "country_name",
  "name",
  "location",
  "country",
  "exporter_name",
];

const YEAR_COLUMN_CANDIDATES = ["year", "time", "yr", "period"];

const PRODUCT_CODE_COLUMN_CANDIDATES = [
  "hs_product_code",
  "product_hs92_code",
  "product_code",
  "product",
  "hs_code",
  "code",
];

const PRODUCT_NAME_COLUMN_CANDIDATES = [
  "hs_product_name",
  "product_name",
  "name_short_en",
  "name_en",
  "product_label",
  "product_description",
];

const EXPORT_COLUMN_CANDIDATES = [
  "export_value",
  "export_val",
  "exports",
  "exports_value",
  "value_export",
  "export_value_reported",
];

const IMPORT_COLUMN_CANDIDATES = [
  "import_value",
  "import_val",
  "imports",
  "imports_value",
  "value_import",
  "import_value_reported",
];

const TRADE_VALUE_COLUMN_CANDIDATES = ["trade_value", "value", "val"];
const TRADE_DIRECTION_COLUMN_CANDIDATES = ["trade_flow", "flow", "direction", "trade_direction"];
const ECI_COLUMN_CANDIDATES = ["hs_eci", "eci"];

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function decodeXmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

function normalizeColumnName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim().replaceAll(",", "");
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseFloat(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function parseYear(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function isValidIso3(value) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

function getTagValue(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i"));
  return match ? decodeXmlEntities(match[1].trim()) : null;
}

function parseS3ListResponse(xmlText) {
  const objects = [];
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/gi;
  let match = contentsRegex.exec(xmlText);

  while (match) {
    const block = match[1];
    const key = getTagValue(block, "Key");
    const lastModifiedRaw = getTagValue(block, "LastModified");
    const sizeRaw = getTagValue(block, "Size");
    if (key) {
      objects.push({
        key,
        lastModified: lastModifiedRaw ? new Date(lastModifiedRaw).toISOString() : null,
        sizeBytes: sizeRaw ? Number.parseInt(sizeRaw, 10) : null,
      });
    }
    match = contentsRegex.exec(xmlText);
  }

  const isTruncated = /<IsTruncated>true<\/IsTruncated>/i.test(xmlText);
  const nextContinuationToken = getTagValue(xmlText, "NextContinuationToken");

  return {
    objects,
    isTruncated,
    nextContinuationToken,
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/xml,text/xml,text/plain,*/*",
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.text();
}

async function listAtlasObjects() {
  const objects = [];
  let nextToken = null;
  let safetyCounter = 0;

  while (safetyCounter < 20) {
    safetyCounter += 1;
    const url = nextToken ? `${ATLAS_INDEX_API_URL}&continuation-token=${encodeURIComponent(nextToken)}` : ATLAS_INDEX_API_URL;
    const xml = await fetchText(url);
    const parsed = parseS3ListResponse(xml);
    objects.push(...parsed.objects);

    if (!parsed.isTruncated || !parsed.nextContinuationToken) {
      break;
    }

    nextToken = parsed.nextContinuationToken;
  }

  return objects;
}

function tradeDatasetScore(key) {
  const lower = key.toLowerCase();
  let score = 0;

  if (lower.includes("country_hsproduct4digit_year")) {
    score += 100;
  } else if (lower.includes("country_hsproduct6digit_year")) {
    score += 80;
  } else {
    return -1000;
  }

  if (lower.includes("country_partner")) {
    score -= 500;
  }
  if (lower.includes("/test/") || lower.startsWith("test/")) {
    score -= 100;
  }
  if (!lower.includes("/")) {
    score += 20;
  }
  if (lower.endsWith(".csv.zip")) {
    score += 8;
  } else if (lower.endsWith(".csv.gz")) {
    score += 5;
  } else if (lower.endsWith(".csv")) {
    score += 3;
  } else {
    score -= 200;
  }

  return score;
}

function pickBestTradeDataset(objects) {
  const candidates = objects
    .filter((object) => tradeDatasetScore(object.key) > -1000)
    .map((object) => ({ ...object, score: tradeDatasetScore(object.key) }));

  candidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const aTime = a.lastModified ? Date.parse(a.lastModified) : 0;
    const bTime = b.lastModified ? Date.parse(b.lastModified) : 0;
    if (bTime !== aTime) {
      return bTime - aTime;
    }
    return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
  });

  return candidates[0] ?? null;
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url, {
    headers: {
      Accept: "*/*",
      "Accept-Encoding": "*",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download file (${response.status}) from ${url}`);
  }

  const writeStream = createWriteStream(destinationPath);
  Readable.fromWeb(response.body).pipe(writeStream);
  await once(writeStream, "finish");
}

async function getCsvStream(localFilePath) {
  const lower = localFilePath.toLowerCase();
  if (lower.endsWith(".zip")) {
    const directory = await unzipper.Open.file(localFilePath);
    const csvEntry = directory.files.find((file) => file.type === "File" && file.path.toLowerCase().endsWith(".csv"));
    if (!csvEntry) {
      throw new Error(`ZIP archive did not contain a CSV file: ${localFilePath}`);
    }
    return csvEntry.stream();
  }

  if (lower.endsWith(".gz")) {
    return createReadStream(localFilePath).pipe(createGunzip());
  }

  return createReadStream(localFilePath);
}

function detectColumn(headers, candidates) {
  const lowerHeaderMap = new Map(headers.map((header) => [header.toLowerCase(), header]));
  const normalizedHeaderMap = new Map(headers.map((header) => [normalizeColumnName(header), header]));

  for (const candidate of candidates) {
    const direct = lowerHeaderMap.get(candidate.toLowerCase());
    if (direct) {
      return direct;
    }
    const normalized = normalizedHeaderMap.get(normalizeColumnName(candidate));
    if (normalized) {
      return normalized;
    }
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeColumnName(candidate);
    for (const header of headers) {
      const normalizedHeader = normalizeColumnName(header);
      if (normalizedHeader.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedHeader)) {
        return header;
      }
    }
  }

  return null;
}

function detectSchema(headers) {
  const schema = {
    iso3: detectColumn(headers, COUNTRY_COLUMN_CANDIDATES),
    countryName: detectColumn(headers, COUNTRY_NAME_COLUMN_CANDIDATES),
    year: detectColumn(headers, YEAR_COLUMN_CANDIDATES),
    productCode: detectColumn(headers, PRODUCT_CODE_COLUMN_CANDIDATES),
    productName: detectColumn(headers, PRODUCT_NAME_COLUMN_CANDIDATES),
    exportValue: detectColumn(headers, EXPORT_COLUMN_CANDIDATES),
    importValue: detectColumn(headers, IMPORT_COLUMN_CANDIDATES),
    tradeValue: detectColumn(headers, TRADE_VALUE_COLUMN_CANDIDATES),
    tradeDirection: detectColumn(headers, TRADE_DIRECTION_COLUMN_CANDIDATES),
    eci: detectColumn(headers, ECI_COLUMN_CANDIDATES),
  };

  if (!schema.iso3 || !schema.year || !schema.productCode) {
    throw new Error(
      `Could not detect required Atlas columns. Found headers: ${headers.join(", ")}`,
    );
  }

  if (!schema.exportValue && !schema.importValue && !schema.tradeValue) {
    throw new Error(
      `Could not detect export/import value columns in Atlas dataset. Found headers: ${headers.join(", ")}`,
    );
  }

  return schema;
}

function extractTradeValues(record, schema) {
  const exportValue = schema.exportValue ? parseNumber(record[schema.exportValue]) : null;
  const importValue = schema.importValue ? parseNumber(record[schema.importValue]) : null;

  if (exportValue !== null || importValue !== null) {
    return {
      exportValue: exportValue !== null && exportValue > 0 ? exportValue : 0,
      importValue: importValue !== null && importValue > 0 ? importValue : 0,
    };
  }

  const genericValue = schema.tradeValue ? parseNumber(record[schema.tradeValue]) : null;
  if (genericValue === null || genericValue <= 0) {
    return { exportValue: 0, importValue: 0 };
  }

  const directionRaw = schema.tradeDirection ? String(record[schema.tradeDirection] ?? "").toLowerCase() : "";
  if (directionRaw.includes("import") || directionRaw === "imp" || directionRaw === "i") {
    return { exportValue: 0, importValue: genericValue };
  }

  return { exportValue: genericValue, importValue: 0 };
}

async function streamAtlasCsv(localFilePath, onRow) {
  const csvInputStream = await getCsvStream(localFilePath);
  const parser = csvParse({
    columns: true,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: true,
    skip_empty_lines: true,
  });

  csvInputStream.pipe(parser);
  for await (const record of parser) {
    if (isRecord(record)) {
      onRow(record);
    }
  }
}

function createCountryAccumulator(iso3, name) {
  return {
    iso3,
    name,
    totalExportsUsd: 0,
    totalImportsUsd: 0,
    exportByProduct: new Map(),
    importByProduct: new Map(),
    eci: null,
  };
}

function upsertProduct(map, productCode, productName, value) {
  if (value <= 0) {
    return;
  }

  const existing = map.get(productCode);
  if (!existing) {
    map.set(productCode, {
      productCode,
      productName: productName ?? null,
      value,
    });
    return;
  }

  existing.value += value;
  if (!existing.productName && productName) {
    existing.productName = productName;
  }
}

function computeHhi(productEntries, totalValue) {
  if (totalValue <= 0) {
    return null;
  }

  let hhi = 0;
  for (const entry of productEntries) {
    if (entry.value <= 0) {
      continue;
    }
    const share = entry.value / totalValue;
    hhi += share * share;
  }

  return hhi;
}

function buildTopProducts(productEntries, totalValue, valueFieldName, shareFieldName) {
  if (totalValue <= 0) {
    return [];
  }

  return [...productEntries]
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
    .map((entry) => ({
      productCode: entry.productCode,
      productName: entry.productName ?? null,
      [valueFieldName]: entry.value,
      [shareFieldName]: (entry.value / totalValue) * 100,
    }));
}

function getSelectedYear(availableYears) {
  if (availableYears.has(PREFERRED_DATA_YEAR)) {
    return PREFERRED_DATA_YEAR;
  }
  if (availableYears.has(FALLBACK_DATA_YEAR)) {
    return FALLBACK_DATA_YEAR;
  }
  if (availableYears.size === 0) {
    return null;
  }
  return Math.max(...availableYears);
}

async function main() {
  console.info("Discovering Atlas bulk-download files...");
  const atlasObjects = await listAtlasObjects();
  const selectedDataset = pickBestTradeDataset(atlasObjects);

  if (!selectedDataset) {
    throw new Error("Could not find a suitable unilateral Atlas country-product dataset in the official index.");
  }

  const sourceUrl = `${ATLAS_BUCKET_BASE_URL}/${selectedDataset.key}`;
  const localFilePath = resolve(TEMP_DIR, selectedDataset.key.split("/").at(-1) ?? "atlas-trade-dataset.csv.zip");
  await mkdir(TEMP_DIR, { recursive: true });

  console.info(`Downloading Atlas file: ${selectedDataset.key}`);
  await downloadFile(sourceUrl, localFilePath);

  let detectedSchema = null;
  const yearCounts = new Map();
  let rowCount = 0;

  console.info("Scanning Atlas dataset years and headers...");
  await streamAtlasCsv(localFilePath, (record) => {
    if (!detectedSchema) {
      detectedSchema = detectSchema(Object.keys(record));
      console.info("Detected Atlas columns:", detectedSchema);
    }

    const yearValue = parseYear(record[detectedSchema.year]);
    if (yearValue !== null) {
      yearCounts.set(yearValue, (yearCounts.get(yearValue) ?? 0) + 1);
    }

    rowCount += 1;
  });

  const selectedYear = getSelectedYear(new Set(yearCounts.keys()));
  if (selectedYear === null) {
    throw new Error("Atlas dataset did not contain any parseable year values.");
  }

  console.info(`Detected ${yearCounts.size} years across ${rowCount.toLocaleString()} rows.`);
  console.info(`Selected Atlas year: ${selectedYear}`);

  const countries = new Map();
  let eciFoundInAnyRow = false;

  console.info("Aggregating country trade profiles...");
  await streamAtlasCsv(localFilePath, (record) => {
    const year = parseYear(record[detectedSchema.year]);
    if (year !== selectedYear) {
      return;
    }

    const rawIso3 = String(record[detectedSchema.iso3] ?? "").trim().toUpperCase();
    if (!isValidIso3(rawIso3)) {
      return;
    }

    const productCode = String(record[detectedSchema.productCode] ?? "").trim();
    if (!productCode) {
      return;
    }

    const countryNameValue = detectedSchema.countryName ? String(record[detectedSchema.countryName] ?? "").trim() : "";
    const productNameValue = detectedSchema.productName ? String(record[detectedSchema.productName] ?? "").trim() : "";

    if (!countries.has(rawIso3)) {
      countries.set(rawIso3, createCountryAccumulator(rawIso3, countryNameValue || rawIso3));
    }
    const country = countries.get(rawIso3);
    if (!country.name && countryNameValue) {
      country.name = countryNameValue;
    }

    if (detectedSchema.eci && country.eci === null) {
      const eciValue = parseNumber(record[detectedSchema.eci]);
      if (eciValue !== null) {
        country.eci = eciValue;
        eciFoundInAnyRow = true;
      }
    }

    const { exportValue, importValue } = extractTradeValues(record, detectedSchema);

    if (exportValue > 0) {
      country.totalExportsUsd += exportValue;
      upsertProduct(country.exportByProduct, productCode, productNameValue || null, exportValue);
    }
    if (importValue > 0) {
      country.totalImportsUsd += importValue;
      upsertProduct(country.importByProduct, productCode, productNameValue || null, importValue);
    }
  });

  const countriesByIso3 = {};
  const missingFieldsByCountry = {};
  let countriesWithExportData = 0;
  let countriesWithImportData = 0;
  let countriesWithCompleteTradeProfile = 0;
  let countriesWithPartialTradeProfile = 0;
  let countriesWithNoUsableTradeData = 0;

  const sortedIso3 = Array.from(countries.keys()).sort();

  for (const iso3 of sortedIso3) {
    const country = countries.get(iso3);
    const exportProducts = Array.from(country.exportByProduct.values());
    const importProducts = Array.from(country.importByProduct.values());

    const hasExportData = country.totalExportsUsd > 0;
    const hasImportData = country.totalImportsUsd > 0;

    if (hasExportData) {
      countriesWithExportData += 1;
    }
    if (hasImportData) {
      countriesWithImportData += 1;
    }

    const indicators = {
      totalExportsUsd: hasExportData ? country.totalExportsUsd : null,
      totalImportsUsd: hasImportData ? country.totalImportsUsd : null,
      tradeBalanceUsd: hasExportData || hasImportData ? country.totalExportsUsd - country.totalImportsUsd : null,
      exportDiversityProductCount: hasExportData ? exportProducts.filter((entry) => entry.value > 0).length : null,
      importDiversityProductCount: hasImportData ? importProducts.filter((entry) => entry.value > 0).length : null,
      exportConcentrationHhi: hasExportData ? computeHhi(exportProducts, country.totalExportsUsd) : null,
      importConcentrationHhi: hasImportData ? computeHhi(importProducts, country.totalImportsUsd) : null,
      economicComplexityIndex: country.eci,
    };

    const missingIndicators = Object.entries(indicators)
      .filter(([, value]) => value === null)
      .map(([key]) => key);

    if (missingIndicators.length === 0) {
      countriesWithCompleteTradeProfile += 1;
    } else if (missingIndicators.length === Object.keys(indicators).length) {
      countriesWithNoUsableTradeData += 1;
    } else {
      countriesWithPartialTradeProfile += 1;
      missingFieldsByCountry[iso3] = {
        name: country.name || iso3,
        missingIndicators,
      };
    }

    countriesByIso3[iso3] = {
      iso3,
      name: country.name || iso3,
      source: "Atlas of Economic Complexity",
      gameStartDate: GAME_START_DATE,
      preferredDataYear: PREFERRED_DATA_YEAR,
      fallbackDataYear: FALLBACK_DATA_YEAR,
      year: selectedYear,
      indicators,
      topExports: buildTopProducts(exportProducts, country.totalExportsUsd, "exportValueUsd", "shareOfExportsPct"),
      topImports: buildTopProducts(importProducts, country.totalImportsUsd, "importValueUsd", "shareOfImportsPct"),
    };
  }

  const generatedAt = new Date().toISOString();
  const output = {
    source: "Atlas of Economic Complexity",
    gameStartDate: GAME_START_DATE,
    preferredDataYear: PREFERRED_DATA_YEAR,
    fallbackDataYear: FALLBACK_DATA_YEAR,
    generatedAt,
    sourceFile: {
      key: selectedDataset.key,
      url: sourceUrl,
      lastModified: selectedDataset.lastModified,
      sizeBytes: selectedDataset.sizeBytes,
    },
    selectedYear,
    countriesByIso3,
  };

  const selectedYearStrategyNote =
    selectedYear === PREFERRED_DATA_YEAR
      ? "Used preferred year 2024."
      : selectedYear === FALLBACK_DATA_YEAR
        ? "Used fallback year 2023 because 2024 was unavailable."
        : `2024/2023 unavailable in Atlas file; used latest available year ${selectedYear}.`;

  const coverage = {
    generatedAt,
    sourceUrl,
    sourceFileKey: selectedDataset.key,
    selectedYear,
    selectedYearStrategyNote,
    totalCountriesImported: sortedIso3.length,
    countriesWithExportData,
    countriesWithImportData,
    countriesWithCompleteTradeProfile,
    countriesWithPartialTradeProfile,
    countriesWithNoUsableTradeData,
    missingFieldsByCountry,
    economicComplexityIndexFound: eciFoundInAnyRow,
    notes: {
      eci:
        eciFoundInAnyRow
          ? "ECI detected in source rows."
          : "ECI column not found or empty in source rows. economicComplexityIndex left as null.",
      aggregation:
        "Trade indicators are derived from unilateral country-product flows. Top products are capped to top 10 per flow in output.",
    },
  };

  await mkdir(resolve(__dirname, "..", "public", "data"), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(COVERAGE_PATH, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");

  await rm(localFilePath, { force: true });

  console.info("=== Atlas Trade Import Summary ===");
  console.info(`Atlas file: ${selectedDataset.key}`);
  console.info(`Selected year: ${selectedYear}`);
  console.info(`Countries imported: ${sortedIso3.length}`);
  console.info(`Countries with complete profiles: ${countriesWithCompleteTradeProfile}`);
  console.info(`Countries with partial profiles: ${countriesWithPartialTradeProfile}`);
  console.info(`Countries with no usable data: ${countriesWithNoUsableTradeData}`);
  console.info(`ECI found: ${eciFoundInAnyRow ? "yes" : "no"}`);
  console.info(`Wrote ${OUTPUT_PATH}`);
  console.info(`Wrote ${COVERAGE_PATH}`);
}

main().catch((error) => {
  console.error("Failed to import Atlas trade profiles.", error);
  process.exitCode = 1;
});
