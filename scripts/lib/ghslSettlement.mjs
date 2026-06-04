import { createWriteStream } from "node:fs";
import { access, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";
import unzipper from "unzipper";
import {
  buildProvinceIndex,
  matchPointToProvince,
  normalizeLooseText,
  resolveCountryIso3FromNames,
} from "./provinceUtils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const GAME_START_DATE = "2025-01-01";
export const GHSL_YEAR = 2025;
export const GHSL_SOURCE = "GHSL GHS-UCDB R2024A";
export const GHSL_ARCHIVE_URL =
  "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_UCDB_GLOBE_R2024A/GHS_UCDB_GLOBE_R2024A/V1-1/GHS_UCDB_GLOBE_R2024A_V1_1.zip";

export const RAW_GHSL_DIR = resolve(__dirname, "..", "..", "public", "data", "raw", "ghsl");
export const GHSL_ARCHIVE_PATH = resolve(RAW_GHSL_DIR, "GHS_UCDB_GLOBE_R2024A_V1_1.zip");
export const GHSL_GPKG_PATH = resolve(RAW_GHSL_DIR, "GHS_UCDB_GLOBE_R2024A.gpkg");

export const URBAN_CENTRES_PATH = resolve(__dirname, "..", "..", "public", "data", "urban-centres.json");
export const URBAN_CENTRES_COVERAGE_PATH = resolve(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "urban-centres-coverage.json",
);
export const PROVINCE_SETTLEMENT_STATS_PATH = resolve(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "province-settlement-stats.json",
);
export const PROVINCE_SETTLEMENT_STATS_COVERAGE_PATH = resolve(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "province-settlement-stats-coverage.json",
);

const UCDB_ONLY_COMPLETENESS = {
  value: "urban-centres-only",
  year: GHSL_YEAR,
  source: "GHSL GHS-UCDB; does not include full raster population or full built-up surface",
};

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function clampPercentage(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function roundNumber(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeGhslCoordinates(longitude, latitude) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return null;
  }

  if (Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90) {
    return [longitude, latitude];
  }

  // GHSL UCDB centroid coordinates in the GeoPackage are stored in ESRI:54009 (World Mollweide) metres.
  const radius = 6_378_137;
  const theta = Math.asin(latitude / (Math.sqrt(2) * radius));
  const lon = (Math.PI * longitude) / (2 * Math.sqrt(2) * radius * Math.cos(theta));
  const lat = Math.asin((2 * theta + Math.sin(2 * theta)) / Math.PI);

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null;
  }

  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

export function makeFact(value, year, source, digits = null) {
  if (!Number.isFinite(value) || !Number.isFinite(year) || typeof source !== "string" || source.length === 0) {
    return { value: null, year: null, source: null };
  }
  return {
    value: digits === null ? value : roundNumber(value, digits),
    year,
    source,
  };
}

async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function ensureGhslArchive() {
  if (await pathExists(GHSL_ARCHIVE_PATH)) {
    return GHSL_ARCHIVE_PATH;
  }

  await mkdir(RAW_GHSL_DIR, { recursive: true });
  const response = await fetch(GHSL_ARCHIVE_URL);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download GHSL UCDB archive (${response.status}) from ${GHSL_ARCHIVE_URL}`);
  }

  await pipeline(response.body, createWriteStream(GHSL_ARCHIVE_PATH));
  return GHSL_ARCHIVE_PATH;
}

export async function ensureGhslGeoPackage() {
  const archivePath = await ensureGhslArchive();

  const [archiveStats, gpkgExists] = await Promise.all([
    stat(archivePath),
    pathExists(GHSL_GPKG_PATH),
  ]);

  if (gpkgExists) {
    const gpkgStats = await stat(GHSL_GPKG_PATH);
    if (gpkgStats.mtimeMs >= archiveStats.mtimeMs) {
      return GHSL_GPKG_PATH;
    }
  }

  await mkdir(RAW_GHSL_DIR, { recursive: true });
  const directory = await unzipper.Open.file(archivePath);
  const gpkgEntry = directory.files.find((entry) => entry.path === "GHS_UCDB_GLOBE_R2024A.gpkg");
  if (!gpkgEntry) {
    throw new Error("GHSL UCDB archive does not contain GHS_UCDB_GLOBE_R2024A.gpkg");
  }

  await pipeline(gpkgEntry.stream(), createWriteStream(GHSL_GPKG_PATH));
  return GHSL_GPKG_PATH;
}

function sanitizeColumnName(name) {
  return String(name ?? "").replace(/^\uFEFF/, "");
}

function quoteIdentifier(name) {
  return `"${String(name).replace(/"/g, "\"\"")}"`;
}

function getColumnMap(db, tableName) {
  const rows = db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all();
  const columnMap = new Map();
  for (const row of rows) {
    if (row && typeof row.name === "string") {
      columnMap.set(sanitizeColumnName(row.name), row.name);
    }
  }
  return columnMap;
}

function getRequiredColumn(columnMap, columnName, tableName) {
  const actual = columnMap.get(columnName);
  if (!actual) {
    throw new Error(`Expected column ${columnName} in GHSL table ${tableName}`);
  }
  return actual;
}

function getSourceReadmeNotes() {
  return [
    "This first-pass pipeline uses the official GHSL UCDB R2024A urban-centre release.",
    "Province and country settlement rollups are urban-centre-only aggregates derived from matched UCDB records.",
    "No full GHSL raster zonal aggregation is performed in this pass for province-wide population or built-up totals.",
    "Field names intentionally use urban-centre-specific wording to avoid implying whole-province or whole-country totals.",
  ];
}

async function loadCanonicalCountriesByIso3() {
  const path = resolve(__dirname, "..", "..", "public", "data", "canonical-country-data.json");
  if (!(await pathExists(path))) {
    return {};
  }
  const raw = JSON.parse(await readFile(path, "utf8"));
  return isRecord(raw?.countriesByIso3) ? raw.countriesByIso3 : {};
}

export async function loadGhslUrbanCentreRows() {
  const gpkgPath = await ensureGhslGeoPackage();
  const tempCopyPath = resolve(__dirname, "..", "..", "temp_ghsl_ucdb.gpkg");

  await copyFile(gpkgPath, tempCopyPath);

  const db = new DatabaseSync(tempCopyPath, { readOnly: true });
  try {
    const generalTable = "GHS_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A";
    const ghslTable = "GHS_UCDB_THEME_GHSL_GLOBE_R2024A";
    const centroidTable = "UC_centroids";

    const generalColumns = getColumnMap(db, generalTable);
    const ghslColumns = getColumnMap(db, ghslTable);
    const centroidColumns = getColumnMap(db, centroidTable);

    const generalId = getRequiredColumn(generalColumns, "ID_UC_G0", generalTable);
    const ghslId = getRequiredColumn(ghslColumns, "ID_UC_G0", ghslTable);
    const centroidId = getRequiredColumn(centroidColumns, "ID_UC_G0", centroidTable);

    const selectColumns = [
      ["idUcG0", quoteIdentifier(generalId), "g"],
      ["urbanCentreName", quoteIdentifier(getRequiredColumn(generalColumns, "GC_UCN_MAI_2025", generalTable)), "g"],
      ["urbanCentreNames", quoteIdentifier(getRequiredColumn(generalColumns, "GC_UCN_LIS_2025", generalTable)), "g"],
      ["countryNameGadm", quoteIdentifier(getRequiredColumn(generalColumns, "GC_CNT_GAD_2025", generalTable)), "g"],
      ["countryNameUnn", quoteIdentifier(getRequiredColumn(generalColumns, "GC_CNT_UNN_2025", generalTable)), "g"],
      ["urbanCentreAreaKm2", quoteIdentifier(getRequiredColumn(generalColumns, "GC_UCA_KM2_2025", generalTable)), "g"],
      ["urbanCentrePopulation2025", quoteIdentifier(getRequiredColumn(generalColumns, "GC_POP_TOT_2025", generalTable)), "g"],
      ["isCapitalFlag", quoteIdentifier(getRequiredColumn(generalColumns, "GC_UCM_CAP", generalTable)), "g"],
      ["builtUpSurfaceM2", quoteIdentifier(getRequiredColumn(ghslColumns, "GH_BUS_TOT_2025", ghslTable)), "h"],
      ["ghslPopulation2025", quoteIdentifier(getRequiredColumn(ghslColumns, "GH_POP_TOT_2025", ghslTable)), "h"],
      ["longitude", quoteIdentifier(getRequiredColumn(centroidColumns, "GC_UCC_LON_2025", centroidTable)), "c"],
      ["latitude", quoteIdentifier(getRequiredColumn(centroidColumns, "GC_UCC_LAT_2025", centroidTable)), "c"],
    ];

    const query = `
      SELECT
        ${selectColumns.map(([alias, column, tableAlias]) => `${tableAlias}.${column} AS ${quoteIdentifier(alias)}`).join(",\n        ")}
      FROM ${quoteIdentifier(generalTable)} g
      LEFT JOIN ${quoteIdentifier(ghslTable)} h
        ON g.${quoteIdentifier(generalId)} = h.${quoteIdentifier(ghslId)}
      LEFT JOIN ${quoteIdentifier(centroidTable)} c
        ON g.${quoteIdentifier(generalId)} = c.${quoteIdentifier(centroidId)}
      ORDER BY CAST(g.${quoteIdentifier(generalId)} AS INTEGER) ASC
    `;

    return db.prepare(query).all();
  } finally {
    db.close();
  }
}

function buildUrbanCentreRecord(rawRow, provinceIndex) {
  const sourcePopulation = toFiniteNumber(rawRow.ghslPopulation2025) ?? toFiniteNumber(rawRow.urbanCentrePopulation2025);
  const sourceBuiltUpM2 = toFiniteNumber(rawRow.builtUpSurfaceM2);
  const builtUpAreaKm2 = sourceBuiltUpM2 === null ? null : sourceBuiltUpM2 / 1_000_000;
  const rawLongitude = toFiniteNumber(rawRow.longitude);
  const rawLatitude = toFiniteNumber(rawRow.latitude);
  const normalizedCoordinates =
    rawLongitude !== null && rawLatitude !== null ? normalizeGhslCoordinates(rawLongitude, rawLatitude) : null;
  const longitude = normalizedCoordinates?.[0] ?? null;
  const latitude = normalizedCoordinates?.[1] ?? null;
  const countryIso3 = resolveCountryIso3FromNames(
    provinceIndex.countryAliasToIso3,
    rawRow.countryNameUnn,
    rawRow.countryNameGadm,
  );
  const provinceMatch =
    longitude !== null && latitude !== null
      ? matchPointToProvince([longitude, latitude], provinceIndex, countryIso3)
      : null;

  const populationFact = makeFact(sourcePopulation, GHSL_YEAR, `${GHSL_SOURCE} population`);
  const builtUpAreaFact = makeFact(builtUpAreaKm2, GHSL_YEAR, `${GHSL_SOURCE} built-up surface`, 3);
  const densityFact =
    populationFact.value !== null && builtUpAreaFact.value !== null && builtUpAreaFact.value > 0
      ? makeFact(populationFact.value / builtUpAreaFact.value, GHSL_YEAR, `${GHSL_SOURCE} derived density`, 2)
      : { value: null, year: null, source: null };

  return {
    id: `ghsl-${String(rawRow.idUcG0)}`,
    name:
      typeof rawRow.urbanCentreName === "string" && rawRow.urbanCentreName.trim().length > 0
        ? rawRow.urbanCentreName.trim()
        : `Urban Centre ${String(rawRow.idUcG0)}`,
    countryIso3,
    countryName:
      (typeof rawRow.countryNameUnn === "string" && rawRow.countryNameUnn.trim().length > 0
        ? rawRow.countryNameUnn.trim()
        : null) ??
      (typeof rawRow.countryNameGadm === "string" && rawRow.countryNameGadm.trim().length > 0
        ? rawRow.countryNameGadm.trim()
        : null),
    provinceId: provinceMatch?.provinceId ?? null,
    provinceName: provinceMatch?.provinceName ?? null,
    coordinates: longitude !== null && latitude !== null ? [longitude, latitude] : null,
    population: populationFact,
    builtUpAreaKm2: builtUpAreaFact,
    densityPerKm2: densityFact,
    isCapital: rawRow.isCapitalFlag === 1 || rawRow.isCapitalFlag === "1",
    source: GHSL_SOURCE,
    sourceAttributes: {
      idUcG0: rawRow.idUcG0,
      countryNameGadm: rawRow.countryNameGadm ?? null,
      countryNameUnn: rawRow.countryNameUnn ?? null,
      urbanCentreNames:
        typeof rawRow.urbanCentreNames === "string" && rawRow.urbanCentreNames.trim().length > 0
          ? rawRow.urbanCentreNames.trim()
          : null,
      urbanCentreAreaKm2: toFiniteNumber(rawRow.urbanCentreAreaKm2),
    },
  };
}

function sortUrbanCentres(records) {
  return [...records].sort((left, right) => {
    const popDiff = (right.population.value ?? -1) - (left.population.value ?? -1);
    if (popDiff !== 0) {
      return popDiff;
    }
    return left.id.localeCompare(right.id);
  });
}

export async function buildUrbanCentresDataset() {
  const canonicalCountriesByIso3 = await loadCanonicalCountriesByIso3();
  const provinceIndex = await buildProvinceIndex({ canonicalCountriesByIso3 });
  const rows = await loadGhslUrbanCentreRows();

  const urbanCentres = sortUrbanCentres(rows.map((row) => buildUrbanCentreRecord(row, provinceIndex)));
  const urbanCentresById = Object.fromEntries(urbanCentres.map((record) => [record.id, record]));

  const unmatched = urbanCentres.filter((record) => record.provinceId === null);
  const matchedCountries = new Set(
    urbanCentres.filter((record) => record.countryIso3).map((record) => record.countryIso3),
  );

  const coverage = {
    source: GHSL_SOURCE,
    generatedAt: new Date().toISOString(),
    records: {
      total: urbanCentres.length,
      matched: urbanCentres.length - unmatched.length,
      unmatched: unmatched.length,
    },
    countries: {
      total: matchedCountries.size,
      withSettlementData: matchedCountries.size,
      withoutSettlementData: 0,
    },
    provinces: {
      total: provinceIndex.provinces.length,
      withPopulationEstimate: 0,
      withUrbanCentre: 0,
      withoutSettlementData: 0,
    },
    urbanCentres: {
      total: urbanCentres.length,
      matchedToProvince: urbanCentres.length - unmatched.length,
      unmatchedToProvince: unmatched.length,
    },
    fieldCoverage: {
      populationEstimate: clampPercentage(
        (urbanCentres.filter((record) => record.population.value !== null).length / urbanCentres.length) * 100,
      ),
      builtUpAreaKm2: clampPercentage(
        (urbanCentres.filter((record) => record.builtUpAreaKm2.value !== null).length / urbanCentres.length) * 100,
      ),
      urbanCentreCount: 100,
      populationConcentrationHhi: 0,
    },
    unmatchedExamples: unmatched.slice(0, 25).map((record) => ({
      id: record.id,
      name: record.name,
      countryIso3: record.countryIso3,
      countryName: record.countryName,
      coordinates: record.coordinates,
    })),
    notes: getSourceReadmeNotes(),
  };

  return { provinceIndex, urbanCentres, urbanCentresById, coverage };
}

function computeHhi(values) {
  const filtered = values.filter((value) => Number.isFinite(value) && value > 0);
  if (filtered.length === 0) {
    return null;
  }
  const total = filtered.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return null;
  }
  return filtered.reduce((sum, value) => {
    const share = value / total;
    return sum + share * share;
  }, 0);
}

function emptySettlementRecord(province) {
  return {
    provinceId: province.provinceId,
    provinceName: province.provinceName,
    countryIso3: province.countryIso3,
    countryName: province.countryName,
    settlement: {
      urbanCentrePopulationEstimate: { value: null, year: null, source: null },
      urbanCentrePopulationDensityPerKm2: { value: null, year: null, source: null },
      urbanCentreBuiltUpAreaKm2: { value: null, year: null, source: null },
      urbanCentreBuiltUpSharePct: { value: null, year: null, source: null },
      urbanCentreCount: makeFact(0, GHSL_YEAR, GHSL_SOURCE),
      largestUrbanCentreId: null,
      largestUrbanCentreName: null,
      largestUrbanCentrePopulationEstimate: { value: null, year: null, source: null },
      populationConcentrationHhi: { value: null, year: null, source: null },
      settlementDataCompleteness: UCDB_ONLY_COMPLETENESS,
    },
  };
}

export function buildProvinceSettlementDataset(provinceIndex, urbanCentresById) {
  const provinceRecords = Object.fromEntries(
    provinceIndex.provinces.map((province) => [province.provinceId, emptySettlementRecord(province)]),
  );

  const grouped = new Map();
  for (const record of Object.values(urbanCentresById)) {
    if (!record.provinceId) {
      continue;
    }
    if (!grouped.has(record.provinceId)) {
      grouped.set(record.provinceId, []);
    }
    grouped.get(record.provinceId).push(record);
  }

  for (const [provinceId, centres] of grouped.entries()) {
    const province = provinceIndex.byId.get(provinceId);
    const record = provinceRecords[provinceId];
    const sortedCentres = sortUrbanCentres(centres);
    const totalPopulation = sortedCentres.reduce((sum, centre) => sum + (centre.population.value ?? 0), 0);
    const totalBuiltUpAreaKm2 = sortedCentres.reduce((sum, centre) => sum + (centre.builtUpAreaKm2.value ?? 0), 0);
    const largestCentre = sortedCentres[0] ?? null;
    const hhi = computeHhi(sortedCentres.map((centre) => centre.population.value));

    record.settlement.urbanCentrePopulationEstimate = makeFact(
      totalPopulation,
      GHSL_YEAR,
      `${GHSL_SOURCE} matched urban-centre population sum`,
      0,
    );
    record.settlement.urbanCentrePopulationDensityPerKm2 =
      province && province.areaKm2 > 0
        ? makeFact(
            totalPopulation / province.areaKm2,
            GHSL_YEAR,
            `${GHSL_SOURCE} matched urban-centre population sum + Natural Earth province area`,
            2,
          )
        : { value: null, year: null, source: null };
    record.settlement.urbanCentreBuiltUpAreaKm2 = makeFact(
      totalBuiltUpAreaKm2,
      GHSL_YEAR,
      `${GHSL_SOURCE} matched urban-centre built-up sum`,
      3,
    );
    record.settlement.urbanCentreBuiltUpSharePct =
      province && province.areaKm2 > 0
        ? makeFact(
            (totalBuiltUpAreaKm2 / province.areaKm2) * 100,
            GHSL_YEAR,
            `${GHSL_SOURCE} matched urban-centre built-up sum + Natural Earth province area`,
            3,
          )
        : { value: null, year: null, source: null };
    record.settlement.urbanCentreCount = makeFact(sortedCentres.length, GHSL_YEAR, GHSL_SOURCE, 0);
    record.settlement.largestUrbanCentreId = largestCentre?.id ?? null;
    record.settlement.largestUrbanCentreName = largestCentre?.name ?? null;
    record.settlement.largestUrbanCentrePopulationEstimate = largestCentre?.population ?? {
      value: null,
      year: null,
      source: null,
    };
    record.settlement.populationConcentrationHhi =
      hhi === null ? { value: null, year: null, source: null } : makeFact(hhi, GHSL_YEAR, `Derived from ${GHSL_SOURCE}`, 4);
  }

  const provinceValues = Object.values(provinceRecords);
  const provincesWithPopulationEstimate = provinceValues.filter(
    (record) => record.settlement.urbanCentrePopulationEstimate.value !== null,
  ).length;
  const provincesWithUrbanCentre = provinceValues.filter((record) => (record.settlement.urbanCentreCount.value ?? 0) > 0).length;
  const countriesWithSettlementData = new Set(
    provinceValues
      .filter((record) => record.settlement.urbanCentrePopulationEstimate.value !== null && record.countryIso3)
      .map((record) => record.countryIso3),
  );

  const matchedUrbanCentres = Object.values(urbanCentresById).filter((record) => record.provinceId !== null);
  const unmatchedUrbanCentres = Object.values(urbanCentresById).filter((record) => record.provinceId === null);

  const coverage = {
    source: GHSL_SOURCE,
    generatedAt: new Date().toISOString(),
    records: {
      total: provinceValues.length,
      matched: provincesWithUrbanCentre,
      unmatched: provinceValues.length - provincesWithUrbanCentre,
    },
    countries: {
      total: new Set(provinceValues.map((record) => record.countryIso3).filter(Boolean)).size,
      withSettlementData: countriesWithSettlementData.size,
      withoutSettlementData:
        new Set(provinceValues.map((record) => record.countryIso3).filter(Boolean)).size - countriesWithSettlementData.size,
    },
    provinces: {
      total: provinceValues.length,
      withUrbanCentrePopulationEstimate: provincesWithPopulationEstimate,
      withUrbanCentre: provincesWithUrbanCentre,
      withoutSettlementData: provinceValues.length - provincesWithUrbanCentre,
    },
    urbanCentres: {
      total: Object.keys(urbanCentresById).length,
      matchedToProvince: matchedUrbanCentres.length,
      unmatchedToProvince: unmatchedUrbanCentres.length,
    },
    fieldCoverage: {
      urbanCentrePopulationEstimate: clampPercentage((provincesWithPopulationEstimate / provinceValues.length) * 100),
      urbanCentreBuiltUpAreaKm2: clampPercentage(
        (provinceValues.filter((record) => record.settlement.urbanCentreBuiltUpAreaKm2.value !== null).length / provinceValues.length) *
          100,
      ),
      urbanCentreCount: clampPercentage((provincesWithUrbanCentre / provinceValues.length) * 100),
      populationConcentrationHhi: clampPercentage(
        (provinceValues.filter((record) => record.settlement.populationConcentrationHhi.value !== null).length /
          provinceValues.length) *
          100,
      ),
    },
    unmatchedExamples: unmatchedUrbanCentres.slice(0, 25).map((record) => ({
      id: record.id,
      name: record.name,
      countryIso3: record.countryIso3,
      countryName: record.countryName,
      coordinates: record.coordinates,
    })),
    notes: getSourceReadmeNotes(),
    settlementDataCompleteness: UCDB_ONLY_COMPLETENESS,
  };

  return {
    provinceRecords,
    coverage,
  };
}
