import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import unzipper from "unzipper";
import { fromFile } from "geotiff";
import { buildProvinceIndex } from "./provinceUtils.mjs";
import { GHSL_YEAR, makeFact, writeJson } from "./ghslSettlement.mjs";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const GHSL_RASTER_RAW_DIR = resolve(__dirname, "..", "..", "public", "data", "raw", "ghsl-raster");
export const PROVINCE_RASTER_SETTLEMENT_STATS_PATH = resolve(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "province-raster-settlement-stats.json",
);
export const PROVINCE_RASTER_SETTLEMENT_STATS_COVERAGE_PATH = resolve(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "province-raster-settlement-stats-coverage.json",
);
export const PROVINCE_RASTER_SETTLEMENT_STATS_PARTIAL_PATH = resolve(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "province-raster-settlement-stats.partial.json",
);
export const PROVINCE_RASTER_SETTLEMENT_STATS_PROGRESS_PATH = resolve(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "province-raster-settlement-stats-progress.json",
);
export const PROVINCE_RASTER_INDEX_GEOJSON_PATH = resolve(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "raw",
  "ghsl-raster",
  "province-index-4326-30ss.geojson",
);
export const PROVINCE_RASTER_POPULATION_MASK_PATH = resolve(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "raw",
  "ghsl-raster",
  "province-id-mask-population-4326-30ss.tif",
);
export const PROVINCE_RASTER_BUILT_MASK_PATH = resolve(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "raw",
  "ghsl-raster",
  "province-id-mask-built-4326-30ss.tif",
);

export const GHSL_POP_SOURCE = "GHSL GHS-POP R2023A";
export const GHSL_BUILT_SOURCE = "GHSL GHS-BUILT-S R2023A";
const NATURAL_EARTH_SOURCE = "Derived from Natural Earth province geometry";
const COMBINED_RASTER_SOURCE = `${GHSL_POP_SOURCE} + ${GHSL_BUILT_SOURCE}`;
const FULL_RASTER_COMPLETENESS_SOURCE = `${GHSL_POP_SOURCE} + ${GHSL_BUILT_SOURCE}`;
const GDAL_MISSING_ERROR =
  "GDAL is required for fast GHSL raster aggregation. Install GDAL or set GHSL_RASTER_USE_SLOW_POLYGON_MODE=1.";

const DEFAULT_POP_RASTER_URL =
  "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/GHS_POP_E2025_GLOBE_R2023A_4326_30ss/V1-0/GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.zip";
const DEFAULT_BUILT_RASTER_URL =
  "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_BUILT_S_GLOBE_R2023A/GHS_BUILT_S_E2025_GLOBE_R2023A_4326_30ss/V1-0/GHS_BUILT_S_E2025_GLOBE_R2023A_4326_30ss_V1_0.zip";

const RASTER_CONFIG = {
  population: {
    key: "population",
    envPath: "GHSL_POP_RASTER_PATH",
    envUrl: "GHSL_POP_RASTER_URL",
    defaultUrl: DEFAULT_POP_RASTER_URL,
    source: GHSL_POP_SOURCE,
    cacheArchiveName: "GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.zip",
    cacheRasterName: "GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.tif",
  },
  built: {
    key: "built",
    envPath: "GHSL_BUILT_RASTER_PATH",
    envUrl: "GHSL_BUILT_RASTER_URL",
    defaultUrl: DEFAULT_BUILT_RASTER_URL,
    source: GHSL_BUILT_SOURCE,
    cacheArchiveName: "GHS_BUILT_S_E2025_GLOBE_R2023A_4326_30ss_V1_0.zip",
    cacheRasterName: "GHS_BUILT_S_E2025_GLOBE_R2023A_4326_30ss_V1_0.tif",
  },
};

const SLOW_INITIAL_PROGRESS_INTERVAL = 10;
const SLOW_REGULAR_PROGRESS_INTERVAL = 25;
const FAST_INITIAL_ROW_PROGRESS_INTERVAL = 100;
const FAST_ROW_PROGRESS_INTERVAL = 500;
const FAST_CHECKPOINT_ROW_INTERVAL = 500;
const FAST_BLOCK_ROWS = 256;

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function buildNullFact() {
  return { value: null, year: null, source: null };
}

function roundNumber(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatSeconds(durationMs) {
  if (!Number.isFinite(durationMs)) {
    return "n/a";
  }
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

function formatRate(units, elapsedMs, label) {
  if (units <= 0 || elapsedMs <= 0) {
    return "n/a";
  }
  return `${roundNumber(units / (elapsedMs / 1000), 2)} ${label}/sec`;
}

function clampPercentage(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonOptional(path) {
  if (!(await pathExists(path))) {
    return null;
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    console.warn(`Could not parse JSON file at ${path}; ignoring it.`, error);
    return null;
  }
}

async function removeIfExists(path) {
  if (await pathExists(path)) {
    await rm(path, { force: true });
  }
}

function getRasterCompletenessValue(hasPopulation, hasBuiltSurface) {
  return hasPopulation && hasBuiltSurface ? "full-ghsl-raster" : "partial-ghsl-raster";
}

function makeRasterCompletenessFact(hasPopulation, hasBuiltSurface) {
  return {
    value: getRasterCompletenessValue(hasPopulation, hasBuiltSurface),
    year: GHSL_YEAR,
    source: FULL_RASTER_COMPLETENESS_SOURCE,
  };
}

function buildEmptyProvinceRasterRecord(province, rasterProvinceId = null) {
  return {
    id: province.provinceId,
    name: province.provinceName,
    countryIso3: province.countryIso3,
    countryName: province.countryName,
    areaKm2: makeFact(province.areaKm2, GHSL_YEAR, NATURAL_EARTH_SOURCE, 3),
    rasterPopulationEstimate: buildNullFact(),
    rasterPopulationDensityPerKm2: buildNullFact(),
    rasterBuiltUpSurfaceKm2: buildNullFact(),
    rasterBuiltUpSurfaceSharePct: buildNullFact(),
    rasterPopulationPerBuiltUpKm2: buildNullFact(),
    rasterSettlementDataCompleteness: makeRasterCompletenessFact(false, false),
    ...(rasterProvinceId === null ? {} : { rasterProvinceId }),
  };
}

function stripRasterProvinceId(record) {
  const { rasterProvinceId, ...rest } = record;
  return rest;
}

function sortObjectByKey(input) {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

function inferResolutionToken(path) {
  const match = basename(path).match(/_(4326_\d+ss|54009_\d+)_V\d+_\d+/i);
  return match?.[1] ?? null;
}

function getInputKind(path) {
  const extension = extname(path).toLowerCase();
  if (extension === ".zip") {
    return "ZIP";
  }
  if (extension === ".tif" || extension === ".tiff") {
    return "TIF";
  }
  return extension || "unknown";
}

function parsePositiveInteger(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getDebugMaxProvinces() {
  return parsePositiveInteger(process.env.GHSL_RASTER_MAX_PROVINCES);
}

function getDebugMaxRows() {
  return parsePositiveInteger(process.env.GHSL_RASTER_MAX_ROWS);
}

function isResumeEnabled() {
  return process.env.GHSL_RASTER_RESUME === "1";
}

function useSlowPolygonMode() {
  return process.env.GHSL_RASTER_USE_SLOW_POLYGON_MODE === "1";
}

function logResolvedSource(config, inputPath, selectionKind) {
  console.info(`[GHSL Raster] Resolved ${config.key} source: ${inputPath}`);
  console.info(`[GHSL Raster] ${config.key} source type: ${getInputKind(inputPath)} (${selectionKind})`);
}

async function downloadFile(url, destinationPath, label) {
  await mkdir(dirname(destinationPath), { recursive: true });
  console.info(`[GHSL Raster] Downloading ${label}: ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${label} from ${url} (${response.status}).`);
  }
  await pipeline(response.body, createWriteStream(destinationPath));
  console.info(`[GHSL Raster] Downloaded ${label} to ${destinationPath}`);
  return destinationPath;
}

async function extractRasterFromArchive(archivePath, outputPath, config) {
  const [archiveStats, rasterExists] = await Promise.all([stat(archivePath), pathExists(outputPath)]);
  if (rasterExists) {
    const rasterStats = await stat(outputPath);
    if (rasterStats.mtimeMs >= archiveStats.mtimeMs) {
      console.info(`[GHSL Raster] Reusing extracted ${config.key} TIF: ${outputPath}`);
      return outputPath;
    }
  }

  console.info(`[GHSL Raster] Extracting ${config.key} ZIP: ${archivePath}`);
  const directory = await unzipper.Open.file(archivePath);
  const rasterEntry = directory.files.find((entry) => /\.tiff?$/i.test(entry.path));
  if (!rasterEntry) {
    throw new Error(`Archive ${archivePath} does not contain a .tif or .tiff raster.`);
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await pipeline(rasterEntry.stream(), createWriteStream(outputPath));
  console.info(`[GHSL Raster] Finished extracting ${config.key} TIF: ${outputPath}`);
  return outputPath;
}

async function resolveRasterSource(config) {
  await mkdir(GHSL_RASTER_RAW_DIR, { recursive: true });

  const envPath = typeof process.env[config.envPath] === "string" ? resolve(process.env[config.envPath].trim()) : null;
  if (envPath) {
    if (!(await pathExists(envPath))) {
      throw new Error(`Environment override ${config.envPath} points to a missing file: ${envPath}`);
    }
    logResolvedSource(config, envPath, "env-path");
    return normalizeResolvedRasterSource(config, envPath, "env-path", process.env[config.envPath]);
  }

  const cachedRasterPath = resolve(GHSL_RASTER_RAW_DIR, config.cacheRasterName);
  if (await pathExists(cachedRasterPath)) {
    logResolvedSource(config, cachedRasterPath, "cached-raster");
    return {
      selectionKind: "cached-raster",
      requested: null,
      selectedFilePath: cachedRasterPath,
      archivePath: null,
      extractedFromArchive: false,
      selectedUrl: null,
      resolution: inferResolutionToken(cachedRasterPath),
      inputKind: "TIF",
    };
  }

  const cachedArchivePath = resolve(GHSL_RASTER_RAW_DIR, config.cacheArchiveName);
  if (await pathExists(cachedArchivePath)) {
    logResolvedSource(config, cachedArchivePath, "cached-archive");
    return normalizeResolvedRasterSource(config, cachedArchivePath, "cached-archive", null);
  }

  const envUrl = typeof process.env[config.envUrl] === "string" ? process.env[config.envUrl].trim() : "";
  const selectedUrl = envUrl || config.defaultUrl;
  const selectionKind = envUrl ? "env-url" : "default-url";
  const targetPath = resolve(
    GHSL_RASTER_RAW_DIR,
    basename(new URL(selectedUrl).pathname) || (selectedUrl.toLowerCase().endsWith(".zip") ? config.cacheArchiveName : config.cacheRasterName),
  );
  logResolvedSource(config, targetPath, selectionKind);

  try {
    if (!(await pathExists(targetPath))) {
      await downloadFile(selectedUrl, targetPath, config.source);
    }
    const resolved = await normalizeResolvedRasterSource(config, targetPath, selectionKind, selectedUrl);
    return {
      ...resolved,
      selectedUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not resolve ${config.source}. Provide ${config.envPath} or ${config.envUrl}, or place the file in ${GHSL_RASTER_RAW_DIR}. ${message}`,
    );
  }
}

async function normalizeResolvedRasterSource(config, inputPath, selectionKind, requested) {
  const extension = extname(inputPath).toLowerCase();
  if (extension === ".tif" || extension === ".tiff") {
    return {
      selectionKind,
      requested,
      selectedFilePath: inputPath,
      archivePath: null,
      extractedFromArchive: false,
      selectedUrl: typeof requested === "string" && /^https?:/i.test(requested) ? requested : null,
      resolution: inferResolutionToken(inputPath),
      inputKind: "TIF",
    };
  }
  if (extension === ".zip") {
    const outputPath = resolve(GHSL_RASTER_RAW_DIR, config.cacheRasterName);
    const selectedFilePath = await extractRasterFromArchive(inputPath, outputPath, config);
    console.info(`[GHSL Raster] Extracted ${config.key} TIF path: ${selectedFilePath}`);
    return {
      selectionKind,
      requested,
      selectedFilePath,
      archivePath: inputPath,
      extractedFromArchive: true,
      selectedUrl: typeof requested === "string" && /^https?:/i.test(requested) ? requested : null,
      resolution: inferResolutionToken(selectedFilePath) ?? inferResolutionToken(inputPath),
      inputKind: "ZIP",
    };
  }
  throw new Error(`Unsupported raster source format for ${config.source}: ${inputPath}`);
}

function parseNoDataValue(rawValue) {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return rawValue;
  }
  if (typeof rawValue === "string" && rawValue.trim().length > 0) {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : rawValue.trim();
  }
  return null;
}

function logRasterMetadata(rasterContext) {
  console.info(`[GHSL Raster] Opened ${rasterContext.config.key} GeoTIFF: ${rasterContext.selectedSource.selectedFilePath}`);
  console.info(
    `[GHSL Raster] ${rasterContext.config.key} metadata: ${rasterContext.width}x${rasterContext.height}, CRS=${rasterContext.crs}, nodata=${String(rasterContext.noDataValue)}, resolution=[${roundNumber(rasterContext.resolutionX, 8)}, ${roundNumber(rasterContext.resolutionY, 8)}], bounds=[${rasterContext.boundingBox.map((value) => roundNumber(value, 6)).join(", ")}]`,
  );
}

async function openRasterContext(config) {
  const selectedSource = await resolveRasterSource(config);
  return openRasterContextFromResolvedSource(selectedSource, config);
}

async function openRasterContextFromResolvedSource(selectedSource, config) {
  console.info(`[GHSL Raster] Opening ${config.key} GeoTIFF: ${selectedSource.selectedFilePath}`);
  const tiff = await fromFile(selectedSource.selectedFilePath);
  const image = await tiff.getImage();
  const geoKeys = image.getGeoKeys();
  const origin = image.getOrigin();
  const resolution = image.getResolution();
  const boundingBox = image.getBoundingBox();
  const width = image.getWidth();
  const height = image.getHeight();
  const noDataValue = parseNoDataValue(image.fileDirectory?.getValue?.("GDAL_NODATA") ?? null);

  const geographicType = geoKeys?.GeographicTypeGeoKey ?? null;
  const projectedType = geoKeys?.ProjectedCSTypeGeoKey ?? null;
  const looksLikeWgs84Extent =
    Array.isArray(boundingBox) &&
    boundingBox.length === 4 &&
    boundingBox.every((value) => Number.isFinite(value)) &&
    Math.abs(boundingBox[0]) <= 180 &&
    Math.abs(boundingBox[2]) <= 180 &&
    Math.abs(boundingBox[1]) <= 90 &&
    Math.abs(boundingBox[3]) <= 90;

  if (projectedType && projectedType !== 4326) {
    throw new Error(
      `${config.source} raster is not WGS84. Atlas Core currently expects an EPSG:4326-compatible raster for direct province matching. Selected file: ${selectedSource.selectedFilePath}`,
    );
  }
  if (geographicType && geographicType !== 4326) {
    throw new Error(
      `${config.source} raster uses GeographicTypeGeoKey=${geographicType}, not EPSG:4326. Provide a WGS84 raster via ${config.envPath} or ${config.envUrl}.`,
    );
  }
  if (!projectedType && !geographicType && !looksLikeWgs84Extent) {
    throw new Error(
      `${config.source} raster does not advertise EPSG:4326 and its extent does not look like WGS84. Reprojection is not implemented; provide a WGS84 raster instead.`,
    );
  }
  if (!Array.isArray(origin) || !Array.isArray(resolution) || origin.length < 2 || resolution.length < 2) {
    throw new Error(`Could not read georeferencing metadata from ${selectedSource.selectedFilePath}.`);
  }
  if (!Number.isFinite(resolution[0]) || !Number.isFinite(resolution[1]) || resolution[0] === 0 || resolution[1] === 0) {
    throw new Error(`Invalid raster resolution in ${selectedSource.selectedFilePath}.`);
  }

  const rasterContext = {
    config,
    tiff,
    image,
    originX: origin[0],
    originY: origin[1],
    resolutionX: resolution[0],
    resolutionY: resolution[1],
    width,
    height,
    boundingBox,
    noDataValue,
    crs: "EPSG:4326",
    selectedSource,
  };
  logRasterMetadata(rasterContext);
  return rasterContext;
}

async function openRasterContextFromPath(filePath, label) {
  if (!(await pathExists(filePath))) {
    throw new Error(`Province-id mask was not created: ${filePath}`);
  }
  const resolvedPath = resolve(filePath);
  return openRasterContextFromResolvedSource(
    {
      selectionKind: "generated",
      requested: null,
      selectedFilePath: resolvedPath,
      archivePath: null,
      extractedFromArchive: false,
      selectedUrl: null,
      resolution: inferResolutionToken(resolvedPath),
      inputKind: "TIF",
    },
    {
      key: label,
      source: label,
    },
  );
}

function normalizeRing(ring) {
  if (!Array.isArray(ring)) {
    return [];
  }
  const normalized = ring
    .filter((coordinate) => Array.isArray(coordinate) && coordinate.length >= 2)
    .map((coordinate) => [Number(coordinate[0]), Number(coordinate[1])])
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));

  if (normalized.length >= 2) {
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      normalized.pop();
    }
  }

  return normalized;
}

function buildRingBbox(ring) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) {
      minLon = lon;
    }
    if (lon > maxLon) {
      maxLon = lon;
    }
    if (lat < minLat) {
      minLat = lat;
    }
    if (lat > maxLat) {
      maxLat = lat;
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

function pointWithinBbox(lon, lat, bbox) {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function prepareProvinceGeometry(province) {
  const geometry = province?.feature?.geometry;
  if (!isRecord(geometry)) {
    return { supported: false, reason: "missing-geometry" };
  }
  if (province.bbox[2] - province.bbox[0] > 180) {
    return { supported: false, reason: "antimeridian-bbox" };
  }

  const polygons = [];
  const rawPolygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : null;

  if (!Array.isArray(rawPolygons)) {
    return { supported: false, reason: `unsupported-geometry-${String(geometry.type ?? "unknown")}` };
  }

  for (const rawPolygon of rawPolygons) {
    if (!Array.isArray(rawPolygon) || rawPolygon.length === 0) {
      continue;
    }
    const rings = rawPolygon.map((ring) => normalizeRing(ring)).filter((ring) => ring.length >= 3);
    if (rings.length === 0) {
      continue;
    }
    polygons.push({
      bbox: buildRingBbox(rings[0]),
      outerRing: rings[0],
      holes: rings.slice(1),
    });
  }

  if (polygons.length === 0) {
    return { supported: false, reason: "empty-polygon" };
  }

  return {
    supported: true,
    bbox: province.bbox,
    polygons,
  };
}

function pointInPreparedGeometry(lon, lat, geometry) {
  if (!geometry?.supported || !pointWithinBbox(lon, lat, geometry.bbox)) {
    return false;
  }

  for (const polygon of geometry.polygons) {
    if (!pointWithinBbox(lon, lat, polygon.bbox)) {
      continue;
    }
    if (!pointInRing(lon, lat, polygon.outerRing)) {
      continue;
    }
    let isInsideHole = false;
    for (const ring of polygon.holes) {
      if (pointInRing(lon, lat, ring)) {
        isInsideHole = true;
        break;
      }
    }
    if (!isInsideHole) {
      return true;
    }
  }

  return false;
}

function getWindowForBbox(boundingBox, raster) {
  const [minLon, minLat, maxLon, maxLat] = boundingBox;
  const rasterMinLon = raster.boundingBox[0];
  const rasterMinLat = raster.boundingBox[1];
  const rasterMaxLon = raster.boundingBox[2];
  const rasterMaxLat = raster.boundingBox[3];

  if (maxLon < rasterMinLon || minLon > rasterMaxLon || maxLat < rasterMinLat || minLat > rasterMaxLat) {
    return null;
  }

  const clippedMinLon = Math.max(minLon, rasterMinLon);
  const clippedMinLat = Math.max(minLat, rasterMinLat);
  const clippedMaxLon = Math.min(maxLon, rasterMaxLon);
  const clippedMaxLat = Math.min(maxLat, rasterMaxLat);

  const left = Math.max(0, Math.floor((clippedMinLon - raster.originX) / raster.resolutionX));
  const right = Math.min(raster.width, Math.ceil((clippedMaxLon - raster.originX) / raster.resolutionX));

  let top;
  let bottom;
  if (raster.resolutionY < 0) {
    top = Math.max(0, Math.floor((clippedMaxLat - raster.originY) / raster.resolutionY));
    bottom = Math.min(raster.height, Math.ceil((clippedMinLat - raster.originY) / raster.resolutionY));
  } else {
    top = Math.max(0, Math.floor((clippedMinLat - raster.originY) / raster.resolutionY));
    bottom = Math.min(raster.height, Math.ceil((clippedMaxLat - raster.originY) / raster.resolutionY));
  }

  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
    return null;
  }
  if (right <= left || bottom <= top) {
    return null;
  }

  return [left, top, right, bottom];
}

function isNoDataValue(value, noDataValue) {
  if (noDataValue === null || noDataValue === undefined) {
    return false;
  }
  if (typeof noDataValue === "number") {
    return value === noDataValue;
  }
  if (typeof noDataValue === "string") {
    return String(value) === noDataValue;
  }
  return false;
}

async function aggregateProvinceAgainstRaster(preparedProvince, rasterContext) {
  if (!preparedProvince.preparedGeometry.supported) {
    return {
      sum: null,
      matchedCells: 0,
      validCellsRead: 0,
      cellsRead: 0,
      reason: preparedProvince.preparedGeometry.reason,
    };
  }

  const window = getWindowForBbox(preparedProvince.bbox, rasterContext);
  if (!window) {
    return {
      sum: null,
      matchedCells: 0,
      validCellsRead: 0,
      cellsRead: 0,
      reason: "outside-raster-extent",
    };
  }

  const rasterValues = await rasterContext.image.readRasters({
    window,
    samples: [0],
    interleave: true,
  });
  const width = rasterValues.width;
  const height = rasterValues.height;
  const [left, top] = window;

  let sum = 0;
  let matchedCells = 0;
  let validCellsRead = 0;

  for (let row = 0; row < height; row += 1) {
    const pixelY = top + row;
    const lat = rasterContext.originY + (pixelY + 0.5) * rasterContext.resolutionY;
    if (lat < preparedProvince.bbox[1] || lat > preparedProvince.bbox[3]) {
      continue;
    }

    for (let column = 0; column < width; column += 1) {
      const value = rasterValues[row * width + column];
      if (!Number.isFinite(value) || isNoDataValue(value, rasterContext.noDataValue)) {
        continue;
      }
      validCellsRead += 1;
      const pixelX = left + column;
      const lon = rasterContext.originX + (pixelX + 0.5) * rasterContext.resolutionX;
      if (!pointInPreparedGeometry(lon, lat, preparedProvince.preparedGeometry)) {
        continue;
      }
      matchedCells += 1;
      sum += value;
    }
  }

  return {
    sum,
    matchedCells,
    validCellsRead,
    cellsRead: width * height,
    reason: matchedCells === 0 ? "no-cell-centres-inside-province" : null,
  };
}

function buildCoverageCounter(recordCount, records, fieldName) {
  const withValue = records.filter((record) => record[fieldName]?.value !== null).length;
  return {
    count: withValue,
    pct: roundNumber((withValue / recordCount) * 100, 2) ?? 0,
  };
}

function buildRasterMetadataSummary(rasterContext) {
  return {
    selectedFilePath: rasterContext.selectedSource.selectedFilePath,
    archivePath: rasterContext.selectedSource.archivePath,
    selectedUrl: rasterContext.selectedSource.selectedUrl,
    selectionKind: rasterContext.selectedSource.selectionKind,
    sourceType: rasterContext.selectedSource.inputKind,
    resolution: rasterContext.selectedSource.resolution,
    rasterCrs: rasterContext.crs,
    rasterNodataValue: rasterContext.noDataValue,
    width: rasterContext.width,
    height: rasterContext.height,
    boundingBox: rasterContext.boundingBox.map((value) => roundNumber(value, 6)),
    pixelSize: {
      x: roundNumber(rasterContext.resolutionX, 8),
      y: roundNumber(rasterContext.resolutionY, 8),
    },
  };
}

function buildPreparedProvince(province) {
  return {
    ...province,
    bbox: province.bbox,
    preparedGeometry: prepareProvinceGeometry(province),
  };
}

function buildProvinceRecordsFromAccumulators(preparedProvinces, populationSumsByRasterId, builtSumsByRasterId, includeRasterIds = false) {
  const provinceRecords = {};
  for (const province of preparedProvinces) {
    const record = buildEmptyProvinceRasterRecord(province, includeRasterIds ? province.rasterProvinceId : null);
    const rasterPopulation = populationSumsByRasterId[province.rasterProvinceId] ?? 0;
    const builtUpSurfaceKm2 = (builtSumsByRasterId[province.rasterProvinceId] ?? 0) / 1_000_000;

    if (rasterPopulation > 0) {
      record.rasterPopulationEstimate = makeFact(roundNumber(rasterPopulation, 0), GHSL_YEAR, GHSL_POP_SOURCE, 0);
      record.rasterPopulationDensityPerKm2 =
        province.areaKm2 > 0
          ? makeFact(
              rasterPopulation / province.areaKm2,
              GHSL_YEAR,
              `${GHSL_POP_SOURCE} + Natural Earth province geometry`,
              2,
            )
          : buildNullFact();
    }

    if (builtUpSurfaceKm2 > 0) {
      record.rasterBuiltUpSurfaceKm2 = makeFact(builtUpSurfaceKm2, GHSL_YEAR, GHSL_BUILT_SOURCE, 3);
      record.rasterBuiltUpSurfaceSharePct =
        province.areaKm2 > 0
          ? makeFact(
              (builtUpSurfaceKm2 / province.areaKm2) * 100,
              GHSL_YEAR,
              `${GHSL_BUILT_SOURCE} + Natural Earth province geometry`,
              3,
            )
          : buildNullFact();
    }

    if (record.rasterPopulationEstimate.value !== null && record.rasterBuiltUpSurfaceKm2.value !== null) {
      record.rasterPopulationPerBuiltUpKm2 =
        record.rasterBuiltUpSurfaceKm2.value > 0
          ? makeFact(
              record.rasterPopulationEstimate.value / record.rasterBuiltUpSurfaceKm2.value,
              GHSL_YEAR,
              COMBINED_RASTER_SOURCE,
              2,
            )
          : buildNullFact();
    }

    record.rasterSettlementDataCompleteness = makeRasterCompletenessFact(
      record.rasterPopulationEstimate.value !== null,
      record.rasterBuiltUpSurfaceKm2.value !== null,
    );
    provinceRecords[province.provinceId] = record;
  }
  return provinceRecords;
}

function buildCoverage({
  mode,
  populationRaster,
  builtRaster,
  provinceRecords,
  processedProvinceCount,
  totalProvinceCount,
  skippedEntries,
  warnings,
  totalRasterPopulation,
  totalBuiltUpSurfaceKm2,
  startedAt,
  finishedAt,
  debugMaxProvinces,
  debugMaxRows,
  resumeEnabled,
  resumedFromPartial,
  processedRows,
  rowLimit,
  maskPath,
  populationMaskPath,
  builtMaskPath,
  provinceIndexGeoJsonPath,
  comparisonSummary,
}) {
  const provinceValues = Object.values(provinceRecords).map((record) => stripRasterProvinceId(record));
  const debugMode = debugMaxProvinces !== null || debugMaxRows !== null;

  return {
    source: COMBINED_RASTER_SOURCE,
    generatedAt: finishedAt.toISOString(),
    aggregationMode: mode,
    selectedGhslEpoch: GHSL_YEAR,
    selectedGhslResolution: {
      population: populationRaster.selectedSource.resolution,
      builtSurface: builtRaster.selectedSource.resolution,
    },
    provinces: {
      total: totalProvinceCount,
      processed: processedProvinceCount,
      matched: provinceValues.filter(
        (record) => record.rasterPopulationEstimate.value !== null || record.rasterBuiltUpSurfaceKm2.value !== null,
      ).length,
      skipped: skippedEntries.length,
    },
    rows: {
      processed: processedRows,
      total: rowLimit,
      coveragePct: rowLimit > 0 ? roundNumber((processedRows / rowLimit) * 100, 2) : 0,
    },
    fieldCoverage: {
      rasterPopulationEstimate: buildCoverageCounter(provinceValues.length, provinceValues, "rasterPopulationEstimate"),
      rasterPopulationDensityPerKm2: buildCoverageCounter(provinceValues.length, provinceValues, "rasterPopulationDensityPerKm2"),
      rasterBuiltUpSurfaceKm2: buildCoverageCounter(provinceValues.length, provinceValues, "rasterBuiltUpSurfaceKm2"),
      rasterBuiltUpSurfaceSharePct: buildCoverageCounter(provinceValues.length, provinceValues, "rasterBuiltUpSurfaceSharePct"),
      rasterPopulationPerBuiltUpKm2: buildCoverageCounter(provinceValues.length, provinceValues, "rasterPopulationPerBuiltUpKm2"),
    },
    skippedProvinces: skippedEntries,
    selectedSourceFiles: {
      population: buildRasterMetadataSummary(populationRaster),
      builtSurface: buildRasterMetadataSummary(builtRaster),
      provinceIndexGeoJsonPath,
      provinceMaskPath: maskPath ?? null,
      populationMaskPath: populationMaskPath ?? null,
      builtMaskPath: builtMaskPath ?? null,
    },
    validation: {
      totalWorldRasterPopulationEstimate: roundNumber(totalRasterPopulation, 0),
      totalWorldBuiltUpSurfaceKm2: roundNumber(totalBuiltUpSurfaceKm2, 3),
      comparisonSummary: comparisonSummary ?? null,
    },
    runtimeSummary: {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSeconds: roundNumber((finishedAt.getTime() - startedAt.getTime()) / 1000, 2),
    },
    debug: {
      enabled: debugMode,
      maxProvinces: debugMaxProvinces,
      maxRows: debugMaxRows,
      resumeEnabled,
      resumedFromPartial,
    },
    notes: [
      mode === "fast-mask"
        ? "Province aggregation uses a GDAL-rasterized province-id mask aligned to the GHSL population grid."
        : "Province aggregation uses province bounding boxes plus cell-centre-in-polygon inclusion.",
      ...(mode === "fast-mask"
        ? ["Aggregation scans the mask, population raster, and built-up raster block-by-block without polygon tests in the hot path."]
        : ["No area-weighted raster-vector intersection is performed in slow polygon mode."]),
      "Non-WGS84 rasters currently fail fast rather than silently reprojecting.",
      ...(debugMode ? ["Debug mode limited province count and/or scanned rows; coverage is intentionally partial."] : []),
    ],
    warnings,
  };
}

async function writeProvinceProgressArtifacts({
  provinceRecords,
  progressPayload,
}) {
  const partialRecords = sortObjectByKey(
    Object.fromEntries(Object.entries(provinceRecords).map(([provinceId, record]) => [provinceId, stripRasterProvinceId(record)])),
  );
  await writeJson(PROVINCE_RASTER_SETTLEMENT_STATS_PARTIAL_PATH, partialRecords);
  await writeJson(PROVINCE_RASTER_SETTLEMENT_STATS_PROGRESS_PATH, progressPayload);
}

function shouldLogSlowProvinceProgress(processedCount) {
  if (processedCount <= 0) {
    return false;
  }
  if (processedCount <= 50) {
    return processedCount % SLOW_INITIAL_PROGRESS_INTERVAL === 0;
  }
  return processedCount % SLOW_REGULAR_PROGRESS_INTERVAL === 0;
}

function logSlowProvinceProgress({ processedCount, totalCount, province, startedAtMs }) {
  const elapsedMs = Date.now() - startedAtMs;
  const remainingCount = Math.max(0, totalCount - processedCount);
  const unitsPerSecond = processedCount > 0 && elapsedMs > 0 ? processedCount / (elapsedMs / 1000) : 0;
  const estimatedRemainingMs = unitsPerSecond > 0 ? (remainingCount / unitsPerSecond) * 1000 : Number.NaN;
  console.info(
    `[GHSL Raster] Progress ${processedCount}/${totalCount} | ${province.provinceId} | ${province.provinceName} | ${province.countryIso3 ?? "UNK"} | elapsed=${formatSeconds(elapsedMs)} | avg=${formatRate(processedCount, elapsedMs, "provinces")} | eta=${formatSeconds(estimatedRemainingMs)}`,
  );
}

function shouldLogFastRowProgress(processedRows) {
  if (processedRows <= 0) {
    return false;
  }
  if (processedRows <= 1000) {
    return processedRows % FAST_INITIAL_ROW_PROGRESS_INTERVAL === 0;
  }
  return processedRows % FAST_ROW_PROGRESS_INTERVAL === 0;
}

function logFastRowProgress({ processedRows, totalRows, startedAtMs, blockEndRow }) {
  const elapsedMs = Date.now() - startedAtMs;
  const remainingRows = Math.max(0, totalRows - processedRows);
  const unitsPerSecond = processedRows > 0 && elapsedMs > 0 ? processedRows / (elapsedMs / 1000) : 0;
  const estimatedRemainingMs = unitsPerSecond > 0 ? (remainingRows / unitsPerSecond) * 1000 : Number.NaN;
  console.info(
    `[GHSL Raster] Rows ${processedRows}/${totalRows} (${roundNumber((processedRows / totalRows) * 100, 2)}%) | lastRow=${blockEndRow} | elapsed=${formatSeconds(elapsedMs)} | avg=${formatRate(processedRows, elapsedMs, "rows")} | eta=${formatSeconds(estimatedRemainingMs)}`,
  );
}

export async function cleanupProvinceRasterProgressArtifacts() {
  await Promise.all([
    removeIfExists(PROVINCE_RASTER_SETTLEMENT_STATS_PARTIAL_PATH),
    removeIfExists(PROVINCE_RASTER_SETTLEMENT_STATS_PROGRESS_PATH),
  ]);
}

function buildProvinceIndexArtifacts(preparedProvinces) {
  const provinceByRasterId = new Map();
  const features = preparedProvinces.map((province, index) => {
    const rasterProvinceId = index + 1;
    const enrichedProvince = { ...province, rasterProvinceId };
    provinceByRasterId.set(rasterProvinceId, enrichedProvince);
    return {
      ...province.feature,
      properties: {
        ...(isRecord(province.feature.properties) ? province.feature.properties : {}),
        rasterProvinceId,
        provinceId: province.provinceId,
        provinceName: province.provinceName,
        countryIso3: province.countryIso3,
        countryName: province.countryName,
        areaKm2: roundNumber(province.areaKm2, 3),
      },
    };
  });

  return {
    preparedProvinces: Array.from(provinceByRasterId.values()),
    provinceByRasterId,
    geoJson: {
      type: "FeatureCollection",
      name: "province_index_4326_30ss",
      features,
    },
  };
}

async function ensureProvinceIndexGeoJson(indexGeoJson) {
  await writeJson(PROVINCE_RASTER_INDEX_GEOJSON_PATH, indexGeoJson);
  console.info(`[GHSL Raster] Wrote province index GeoJSON: ${PROVINCE_RASTER_INDEX_GEOJSON_PATH}`);
  return PROVINCE_RASTER_INDEX_GEOJSON_PATH;
}

async function ensureGdalAvailable() {
  try {
    const { stdout, stderr } = await execFileAsync("gdal_rasterize", ["--version"], { windowsHide: true });
    const versionText = `${stdout ?? ""}${stderr ?? ""}`.trim();
    console.info(`[GHSL Raster] GDAL detected: ${versionText || "gdal_rasterize --version"}`);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(GDAL_MISSING_ERROR);
    }
    throw error;
  }
}

function formatGdalNumber(value) {
  return String(roundNumber(value, 12) ?? value);
}

async function ensureProvinceMaskRaster({ targetRaster, outputPath, forceRebuild = false }) {
  await ensureGdalAvailable();
  const shouldReuse = !forceRebuild && (await pathExists(outputPath));
  if (shouldReuse) {
    console.info(`[GHSL Raster] Reusing province mask: ${outputPath}`);
    return outputPath;
  }

  const args = [
    "-a",
    "rasterProvinceId",
    "-ot",
    "UInt32",
    "-init",
    "0",
    "-a_nodata",
    "0",
    "-of",
    "GTiff",
    "-te",
    formatGdalNumber(targetRaster.boundingBox[0]),
    formatGdalNumber(targetRaster.boundingBox[1]),
    formatGdalNumber(targetRaster.boundingBox[2]),
    formatGdalNumber(targetRaster.boundingBox[3]),
    "-ts",
    String(targetRaster.width),
    String(targetRaster.height),
    PROVINCE_RASTER_INDEX_GEOJSON_PATH,
    outputPath,
  ];

  console.info(`[GHSL Raster] Rasterizing province-id mask with GDAL: ${outputPath}`);
  await execFileAsync("gdal_rasterize", args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  console.info(`[GHSL Raster] Finished province-id mask: ${outputPath}`);
  return outputPath;
}

function seedAccumulatorsFromPartial(preparedProvinces, partialRecords) {
  const populationSumsByRasterId = new Float64Array(preparedProvinces.length + 1);
  const builtSumsByRasterId = new Float64Array(preparedProvinces.length + 1);

  for (const province of preparedProvinces) {
    const partialRecord = partialRecords?.[province.provinceId];
    if (!isRecord(partialRecord)) {
      continue;
    }
    const populationValue = partialRecord?.rasterPopulationEstimate?.value;
    const builtValueKm2 = partialRecord?.rasterBuiltUpSurfaceKm2?.value;
    if (typeof populationValue === "number" && Number.isFinite(populationValue)) {
      populationSumsByRasterId[province.rasterProvinceId] = populationValue;
    }
    if (typeof builtValueKm2 === "number" && Number.isFinite(builtValueKm2)) {
      builtSumsByRasterId[province.rasterProvinceId] = builtValueKm2 * 1_000_000;
    }
  }

  return { populationSumsByRasterId, builtSumsByRasterId };
}

function sumTypedArray(values) {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

function validateMaskCompatibility(maskRaster, targetRaster, label) {
  if (maskRaster.width !== targetRaster.width || maskRaster.height !== targetRaster.height) {
    throw new Error(`${label} mask dimensions do not match its target raster.`);
  }
  const bboxMatches = maskRaster.boundingBox.every(
    (value, index) => Math.abs(value - targetRaster.boundingBox[index]) < 1e-9,
  );
  const resolutionMatches =
    Math.abs(maskRaster.resolutionX - targetRaster.resolutionX) < 1e-12 &&
    Math.abs(maskRaster.resolutionY - targetRaster.resolutionY) < 1e-12;
  if (!bboxMatches || !resolutionMatches) {
    throw new Error(`${label} mask grid does not match its target raster.`);
  }
}

async function compareFastAndSlowSubset({ preparedProvinces, populationRaster, builtRaster, fastProvinceRecords }) {
  const comparisonCount = Math.min(50, preparedProvinces.length);
  if (comparisonCount === 0) {
    return null;
  }

  console.info(`[GHSL Raster] Validating mask aggregation against slow polygon mode for ${comparisonCount} provinces.`);
  const subset = preparedProvinces.slice(0, comparisonCount).map((province) => ({
    ...province,
    preparedGeometry: prepareProvinceGeometry(province),
  }));
  const slowProvinceRecords = {};

  for (const province of subset) {
    const record = buildEmptyProvinceRasterRecord(province);
    const [populationAggregate, builtAggregate] = await Promise.all([
      aggregateProvinceAgainstRaster(province, populationRaster),
      aggregateProvinceAgainstRaster(province, builtRaster),
    ]);
    const rasterPopulation = populationAggregate.sum;
    const builtUpSurfaceKm2 = builtAggregate.sum === null ? null : builtAggregate.sum / 1_000_000;

    if (Number.isFinite(rasterPopulation) && rasterPopulation > 0) {
      record.rasterPopulationEstimate = makeFact(roundNumber(rasterPopulation, 0), GHSL_YEAR, GHSL_POP_SOURCE, 0);
      record.rasterPopulationDensityPerKm2 =
        province.areaKm2 > 0
          ? makeFact(
              rasterPopulation / province.areaKm2,
              GHSL_YEAR,
              `${GHSL_POP_SOURCE} + Natural Earth province geometry`,
              2,
            )
          : buildNullFact();
    }

    if (Number.isFinite(builtUpSurfaceKm2) && builtUpSurfaceKm2 > 0) {
      record.rasterBuiltUpSurfaceKm2 = makeFact(builtUpSurfaceKm2, GHSL_YEAR, GHSL_BUILT_SOURCE, 3);
      record.rasterBuiltUpSurfaceSharePct =
        province.areaKm2 > 0
          ? makeFact(
              (builtUpSurfaceKm2 / province.areaKm2) * 100,
              GHSL_YEAR,
              `${GHSL_BUILT_SOURCE} + Natural Earth province geometry`,
              3,
            )
          : buildNullFact();
    }

    if (record.rasterPopulationEstimate.value !== null && record.rasterBuiltUpSurfaceKm2.value !== null) {
      record.rasterPopulationPerBuiltUpKm2 =
        record.rasterBuiltUpSurfaceKm2.value > 0
          ? makeFact(
              record.rasterPopulationEstimate.value / record.rasterBuiltUpSurfaceKm2.value,
              GHSL_YEAR,
              COMBINED_RASTER_SOURCE,
              2,
            )
          : buildNullFact();
    }

    record.rasterSettlementDataCompleteness = makeRasterCompletenessFact(
      record.rasterPopulationEstimate.value !== null,
      record.rasterBuiltUpSurfaceKm2.value !== null,
    );
    slowProvinceRecords[province.provinceId] = record;
  }

  let maxPopulationDifference = 0;
  let maxBuiltDifferenceKm2 = 0;
  let fastPopulationTotal = 0;
  let slowPopulationTotal = 0;
  let fastBuiltTotal = 0;
  let slowBuiltTotal = 0;

  for (const province of subset) {
    const fastRecord = fastProvinceRecords[province.provinceId];
    const slowRecord = slowProvinceRecords[province.provinceId];
    const fastPopulation = fastRecord?.rasterPopulationEstimate?.value ?? 0;
    const slowPopulation = slowRecord?.rasterPopulationEstimate?.value ?? 0;
    const fastBuilt = fastRecord?.rasterBuiltUpSurfaceKm2?.value ?? 0;
    const slowBuilt = slowRecord?.rasterBuiltUpSurfaceKm2?.value ?? 0;

    fastPopulationTotal += fastPopulation;
    slowPopulationTotal += slowPopulation;
    fastBuiltTotal += fastBuilt;
    slowBuiltTotal += slowBuilt;
    maxPopulationDifference = Math.max(maxPopulationDifference, Math.abs(fastPopulation - slowPopulation));
    maxBuiltDifferenceKm2 = Math.max(maxBuiltDifferenceKm2, Math.abs(fastBuilt - slowBuilt));
  }

  const summary = {
    comparedProvinceCount: comparisonCount,
    fastPopulationTotal: roundNumber(fastPopulationTotal, 0),
    slowPopulationTotal: roundNumber(slowPopulationTotal, 0),
    fastBuiltSurfaceKm2Total: roundNumber(fastBuiltTotal, 3),
    slowBuiltSurfaceKm2Total: roundNumber(slowBuiltTotal, 3),
    maxPopulationDifference,
    maxBuiltDifferenceKm2: roundNumber(maxBuiltDifferenceKm2, 3),
  };
  console.info(
    `[GHSL Raster] Slow comparison totals: fastPopulation=${summary.fastPopulationTotal}, slowPopulation=${summary.slowPopulationTotal}, fastBuiltKm2=${summary.fastBuiltSurfaceKm2Total}, slowBuiltKm2=${summary.slowBuiltSurfaceKm2Total}, maxPopulationDiff=${summary.maxPopulationDifference}, maxBuiltKm2Diff=${summary.maxBuiltDifferenceKm2}`,
  );
  return summary;
}

async function buildFastMaskProvinceRasterSettlementDataset({
  preparedProvinces,
  populationRaster,
  builtRaster,
  startedAt,
  startedAtMs,
  debugMaxProvinces,
  debugMaxRows,
  resumeEnabled,
}) {
  const indexArtifacts = buildProvinceIndexArtifacts(preparedProvinces);
  const rasterizedProvinces = indexArtifacts.preparedProvinces;
  await ensureProvinceIndexGeoJson(indexArtifacts.geoJson);
  const populationMaskPath = await ensureProvinceMaskRaster({
    targetRaster: populationRaster,
    outputPath: PROVINCE_RASTER_POPULATION_MASK_PATH,
    forceRebuild: true,
  });
  const builtMaskPath = await ensureProvinceMaskRaster({
    targetRaster: builtRaster,
    outputPath: PROVINCE_RASTER_BUILT_MASK_PATH,
    forceRebuild: true,
  });

  const populationMaskRaster = await openRasterContextFromPath(populationMaskPath, "province-mask-population");
  const builtMaskRaster = await openRasterContextFromPath(builtMaskPath, "province-mask-built");

  validateMaskCompatibility(populationMaskRaster, populationRaster, "Population");
  validateMaskCompatibility(builtMaskRaster, builtRaster, "Built");

  const rowLimit = debugMaxRows === null ? populationRaster.height : Math.min(populationRaster.height, debugMaxRows);
  if (debugMaxRows !== null) {
    console.info(`[GHSL Raster] Debug mode enabled via GHSL_RASTER_MAX_ROWS=${debugMaxRows}`);
  }

  const resumedPartial = resumeEnabled ? await readJsonOptional(PROVINCE_RASTER_SETTLEMENT_STATS_PARTIAL_PATH) : null;
  const resumedProgress = resumeEnabled ? await readJsonOptional(PROVINCE_RASTER_SETTLEMENT_STATS_PROGRESS_PATH) : null;
  const resumedFromPartial = Boolean(resumeEnabled && isRecord(resumedPartial) && isRecord(resumedProgress));
  const resumeRow = resumedFromPartial && typeof resumedProgress.lastProcessedRow === "number"
    ? Math.min(rowLimit, Math.max(0, resumedProgress.lastProcessedRow + 1))
    : 0;

  if (resumedFromPartial) {
    console.info(`[GHSL Raster] Resuming fast mask scan from row ${resumeRow}.`);
  }

  const seeded = seedAccumulatorsFromPartial(rasterizedProvinces, resumedPartial ?? {});
  const populationSumsByRasterId = seeded.populationSumsByRasterId;
  const builtSumsByRasterId = seeded.builtSumsByRasterId;
  let processedRows = resumeRow;
  let lastProcessedRow = resumeRow > 0 ? resumeRow - 1 : null;
  const builtRowLimit = debugMaxRows === null ? builtRaster.height : Math.min(builtRaster.height, debugMaxRows);

  const initialRecords = buildProvinceRecordsFromAccumulators(
    rasterizedProvinces,
    populationSumsByRasterId,
    builtSumsByRasterId,
    true,
  );
  await writeProvinceProgressArtifacts({
    provinceRecords: initialRecords,
    progressPayload: {
      mode: "fast-mask",
      processedRows,
      remainingRows: Math.max(0, rowLimit - processedRows),
      percentProcessed: rowLimit > 0 ? roundNumber((processedRows / rowLimit) * 100, 2) : 0,
      lastProcessedRow,
      elapsedSeconds: roundNumber((Date.now() - startedAtMs) / 1000, 2),
      timestamp: new Date().toISOString(),
      debug: {
        enabled: debugMaxProvinces !== null || debugMaxRows !== null,
        maxProvinces: debugMaxProvinces,
        maxRows: debugMaxRows,
        resumeEnabled,
        resumedFromPartial,
      },
    },
  });

  try {
    for (let rowStart = resumeRow; rowStart < rowLimit; rowStart += FAST_BLOCK_ROWS) {
      const rowEndExclusive = Math.min(rowLimit, rowStart + FAST_BLOCK_ROWS);
      const window = [0, rowStart, populationRaster.width, rowEndExclusive];
      const [maskValues, populationValues] = await Promise.all([
        populationMaskRaster.image.readRasters({ window, samples: [0], interleave: true }),
        populationRaster.image.readRasters({ window, samples: [0], interleave: true }),
      ]);

      const cellCount = maskValues.width * maskValues.height;
      for (let index = 0; index < cellCount; index += 1) {
        const rasterProvinceId = maskValues[index];
        if (!Number.isFinite(rasterProvinceId) || rasterProvinceId <= 0) {
          continue;
        }

        const populationValue = populationValues[index];
        if (Number.isFinite(populationValue) && !isNoDataValue(populationValue, populationRaster.noDataValue)) {
          populationSumsByRasterId[rasterProvinceId] += populationValue;
        }
      }

      processedRows = rowEndExclusive;
      lastProcessedRow = rowEndExclusive - 1;
      if (shouldLogFastRowProgress(processedRows)) {
        logFastRowProgress({
          processedRows,
          totalRows: rowLimit,
          startedAtMs,
          blockEndRow: lastProcessedRow,
        });
      }
      if (processedRows % FAST_CHECKPOINT_ROW_INTERVAL === 0 || processedRows === rowLimit) {
        const checkpointRecords = buildProvinceRecordsFromAccumulators(
          rasterizedProvinces,
          populationSumsByRasterId,
          builtSumsByRasterId,
          true,
        );
        await writeProvinceProgressArtifacts({
          provinceRecords: checkpointRecords,
          progressPayload: {
            mode: "fast-mask",
            processedRows,
            remainingRows: Math.max(0, rowLimit - processedRows),
            percentProcessed: rowLimit > 0 ? roundNumber((processedRows / rowLimit) * 100, 2) : 0,
            lastProcessedRow,
            elapsedSeconds: roundNumber((Date.now() - startedAtMs) / 1000, 2),
            timestamp: new Date().toISOString(),
            debug: {
              enabled: debugMaxProvinces !== null || debugMaxRows !== null,
              maxProvinces: debugMaxProvinces,
              maxRows: debugMaxRows,
              resumeEnabled,
              resumedFromPartial,
            },
          },
        });
      }
    }

    for (let rowStart = resumeRow; rowStart < builtRowLimit; rowStart += FAST_BLOCK_ROWS) {
      const rowEndExclusive = Math.min(builtRowLimit, rowStart + FAST_BLOCK_ROWS);
      const window = [0, rowStart, builtRaster.width, rowEndExclusive];
      const [maskValues, builtValues] = await Promise.all([
        builtMaskRaster.image.readRasters({ window, samples: [0], interleave: true }),
        builtRaster.image.readRasters({ window, samples: [0], interleave: true }),
      ]);

      const cellCount = maskValues.width * maskValues.height;
      for (let index = 0; index < cellCount; index += 1) {
        const rasterProvinceId = maskValues[index];
        if (!Number.isFinite(rasterProvinceId) || rasterProvinceId <= 0) {
          continue;
        }
        const builtValue = builtValues[index];
        if (Number.isFinite(builtValue) && !isNoDataValue(builtValue, builtRaster.noDataValue)) {
          builtSumsByRasterId[rasterProvinceId] += builtValue;
        }
      }

      if (shouldLogFastRowProgress(rowEndExclusive)) {
        logFastRowProgress({
          processedRows: rowEndExclusive,
          totalRows: builtRowLimit,
          startedAtMs,
          blockEndRow: rowEndExclusive - 1,
        });
      }
    }
  } finally {
    await Promise.allSettled([populationMaskRaster.tiff.close?.(), builtMaskRaster.tiff.close?.()]);
  }

  const finishedAt = new Date();
  const provinceRecordsWithIds = buildProvinceRecordsFromAccumulators(
    rasterizedProvinces,
    populationSumsByRasterId,
    builtSumsByRasterId,
    true,
  );
  const strippedProvinceRecords = Object.fromEntries(
    Object.entries(provinceRecordsWithIds).map(([provinceId, record]) => [provinceId, stripRasterProvinceId(record)]),
  );
  const warnings = [];
  for (const province of rasterizedProvinces) {
    const record = provinceRecordsWithIds[province.provinceId];
    if (
      typeof record?.rasterBuiltUpSurfaceKm2?.value === "number" &&
      province.areaKm2 > 0 &&
      record.rasterBuiltUpSurfaceKm2.value > province.areaKm2 * 1.25
    ) {
      warnings.push(
        `Built-up surface noticeably exceeds province area for ${province.provinceId}: ${roundNumber(record.rasterBuiltUpSurfaceKm2.value, 3)} km2 vs ${roundNumber(province.areaKm2, 3)} km2.`,
      );
    }
  }

  const comparisonSummary =
    debugMaxProvinces !== null && debugMaxProvinces <= 50
      ? await compareFastAndSlowSubset({
          preparedProvinces: rasterizedProvinces,
          populationRaster,
          builtRaster,
          fastProvinceRecords: strippedProvinceRecords,
        })
      : null;

  const coverage = buildCoverage({
    mode: "fast-mask",
    populationRaster,
    builtRaster,
    provinceRecords: strippedProvinceRecords,
    processedProvinceCount: rasterizedProvinces.length,
    totalProvinceCount: preparedProvinces.length,
    skippedEntries: [],
    warnings,
    totalRasterPopulation: sumTypedArray(populationSumsByRasterId),
    totalBuiltUpSurfaceKm2: sumTypedArray(builtSumsByRasterId) / 1_000_000,
    startedAt,
    finishedAt,
    debugMaxProvinces,
    debugMaxRows,
    resumeEnabled,
    resumedFromPartial,
    processedRows: Math.max(processedRows, builtRowLimit),
    rowLimit: Math.max(rowLimit, builtRowLimit),
    maskPath: null,
    populationMaskPath: PROVINCE_RASTER_POPULATION_MASK_PATH,
    builtMaskPath: PROVINCE_RASTER_BUILT_MASK_PATH,
    provinceIndexGeoJsonPath: PROVINCE_RASTER_INDEX_GEOJSON_PATH,
    comparisonSummary,
  });

  console.info(
    `[GHSL Raster] Fast totals: population=${coverage.validation.totalWorldRasterPopulationEstimate}, builtKm2=${coverage.validation.totalWorldBuiltUpSurfaceKm2}`,
  );
  console.info(
    `[GHSL Raster] Coverage summary: matched=${coverage.provinces.matched}/${coverage.provinces.processed}, rowCoverage=${coverage.rows.coveragePct}%`,
  );

  return {
    provinceRecords: sortObjectByKey(strippedProvinceRecords),
    coverage,
  };
}

async function buildSlowPolygonProvinceRasterSettlementDataset({
  preparedProvinces,
  populationRaster,
  builtRaster,
  startedAt,
  startedAtMs,
  debugMaxProvinces,
  debugMaxRows,
  resumeEnabled,
}) {
  const resumedPartial = resumeEnabled ? await readJsonOptional(PROVINCE_RASTER_SETTLEMENT_STATS_PARTIAL_PATH) : null;
  const resumedProvinceRecords = isRecord(resumedPartial) ? resumedPartial : {};
  const alreadyProcessedProvinceIds = new Set(Object.keys(resumedProvinceRecords));
  const resumedFromPartial = resumeEnabled && alreadyProcessedProvinceIds.size > 0;

  if (resumedFromPartial) {
    console.info(`[GHSL Raster] Resuming slow polygon mode with ${alreadyProcessedProvinceIds.size} completed provinces.`);
  }

  const provinceRecords = {};
  let processedCount = 0;
  let lastProcessedProvince = null;
  const skippedProvinces = [];
  const warnings = [];
  let totalRasterPopulation = 0;
  let totalBuiltUpSurfaceKm2 = 0;

  await writeProvinceProgressArtifacts({
    provinceRecords,
    progressPayload: {
      mode: "slow-polygon",
      processedCount: 0,
      remainingCount: preparedProvinces.length,
      lastProcessedProvinceId: null,
      lastProcessedProvinceName: null,
      elapsedSeconds: 0,
      timestamp: new Date().toISOString(),
      debug: {
        enabled: debugMaxProvinces !== null || debugMaxRows !== null,
        maxProvinces: debugMaxProvinces,
        maxRows: debugMaxRows,
        resumeEnabled,
        resumedFromPartial,
      },
    },
  });

  for (const preparedProvince of preparedProvinces) {
    const province = preparedProvince;
    if (alreadyProcessedProvinceIds.has(province.provinceId) && isRecord(resumedProvinceRecords[province.provinceId])) {
      provinceRecords[province.provinceId] = resumedProvinceRecords[province.provinceId];
      processedCount += 1;
      lastProcessedProvince = province;
      totalRasterPopulation += provinceRecords[province.provinceId]?.rasterPopulationEstimate?.value ?? 0;
      totalBuiltUpSurfaceKm2 += provinceRecords[province.provinceId]?.rasterBuiltUpSurfaceKm2?.value ?? 0;
      continue;
    }

    const record = buildEmptyProvinceRasterRecord(province);
    provinceRecords[province.provinceId] = record;
    const [populationAggregate, builtAggregate] = await Promise.all([
      aggregateProvinceAgainstRaster(province, populationRaster),
      aggregateProvinceAgainstRaster(province, builtRaster),
    ]);

    const rasterPopulation = populationAggregate.sum;
    const builtUpSurfaceKm2 = builtAggregate.sum === null ? null : builtAggregate.sum / 1_000_000;
    if (Number.isFinite(rasterPopulation) && rasterPopulation > 0) {
      record.rasterPopulationEstimate = makeFact(roundNumber(rasterPopulation, 0), GHSL_YEAR, GHSL_POP_SOURCE, 0);
      record.rasterPopulationDensityPerKm2 =
        province.areaKm2 > 0
          ? makeFact(
              rasterPopulation / province.areaKm2,
              GHSL_YEAR,
              `${GHSL_POP_SOURCE} + Natural Earth province geometry`,
              2,
            )
          : buildNullFact();
      totalRasterPopulation += rasterPopulation;
    }
    if (Number.isFinite(builtUpSurfaceKm2) && builtUpSurfaceKm2 > 0) {
      record.rasterBuiltUpSurfaceKm2 = makeFact(builtUpSurfaceKm2, GHSL_YEAR, GHSL_BUILT_SOURCE, 3);
      record.rasterBuiltUpSurfaceSharePct =
        province.areaKm2 > 0
          ? makeFact(
              (builtUpSurfaceKm2 / province.areaKm2) * 100,
              GHSL_YEAR,
              `${GHSL_BUILT_SOURCE} + Natural Earth province geometry`,
              3,
            )
          : buildNullFact();
      totalBuiltUpSurfaceKm2 += builtUpSurfaceKm2;
      if (province.areaKm2 > 0 && builtUpSurfaceKm2 > province.areaKm2 * 1.25) {
        warnings.push(
          `Built-up surface noticeably exceeds province area for ${province.provinceId}: ${roundNumber(builtUpSurfaceKm2, 3)} km2 vs ${roundNumber(province.areaKm2, 3)} km2.`,
        );
      }
    }
    if (record.rasterPopulationEstimate.value !== null && record.rasterBuiltUpSurfaceKm2.value !== null) {
      record.rasterPopulationPerBuiltUpKm2 =
        record.rasterBuiltUpSurfaceKm2.value > 0
          ? makeFact(
              record.rasterPopulationEstimate.value / record.rasterBuiltUpSurfaceKm2.value,
              GHSL_YEAR,
              COMBINED_RASTER_SOURCE,
              2,
            )
          : buildNullFact();
    }
    record.rasterSettlementDataCompleteness = makeRasterCompletenessFact(
      record.rasterPopulationEstimate.value !== null,
      record.rasterBuiltUpSurfaceKm2.value !== null,
    );

    const reasons = [populationAggregate.reason, builtAggregate.reason].filter(Boolean);
    if (reasons.length > 0) {
      skippedProvinces.push({
        id: province.provinceId,
        name: province.provinceName,
        countryIso3: province.countryIso3,
        reason: Array.from(new Set(reasons)).join(" + "),
      });
    }

    processedCount += 1;
    lastProcessedProvince = province;
    if (shouldLogSlowProvinceProgress(processedCount)) {
      logSlowProvinceProgress({
        processedCount,
        totalCount: preparedProvinces.length,
        province,
        startedAtMs,
      });
    }
    if (processedCount % SLOW_REGULAR_PROGRESS_INTERVAL === 0 || processedCount === preparedProvinces.length) {
      await writeProvinceProgressArtifacts({
        provinceRecords,
        progressPayload: {
          mode: "slow-polygon",
          processedCount,
          remainingCount: Math.max(0, preparedProvinces.length - processedCount),
          lastProcessedProvinceId: lastProcessedProvince?.provinceId ?? null,
          lastProcessedProvinceName: lastProcessedProvince?.provinceName ?? null,
          elapsedSeconds: roundNumber((Date.now() - startedAtMs) / 1000, 2),
          timestamp: new Date().toISOString(),
          debug: {
            enabled: debugMaxProvinces !== null || debugMaxRows !== null,
            maxProvinces: debugMaxProvinces,
            maxRows: debugMaxRows,
            resumeEnabled,
            resumedFromPartial,
          },
        },
      });
    }
  }

  const finishedAt = new Date();
  const coverage = buildCoverage({
    mode: "slow-polygon",
    populationRaster,
    builtRaster,
    provinceRecords,
    processedProvinceCount: preparedProvinces.length,
    totalProvinceCount: preparedProvinces.length,
    skippedEntries: skippedProvinces,
    warnings,
    totalRasterPopulation,
    totalBuiltUpSurfaceKm2,
    startedAt,
    finishedAt,
    debugMaxProvinces,
    debugMaxRows,
    resumeEnabled,
    resumedFromPartial,
    processedRows: 0,
    rowLimit: debugMaxRows ?? populationRaster.height,
    maskPath: null,
    populationMaskPath: null,
    builtMaskPath: null,
    provinceIndexGeoJsonPath: null,
    comparisonSummary: null,
  });

  console.info(
    `[GHSL Raster] Slow totals: population=${coverage.validation.totalWorldRasterPopulationEstimate}, builtKm2=${coverage.validation.totalWorldBuiltUpSurfaceKm2}`,
  );
  console.info(
    `[GHSL Raster] Coverage summary: matched=${coverage.provinces.matched}/${coverage.provinces.processed}, skipped=${coverage.provinces.skipped}`,
  );

  return {
    provinceRecords: sortObjectByKey(provinceRecords),
    coverage,
  };
}

export async function buildProvinceRasterSettlementDataset() {
  const startedAt = new Date();
  const startedAtMs = startedAt.getTime();
  const provinceIndex = await buildProvinceIndex();
  const sortedProvinces = [...provinceIndex.provinces].sort((left, right) => left.provinceId.localeCompare(right.provinceId));
  const debugMaxProvinces = getDebugMaxProvinces();
  const debugMaxRows = getDebugMaxRows();
  const resumeEnabled = isResumeEnabled();
  const slowPolygonMode = useSlowPolygonMode();

  const provinceSubset = debugMaxProvinces === null ? sortedProvinces : sortedProvinces.slice(0, debugMaxProvinces);
  const preparedProvinces = provinceSubset.map((province) => buildPreparedProvince(province));

  console.info(`[GHSL Raster] Total province count to process: ${preparedProvinces.length}`);
  if (debugMaxProvinces !== null) {
    console.info(`[GHSL Raster] Debug mode enabled via GHSL_RASTER_MAX_PROVINCES=${debugMaxProvinces}`);
  }
  if (debugMaxRows !== null) {
    console.info(`[GHSL Raster] Debug mode enabled via GHSL_RASTER_MAX_ROWS=${debugMaxRows}`);
  }
  if (resumeEnabled) {
    console.info("[GHSL Raster] Resume mode enabled via GHSL_RASTER_RESUME=1");
  }
  console.info(`[GHSL Raster] Aggregation mode: ${slowPolygonMode ? "slow polygon fallback" : "fast GDAL mask"}`);

  const populationRaster = await openRasterContext(RASTER_CONFIG.population);
  const builtRaster = await openRasterContext(RASTER_CONFIG.built);

  try {
    if (slowPolygonMode) {
      return await buildSlowPolygonProvinceRasterSettlementDataset({
        preparedProvinces,
        populationRaster,
        builtRaster,
        startedAt,
        startedAtMs,
        debugMaxProvinces,
        debugMaxRows,
        resumeEnabled,
      });
    }

    try {
      return await buildFastMaskProvinceRasterSettlementDataset({
        preparedProvinces,
        populationRaster,
        builtRaster,
        startedAt,
        startedAtMs,
        debugMaxProvinces,
        debugMaxRows,
        resumeEnabled,
      });
    } catch (error) {
      if (error instanceof Error && error.message === GDAL_MISSING_ERROR) {
        throw error;
      }
      throw error;
    }
  } finally {
    await Promise.allSettled([populationRaster.tiff.close?.(), builtRaster.tiff.close?.()]);
  }
}

export { writeJson };
