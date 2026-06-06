import { createWriteStream } from "node:fs";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import * as shapefile from "shapefile";
import unzipper from "unzipper";
import {
  along,
  area,
  bbox,
  distance,
  lineString,
  point,
  pointToLineDistance,
  polygonToLine,
  length as turfLength,
} from "@turf/turf";
import { buildProvinceIndex, matchPointToProvince } from "./lib/provinceUtils.mjs";
import { writeJson } from "./lib/ghslSettlement.mjs";
import {
  HIGHWAY_CONNECTION_SAMPLE_INTERVAL_KM,
  RAIL_CONNECTION_SAMPLE_INTERVAL_KM,
  addConnectionEdge,
  densifyLineCoordinates,
  getLineCoordinateArrays,
} from "./lib/infrastructureConnections.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const YEAR = 2025;
const MATCH_TOLERANCE_KM = 35;

const RAW_DIR = resolve(__dirname, "..", "public", "data", "raw", "natural-earth-infrastructure");
const OUTPUT_PATH = resolve(__dirname, "..", "public", "data", "infrastructure-stats.json");
const COVERAGE_PATH = resolve(__dirname, "..", "public", "data", "infrastructure-stats-coverage.json");
const CONNECTIONS_OUTPUT_PATH = resolve(__dirname, "..", "public", "data", "infrastructure-connections.json");
const CONNECTIONS_COVERAGE_PATH = resolve(__dirname, "..", "public", "data", "infrastructure-connections-coverage.json");
const AIRPORTS_GEOJSON_PATH = resolve(__dirname, "..", "public", "data", "infrastructure-airports.geojson");
const PORTS_GEOJSON_PATH = resolve(__dirname, "..", "public", "data", "infrastructure-ports.geojson");
const RAILROADS_GEOJSON_PATH = resolve(__dirname, "..", "public", "data", "infrastructure-railroads.geojson");
const HIGHWAYS_GEOJSON_PATH = resolve(__dirname, "..", "public", "data", "infrastructure-highways.geojson");
const VISUAL_LAYERS_COVERAGE_PATH = resolve(
  __dirname,
  "..",
  "public",
  "data",
  "infrastructure-visual-layers-coverage.json",
);
const CANONICAL_PROVINCE_PATH = resolve(__dirname, "..", "public", "data", "canonical-province-data.json");

const LAYERS = [
  {
    id: "roads",
    archiveName: "ne_10m_roads.zip",
    source: "Natural Earth 1:10m roads",
    urls: [
      "https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/cultural/ne_10m_roads.zip",
      "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_roads.zip",
    ],
  },
  {
    id: "railroads",
    archiveName: "ne_10m_railroads.zip",
    source: "Natural Earth 1:10m railroads",
    urls: [
      "https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/cultural/ne_10m_railroads.zip",
      "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_railroads.zip",
    ],
  },
  {
    id: "airports",
    archiveName: "ne_10m_airports.zip",
    source: "Natural Earth 1:10m airports",
    urls: [
      "https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/cultural/ne_10m_airports.zip",
      "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_airports.zip",
    ],
  },
  {
    id: "ports",
    archiveName: "ne_10m_ports.zip",
    source: "Natural Earth 1:10m ports",
    urls: [
      "https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/cultural/ne_10m_ports.zip",
      "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_ports.zip",
    ],
  },
];

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function roundNumber(value, digits = 3) {
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

function buildFact(value, source, digits = null) {
  const finalValue = digits === null || typeof value !== "number" ? value : roundNumber(value, digits);
  return {
    value: finalValue,
    year: YEAR,
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

async function readJsonOptional(path) {
  if (!(await pathExists(path))) {
    return null;
  }
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeCompactJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function ensureArchive(layer) {
  await mkdir(RAW_DIR, { recursive: true });
  const archivePath = resolve(RAW_DIR, layer.archiveName);

  if (await pathExists(archivePath)) {
    const archiveStats = await stat(archivePath);
    if (archiveStats.size > 0) {
      console.info(`[Infrastructure] Using cached ${layer.archiveName}`);
      return archivePath;
    }
  }

  let lastError = null;
  for (const url of layer.urls) {
    try {
      console.info(`[Infrastructure] Downloading ${layer.archiveName} from ${url}`);
      const response = await fetch(url);
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      await pipeline(response.body, createWriteStream(archivePath));
      return archivePath;
    } catch (error) {
      lastError = error;
      console.warn(`[Infrastructure] Download attempt failed for ${layer.archiveName}: ${error.message}`);
    }
  }

  throw new Error(
    `Failed to download ${layer.archiveName}. Tried: ${layer.urls.join(", ")}. Last error: ${lastError?.message ?? "unknown error"}`,
  );
}

async function readZipEntryBuffer(entry) {
  return entry.buffer();
}

async function loadLayerFeatureCollection(layer) {
  const archivePath = await ensureArchive(layer);
  const directory = await unzipper.Open.file(archivePath);
  const shpEntry = directory.files.find((entry) => entry.path.toLowerCase().endsWith(".shp"));
  const dbfEntry = directory.files.find((entry) => entry.path.toLowerCase().endsWith(".dbf"));

  if (!shpEntry) {
    throw new Error(`${layer.archiveName} does not contain a .shp file.`);
  }

  const shpBuffer = await readZipEntryBuffer(shpEntry);
  const dbfBuffer = dbfEntry ? await readZipEntryBuffer(dbfEntry) : null;
  const featureCollection = await shapefile.read(shpBuffer, dbfBuffer ?? undefined, { encoding: "windows-1252" });

  if (!isRecord(featureCollection) || featureCollection.type !== "FeatureCollection" || !Array.isArray(featureCollection.features)) {
    throw new Error(`Unexpected shapefile parse result for ${layer.archiveName}.`);
  }

  const propertyKeys = new Set();
  for (const feature of featureCollection.features) {
    const properties = isRecord(feature.properties) ? feature.properties : {};
    for (const key of Object.keys(properties)) {
      propertyKeys.add(key);
    }
  }

  console.info(
    `[Infrastructure] ${layer.id} property keys: ${
      [...propertyKeys].sort().join(", ") || "(no properties detected)"
    }`,
  );

  return {
    features: featureCollection.features,
    propertyKeys: [...propertyKeys].sort(),
  };
}

function pickString(properties, candidates) {
  for (const candidate of candidates) {
    const value = properties?.[candidate];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function makeFeatureCollection(features) {
  return {
    type: "FeatureCollection",
    features,
  };
}

function createPointFeature(id, coordinates, properties) {
  return {
    type: "Feature",
    id,
    properties,
    geometry: {
      type: "Point",
      coordinates,
    },
  };
}

function createLineFeature(id, geometry, properties) {
  if (!isRecord(geometry)) {
    return null;
  }

  if (geometry.type !== "LineString" && geometry.type !== "MultiLineString") {
    return null;
  }

  return {
    type: "Feature",
    id,
    properties,
    geometry,
  };
}

function getFeatureId(properties, prefix, fallbackIndex) {
  const candidates = [
    properties?.ne_id,
    properties?.NE_ID,
    properties?.wikidataid,
    properties?.gps_code,
    properties?.iata_code,
    properties?.rwdb_rr_id,
    properties?.rwdb_rd_id,
    properties?.uident,
    properties?.orig_fid,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return `${prefix}-${candidate.trim()}`;
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return `${prefix}-${candidate}`;
    }
  }

  return `${prefix}-${fallbackIndex}`;
}

function getRoadTypeLabel(properties) {
  return pickString(properties, ["type", "TYPE"]) ?? "Unknown";
}

function getFeatureIso3(properties) {
  const value = pickString(properties, [
    "adm0_a3",
    "ADM0_A3",
    "sov_a3",
    "SOV_A3",
    "iso_a3",
    "ISO_A3",
    "gu_a3",
    "GU_A3",
    "sr_adm0_a3",
    "SR_ADM0_A3",
  ]);
  if (!value) {
    return null;
  }
  const normalized = value.toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function collectTextSignals(properties, candidates) {
  return candidates
    .map((candidate) => properties?.[candidate])
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
}

function getRankSignal(properties) {
  for (const key of ["scalerank", "scale_rank", "labelrank", "label_rank"]) {
    const value = toFiniteNumber(properties?.[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function looksMajorTransportText(text) {
  return /\b(highway|interstate|motorway|freeway|expressway|trunk|primary|major)\b/.test(text);
}

function looksMinorRoadText(text) {
  return /\b(local|minor|residential|street|secondary|tertiary|track|trail|path|service|unimproved)\b/.test(text);
}

function shouldKeepRoadFeature(properties, propertyKeys) {
  const roadType = pickString(properties, ["type", "TYPE"]);
  const roadLevel = pickString(properties, ["level", "LEVEL"]);
  const expressway = toFiniteNumber(properties?.expressway) === 1;
  const hasHierarchyFields = propertyKeys.some((key) => ["type", "TYPE", "level", "LEVEL", "expressway", "scalerank", "labelrank"].includes(key));

  if (!hasHierarchyFields) {
    return true;
  }

  const normalizedType = roadType?.toLowerCase() ?? "";
  const normalizedLevel = roadLevel?.toLowerCase() ?? "";

  if (normalizedType === "major highway" || normalizedType === "beltway") {
    return true;
  }

  if (normalizedType === "secondary highway") {
    return expressway || ["federal", "interstate", "e"].includes(normalizedLevel);
  }

  if (normalizedType === "road") {
    return expressway || ["federal", "interstate", "e"].includes(normalizedLevel);
  }

  return false;
}

function isMajorAirport(properties) {
  const airportType = pickString(properties, ["type", "TYPE"])?.toLowerCase() ?? "";
  const rank = getRankSignal(properties);
  return /\bmajor\b/.test(airportType) && rank !== null && rank <= 4;
}

function isMajorPort(properties) {
  const rank = getRankSignal(properties);
  return rank !== null && rank <= 3;
}

function getRepresentativePointCoordinates(geometry) {
  if (!isRecord(geometry)) {
    return null;
  }

  if (geometry.type === "Point" && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
    return geometry.coordinates;
  }

  if (geometry.type === "MultiPoint" && Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0) {
    const [lonSum, latSum] = geometry.coordinates.reduce(
      (totals, coordinates) => [totals[0] + coordinates[0], totals[1] + coordinates[1]],
      [0, 0],
    );
    return [lonSum / geometry.coordinates.length, latSum / geometry.coordinates.length];
  }

  return null;
}

function getLineSegmentsFromGeometry(geometry) {
  if (!isRecord(geometry)) {
    return [];
  }

  if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.slice(1).map((coordinate, index) => [geometry.coordinates[index], coordinate]);
  }

  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.flatMap((lineCoordinates) =>
      lineCoordinates.slice(1).map((coordinate, index) => [lineCoordinates[index], coordinate]),
    );
  }

  return [];
}

function getProvinceBoundaryDistanceKm(province, pt) {
  if (!province.__boundaryLine) {
    province.__boundaryLine = polygonToLine(province.feature);
  }

  const measureBoundaryDistance = (boundaryFeature) => {
    if (boundaryFeature.geometry?.type === "MultiLineString") {
      return Math.min(
        ...boundaryFeature.geometry.coordinates.map((coordinates) =>
          pointToLineDistance(pt, lineString(coordinates), { units: "kilometers" }),
        ),
      );
    }
    return pointToLineDistance(pt, boundaryFeature, { units: "kilometers" });
  };

  if (province.__boundaryLine.type === "FeatureCollection") {
    return Math.min(...province.__boundaryLine.features.map((boundaryFeature) => measureBoundaryDistance(boundaryFeature)));
  }

  return measureBoundaryDistance(province.__boundaryLine);
}

function matchPointToProvinceWithTolerance(coordinates, provinceIndex, preferredCountryIso3 = null, toleranceKm = MATCH_TOLERANCE_KM) {
  const directMatch = matchPointToProvince(coordinates, provinceIndex, preferredCountryIso3);
  if (directMatch) {
    return directMatch;
  }

  const searchPool =
    (preferredCountryIso3 && provinceIndex.byCountryIso3.get(preferredCountryIso3)) ?? provinceIndex.provinces;
  const pt = point(coordinates);
  let bestProvince = null;
  let bestDistanceKm = Number.POSITIVE_INFINITY;

  for (const province of searchPool) {
    const [minLon, minLat, maxLon, maxLat] = province.bbox ?? bbox(province.feature);
    const expanded = [
      minLon - 1,
      minLat - 1,
      maxLon + 1,
      maxLat + 1,
    ];
    if (
      coordinates[0] < expanded[0] ||
      coordinates[0] > expanded[2] ||
      coordinates[1] < expanded[1] ||
      coordinates[1] > expanded[3]
    ) {
      continue;
    }

    const distanceKm = getProvinceBoundaryDistanceKm(province, pt);
    if (distanceKm < bestDistanceKm) {
      bestDistanceKm = distanceKm;
      bestProvince = province;
    }
  }

  if (bestProvince && bestDistanceKm <= toleranceKm) {
    return bestProvince;
  }

  return null;
}

function createEmptyInfrastructureRecord(province, areaKm2) {
  return {
    provinceId: province.provinceId,
    provinceName: province.provinceName,
    countryIso3: province.countryIso3,
    countryName: province.countryName,
    areaKm2,
    infrastructure: {
      airports: {
        count: buildFact(0, "Natural Earth 1:10m airports"),
        majorCount: buildFact(0, "Natural Earth 1:10m airports"),
        hasAirport: buildFact(false, "Natural Earth 1:10m airports"),
      },
      ports: {
        count: buildFact(0, "Natural Earth 1:10m ports"),
        majorCount: buildFact(0, "Natural Earth 1:10m ports"),
        hasPort: buildFact(false, "Natural Earth 1:10m ports"),
      },
      rail: {
        lengthKm: buildFact(0, "Natural Earth 1:10m railroads", 3),
        densityKmPer1000Km2: buildFact(0, "Natural Earth 1:10m railroads", 3),
        hasRail: buildFact(false, "Natural Earth 1:10m railroads"),
      },
      roads: {
        highwayLengthKm: buildFact(0, "Natural Earth 1:10m roads", 3),
        densityKmPer1000Km2: buildFact(0, "Natural Earth 1:10m roads", 3),
        hasHighway: buildFact(false, "Natural Earth 1:10m roads"),
      },
      connectivityScore: buildFact(0, "Derived from Natural Earth 1:10m transport layers"),
    },
  };
}

function finalizeProvinceRecord(record) {
  const airports = record.infrastructure.airports.count.value ?? 0;
  const majorAirports = record.infrastructure.airports.majorCount.value ?? 0;
  const ports = record.infrastructure.ports.count.value ?? 0;
  const majorPorts = record.infrastructure.ports.majorCount.value ?? 0;
  const railLengthKm = record.infrastructure.rail.lengthKm.value ?? 0;
  const highwayLengthKm = record.infrastructure.roads.highwayLengthKm.value ?? 0;
  const areaKm2 = record.areaKm2;

  const railDensity = areaKm2 > 0 ? (railLengthKm / areaKm2) * 1000 : 0;
  const highwayDensity = areaKm2 > 0 ? (highwayLengthKm / areaKm2) * 1000 : 0;

  record.infrastructure.airports.hasAirport = buildFact(airports > 0, "Natural Earth 1:10m airports");
  record.infrastructure.ports.hasPort = buildFact(ports > 0, "Natural Earth 1:10m ports");
  record.infrastructure.rail.hasRail = buildFact(railLengthKm > 0, "Natural Earth 1:10m railroads");
  record.infrastructure.roads.hasHighway = buildFact(highwayLengthKm > 0, "Natural Earth 1:10m roads");
  record.infrastructure.rail.densityKmPer1000Km2 = buildFact(railDensity, "Natural Earth 1:10m railroads", 3);
  record.infrastructure.roads.densityKmPer1000Km2 = buildFact(highwayDensity, "Natural Earth 1:10m roads", 3);

  // This is an intentionally abstract strategic-infrastructure score for gameplay overlays,
  // not an engineering-grade transport-performance index or a route-planning metric.
  let score = 0;
  if (airports > 0) {
    score += 20;
    score += Math.min(airports * 3, 15);
  }
  if (majorAirports > 0) {
    score += 15;
  }
  if (ports > 0) {
    score += 20;
    score += Math.min(ports * 3, 15);
  }
  if (majorPorts > 0) {
    score += 15;
  }
  if (railLengthKm > 0) {
    score += 15;
    score += (Math.min(railDensity, 50) / 50) * 10;
  }
  if (highwayLengthKm > 0) {
    score += 15;
    score += (Math.min(highwayDensity, 100) / 100) * 10;
  }

  record.infrastructure.connectivityScore = buildFact(Math.max(0, Math.min(100, roundNumber(score, 2))), "Derived from Natural Earth 1:10m transport layers");
}

async function main() {
  const [provinceIndex, canonicalProvinceDataMaybe] = await Promise.all([
    buildProvinceIndex(),
    readJsonOptional(CANONICAL_PROVINCE_PATH),
  ]);

  const provinceAreaOverrides = new Map(
    Object.values(canonicalProvinceDataMaybe ?? {})
      .filter((record) => isRecord(record) && typeof record.provinceId === "string")
      .map((record) => [record.provinceId, toFiniteNumber(record.areaKm2?.value)]),
  );

  const provinceRecords = Object.fromEntries(
    provinceIndex.provinces.map((province) => {
      const areaKm2 = provinceAreaOverrides.get(province.provinceId) ?? roundNumber(area(province.feature) / 1_000_000, 3) ?? 0;
      return [province.provinceId, createEmptyInfrastructureRecord(province, areaKm2)];
    }),
  );

  const layerResults = {};
  for (const layer of LAYERS) {
    layerResults[layer.id] = await loadLayerFeatureCollection(layer);
  }

  const summary = {
    airports: { total: 0, matched: 0, unmatched: 0, major: 0 },
    ports: { total: 0, matched: 0, unmatched: 0, major: 0 },
    roads: { segmentsProcessed: 0, segmentsMatched: 0, segmentsUnmatched: 0, featuresKept: 0, featuresFilteredOut: 0 },
    railroads: { segmentsProcessed: 0, segmentsMatched: 0, segmentsUnmatched: 0 },
  };
  const connectionSummary = {
    roads: {
      featuresProcessed: 0,
      featuresSkipped: 0,
      sampledPoints: 0,
      unmatchedSampledPoints: 0,
    },
    railroads: {
      featuresProcessed: 0,
      featuresSkipped: 0,
      sampledPoints: 0,
      unmatchedSampledPoints: 0,
    },
  };
  const connectionEdgeMap = new Map();
  const exportedAirports = [];
  const exportedPorts = [];
  const exportedRailroads = [];
  const exportedHighways = [];
  const roadTypesIncluded = new Map();
  const roadTypesExcluded = new Map();

  for (const [featureIndex, feature] of layerResults.airports.features.entries()) {
    const properties = isRecord(feature.properties) ? feature.properties : {};
    const coordinates = getRepresentativePointCoordinates(feature.geometry);
    if (!coordinates) {
      continue;
    }

    const preferredCountryIso3 = getFeatureIso3(properties);
    const province = matchPointToProvinceWithTolerance(coordinates, provinceIndex, preferredCountryIso3);
    const major = isMajorAirport(properties);
    summary.airports.total += 1;
    if (major) {
      summary.airports.major += 1;
    }

    if (!province) {
      summary.airports.unmatched += 1;
      continue;
    }

    summary.airports.matched += 1;
    const record = provinceRecords[province.provinceId];
    record.infrastructure.airports.count.value += 1;
    if (major) {
      record.infrastructure.airports.majorCount.value += 1;
    }

    exportedAirports.push(
      createPointFeature(getFeatureId(properties, "airport", featureIndex), coordinates, {
        id: getFeatureId(properties, "airport", featureIndex),
        name: pickString(properties, ["name_en", "name", "namealt", "abbrev"]),
        type: pickString(properties, ["type", "TYPE"]),
        scalerank: getRankSignal(properties),
        isMajor: major,
        provinceId: province.provinceId,
        provinceName: province.provinceName,
        countryIso3: province.countryIso3,
        countryName: province.countryName,
        source: "Natural Earth 1:10m airports",
      }),
    );
  }

  for (const [featureIndex, feature] of layerResults.ports.features.entries()) {
    const properties = isRecord(feature.properties) ? feature.properties : {};
    const coordinates = getRepresentativePointCoordinates(feature.geometry);
    if (!coordinates) {
      continue;
    }

    const preferredCountryIso3 = getFeatureIso3(properties);
    const province = matchPointToProvinceWithTolerance(coordinates, provinceIndex, preferredCountryIso3);
    const major = isMajorPort(properties);
    summary.ports.total += 1;
    if (major) {
      summary.ports.major += 1;
    }

    if (!province) {
      summary.ports.unmatched += 1;
      continue;
    }

    summary.ports.matched += 1;
    const record = provinceRecords[province.provinceId];
    record.infrastructure.ports.count.value += 1;
    if (major) {
      record.infrastructure.ports.majorCount.value += 1;
    }

    exportedPorts.push(
      createPointFeature(getFeatureId(properties, "port", featureIndex), coordinates, {
        id: getFeatureId(properties, "port", featureIndex),
        name: pickString(properties, ["name"]),
        scalerank: getRankSignal(properties),
        isMajor: major,
        provinceId: province.provinceId,
        provinceName: province.provinceName,
        countryIso3: province.countryIso3,
        countryName: province.countryName,
        source: "Natural Earth 1:10m ports",
      }),
    );
  }

  for (const [featureIndex, feature] of layerResults.roads.features.entries()) {
    const properties = isRecord(feature.properties) ? feature.properties : {};
    const roadTypeLabel = getRoadTypeLabel(properties);
    if (!shouldKeepRoadFeature(properties, layerResults.roads.propertyKeys)) {
      summary.roads.featuresFilteredOut += 1;
      connectionSummary.roads.featuresSkipped += 1;
      roadTypesExcluded.set(roadTypeLabel, (roadTypesExcluded.get(roadTypeLabel) ?? 0) + 1);
      continue;
    }

    summary.roads.featuresKept += 1;
    connectionSummary.roads.featuresProcessed += 1;
    roadTypesIncluded.set(roadTypeLabel, (roadTypesIncluded.get(roadTypeLabel) ?? 0) + 1);
    const highwayFeature = createLineFeature(getFeatureId(properties, "highway", featureIndex), feature.geometry, {
      id: getFeatureId(properties, "highway", featureIndex),
      name: pickString(properties, ["name", "label", "namealt"]),
      type: pickString(properties, ["type", "TYPE"]),
      level: pickString(properties, ["level", "LEVEL"]),
      expressway:
        properties?.expressway === null || properties?.expressway === undefined ? null : String(properties.expressway),
      scalerank: getRankSignal(properties),
      source: "Natural Earth 1:10m roads",
    });
    if (highwayFeature) {
      exportedHighways.push(highwayFeature);
    }
    const preferredCountryIso3 = getFeatureIso3(properties);
    for (const segment of getLineSegmentsFromGeometry(feature.geometry)) {
      const segmentLine = lineString(segment);
      const segmentLengthKm = turfLength(segmentLine, { units: "kilometers" });
      if (!Number.isFinite(segmentLengthKm) || segmentLengthKm <= 0) {
        continue;
      }

      summary.roads.segmentsProcessed += 1;
      const midpoint = along(segmentLine, segmentLengthKm / 2, { units: "kilometers" });
      const province = matchPointToProvince(midpoint.geometry.coordinates, provinceIndex, preferredCountryIso3);

      if (!province) {
        summary.roads.segmentsUnmatched += 1;
        continue;
      }

      summary.roads.segmentsMatched += 1;
      provinceRecords[province.provinceId].infrastructure.roads.highwayLengthKm.value += segmentLengthKm;
    }

    for (const coordinates of getLineCoordinateArrays(feature.geometry)) {
      const sampledCoordinates = densifyLineCoordinates(coordinates, HIGHWAY_CONNECTION_SAMPLE_INTERVAL_KM);
      if (sampledCoordinates.length < 2) {
        continue;
      }

      const sampledProvinces = sampledCoordinates.map((sampledCoordinate) => {
        const province = matchPointToProvinceWithTolerance(sampledCoordinate, provinceIndex, preferredCountryIso3);
        connectionSummary.roads.sampledPoints += 1;
        if (!province) {
          connectionSummary.roads.unmatchedSampledPoints += 1;
        }
        return province;
      });

      for (let index = 1; index < sampledCoordinates.length; index += 1) {
        const leftProvince = sampledProvinces[index - 1];
        const rightProvince = sampledProvinces[index];
        if (!leftProvince || !rightProvince || leftProvince.provinceId === rightProvince.provinceId) {
          continue;
        }

        const transitionLengthKm = distance(sampledCoordinates[index - 1], sampledCoordinates[index], { units: "kilometers" });
        addConnectionEdge(connectionEdgeMap, {
          fromProvinceId: leftProvince.provinceId,
          fromProvinceName: leftProvince.provinceName,
          fromCountryIso3: leftProvince.countryIso3,
          fromCountryName: leftProvince.countryName,
          toProvinceId: rightProvince.provinceId,
          toProvinceName: rightProvince.provinceName,
          toCountryIso3: rightProvince.countryIso3,
          toCountryName: rightProvince.countryName,
          mode: "highway",
          isInternational: leftProvince.countryIso3 !== rightProvince.countryIso3,
          connectionCount: 1,
          approxLengthKm: transitionLengthKm,
          source: "Natural Earth 1:10m roads",
        });
      }
    }
  }

  for (const [featureIndex, feature] of layerResults.railroads.features.entries()) {
    const properties = isRecord(feature.properties) ? feature.properties : {};
    connectionSummary.railroads.featuresProcessed += 1;
    const railroadFeature = createLineFeature(getFeatureId(properties, "rail", featureIndex), feature.geometry, {
      id: getFeatureId(properties, "rail", featureIndex),
      name: pickString(properties, ["name", "label"]),
      type: pickString(properties, ["category", "featurecla"]),
      scalerank: getRankSignal(properties),
      source: "Natural Earth 1:10m railroads",
    });
    if (railroadFeature) {
      exportedRailroads.push(railroadFeature);
    }
    const preferredCountryIso3 = getFeatureIso3(properties);
    for (const segment of getLineSegmentsFromGeometry(feature.geometry)) {
      const segmentLine = lineString(segment);
      const segmentLengthKm = turfLength(segmentLine, { units: "kilometers" });
      if (!Number.isFinite(segmentLengthKm) || segmentLengthKm <= 0) {
        continue;
      }

      summary.railroads.segmentsProcessed += 1;
      const midpoint = along(segmentLine, segmentLengthKm / 2, { units: "kilometers" });
      const province = matchPointToProvince(midpoint.geometry.coordinates, provinceIndex, preferredCountryIso3);

      if (!province) {
        summary.railroads.segmentsUnmatched += 1;
        continue;
      }

      summary.railroads.segmentsMatched += 1;
      provinceRecords[province.provinceId].infrastructure.rail.lengthKm.value += segmentLengthKm;
    }

    for (const coordinates of getLineCoordinateArrays(feature.geometry)) {
      const sampledCoordinates = densifyLineCoordinates(coordinates, RAIL_CONNECTION_SAMPLE_INTERVAL_KM);
      if (sampledCoordinates.length < 2) {
        continue;
      }

      const sampledProvinces = sampledCoordinates.map((sampledCoordinate) => {
        const province = matchPointToProvinceWithTolerance(sampledCoordinate, provinceIndex, preferredCountryIso3);
        connectionSummary.railroads.sampledPoints += 1;
        if (!province) {
          connectionSummary.railroads.unmatchedSampledPoints += 1;
        }
        return province;
      });

      for (let index = 1; index < sampledCoordinates.length; index += 1) {
        const leftProvince = sampledProvinces[index - 1];
        const rightProvince = sampledProvinces[index];
        if (!leftProvince || !rightProvince || leftProvince.provinceId === rightProvince.provinceId) {
          continue;
        }

        const transitionLengthKm = distance(sampledCoordinates[index - 1], sampledCoordinates[index], { units: "kilometers" });
        addConnectionEdge(connectionEdgeMap, {
          fromProvinceId: leftProvince.provinceId,
          fromProvinceName: leftProvince.provinceName,
          fromCountryIso3: leftProvince.countryIso3,
          fromCountryName: leftProvince.countryName,
          toProvinceId: rightProvince.provinceId,
          toProvinceName: rightProvince.provinceName,
          toCountryIso3: rightProvince.countryIso3,
          toCountryName: rightProvince.countryName,
          mode: "rail",
          isInternational: leftProvince.countryIso3 !== rightProvince.countryIso3,
          connectionCount: 1,
          approxLengthKm: transitionLengthKm,
          source: "Natural Earth 1:10m railroads",
        });
      }
    }
  }

  for (const record of Object.values(provinceRecords)) {
    record.infrastructure.rail.lengthKm = buildFact(record.infrastructure.rail.lengthKm.value ?? 0, "Natural Earth 1:10m railroads", 3);
    record.infrastructure.roads.highwayLengthKm = buildFact(record.infrastructure.roads.highwayLengthKm.value ?? 0, "Natural Earth 1:10m roads", 3);
    finalizeProvinceRecord(record);
  }

  const provinceValues = Object.values(provinceRecords);
  const connectionEdges = [...connectionEdgeMap.values()].map((edge) => ({
    ...edge,
    approxLengthKm: roundNumber(edge.approxLengthKm, 3) ?? 0,
  }));
  const highwayEdges = connectionEdges.filter((edge) => edge.mode === "highway");
  const railEdges = connectionEdges.filter((edge) => edge.mode === "rail");
  const provincesWithHighwayConnections = new Set();
  const provincesWithRailConnections = new Set();
  const countriesWithInternationalHighwayConnections = new Set();
  const countriesWithInternationalRailConnections = new Set();

  for (const edge of connectionEdges) {
    if (edge.mode === "highway") {
      provincesWithHighwayConnections.add(edge.fromProvinceId);
      provincesWithHighwayConnections.add(edge.toProvinceId);
      if (edge.isInternational) {
        if (edge.fromCountryIso3) {
          countriesWithInternationalHighwayConnections.add(edge.fromCountryIso3);
        }
        if (edge.toCountryIso3) {
          countriesWithInternationalHighwayConnections.add(edge.toCountryIso3);
        }
      }
    }

    if (edge.mode === "rail") {
      provincesWithRailConnections.add(edge.fromProvinceId);
      provincesWithRailConnections.add(edge.toProvinceId);
      if (edge.isInternational) {
        if (edge.fromCountryIso3) {
          countriesWithInternationalRailConnections.add(edge.fromCountryIso3);
        }
        if (edge.toCountryIso3) {
          countriesWithInternationalRailConnections.add(edge.toCountryIso3);
        }
      }
    }
  }
  const coverage = {
    generatedAt: new Date().toISOString(),
    sourceLayersUsed: LAYERS.map((layer) => layer.source),
    rawFeatureCountsByLayer: {
      airports: layerResults.airports.features.length,
      ports: layerResults.ports.features.length,
      roads: layerResults.roads.features.length,
      railroads: layerResults.railroads.features.length,
    },
    pointLayerMatching: {
      airports: {
        matched: summary.airports.matched,
        unmatched: summary.airports.unmatched,
        major: summary.airports.major,
      },
      ports: {
        matched: summary.ports.matched,
        unmatched: summary.ports.unmatched,
        major: summary.ports.major,
      },
    },
    lineProcessing: {
      roads: {
        featuresKept: summary.roads.featuresKept,
        featuresFilteredOut: summary.roads.featuresFilteredOut,
        segmentsProcessed: summary.roads.segmentsProcessed,
        segmentsMatched: summary.roads.segmentsMatched,
        segmentsUnmatched: summary.roads.segmentsUnmatched,
      },
      railroads: {
        segmentsProcessed: summary.railroads.segmentsProcessed,
        segmentsMatched: summary.railroads.segmentsMatched,
        segmentsUnmatched: summary.railroads.segmentsUnmatched,
      },
    },
    provinces: {
      total: provinceValues.length,
      withAirports: provinceValues.filter((record) => record.infrastructure.airports.hasAirport.value === true).length,
      withPorts: provinceValues.filter((record) => record.infrastructure.ports.hasPort.value === true).length,
      withRail: provinceValues.filter((record) => record.infrastructure.rail.hasRail.value === true).length,
      withHighways: provinceValues.filter((record) => record.infrastructure.roads.hasHighway.value === true).length,
      withAnyInfrastructure: provinceValues.filter((record) => {
        const infrastructure = record.infrastructure;
        return (
          infrastructure.airports.hasAirport.value === true ||
          infrastructure.ports.hasPort.value === true ||
          infrastructure.rail.hasRail.value === true ||
          infrastructure.roads.hasHighway.value === true
        );
      }).length,
      missingProvinceCount: provinceIndex.provinces.length - provinceValues.length,
    },
    notes: [
      "Natural Earth is generalized 1:10m data.",
      "Line lengths are assigned to provinces by segment midpoint.",
      "Roads are high-level only and are filtered defensively only when the layer exposes usable hierarchy signals.",
      "No local road network, rural accessibility modeling, or street-level routing is included.",
    ],
  };
  const connectionsCoverage = {
    generatedAt: new Date().toISOString(),
    sourceLayersUsed: ["Natural Earth 1:10m roads", "Natural Earth 1:10m railroads"],
    roadFeaturesProcessed: connectionSummary.roads.featuresProcessed,
    railFeaturesProcessed: connectionSummary.railroads.featuresProcessed,
    roadFeaturesSkippedByExistingFilter: connectionSummary.roads.featuresSkipped,
    sampledHighwayPoints: connectionSummary.roads.sampledPoints,
    sampledRailPoints: connectionSummary.railroads.sampledPoints,
    unmatchedSampledPointsByMode: {
      highway: connectionSummary.roads.unmatchedSampledPoints,
      rail: connectionSummary.railroads.unmatchedSampledPoints,
    },
    edgeCounts: {
      highway: highwayEdges.length,
      rail: railEdges.length,
      domesticHighway: highwayEdges.filter((edge) => !edge.isInternational).length,
      domesticRail: railEdges.filter((edge) => !edge.isInternational).length,
      internationalHighway: highwayEdges.filter((edge) => edge.isInternational).length,
      internationalRail: railEdges.filter((edge) => edge.isInternational).length,
    },
    provinces: {
      withHighwayConnections: provincesWithHighwayConnections.size,
      withRailConnections: provincesWithRailConnections.size,
      withAnyInfrastructureConnection: new Set([...provincesWithHighwayConnections, ...provincesWithRailConnections]).size,
    },
    countries: {
      withInternationalHighwayConnections: countriesWithInternationalHighwayConnections.size,
      withInternationalRailConnections: countriesWithInternationalRailConnections.size,
    },
    notes: [
      "Natural Earth 1:10m generalized data.",
      "High-level strategic graph only.",
      "No detailed routing.",
      "No local or rural roads.",
      "No travel-time model.",
      "Edge lengths are approximate.",
    ],
  };
  const visualLayersCoverage = {
    generatedAt: new Date().toISOString(),
    sourceLayersUsed: LAYERS.map((layer) => layer.source),
    exportedFeatureCounts: {
      airports: exportedAirports.length,
      ports: exportedPorts.length,
      railroads: exportedRailroads.length,
      highways: exportedHighways.length,
    },
    pointLayers: {
      airportsMatchedToProvinceMetadata: exportedAirports.length,
      portsMatchedToProvinceMetadata: exportedPorts.length,
      majorAirports: exportedAirports.filter((feature) => feature.properties?.isMajor === true).length,
      majorPorts: exportedPorts.filter((feature) => feature.properties?.isMajor === true).length,
    },
    roadTypesIncluded: Object.fromEntries([...roadTypesIncluded.entries()].sort(([left], [right]) => left.localeCompare(right))),
    roadTypesExcluded: Object.fromEntries([...roadTypesExcluded.entries()].sort(([left], [right]) => left.localeCompare(right))),
    notes: [
      "Visualization layers are Natural Earth 1:10m generalized features.",
      "They are not a routing network.",
      "They do not include rural or local roads.",
      "They are not province choropleths.",
      "Point features are matched to provinces for metadata only.",
    ],
  };

  await writeJson(OUTPUT_PATH, provinceRecords);
  await writeJson(COVERAGE_PATH, coverage);
  await writeJson(CONNECTIONS_OUTPUT_PATH, connectionEdges);
  await writeJson(CONNECTIONS_COVERAGE_PATH, connectionsCoverage);
  await writeCompactJson(AIRPORTS_GEOJSON_PATH, makeFeatureCollection(exportedAirports));
  await writeCompactJson(PORTS_GEOJSON_PATH, makeFeatureCollection(exportedPorts));
  await writeCompactJson(RAILROADS_GEOJSON_PATH, makeFeatureCollection(exportedRailroads));
  await writeCompactJson(HIGHWAYS_GEOJSON_PATH, makeFeatureCollection(exportedHighways));
  await writeJson(VISUAL_LAYERS_COVERAGE_PATH, visualLayersCoverage);

  console.info(`[Infrastructure] Wrote ${OUTPUT_PATH}`);
  console.info(`[Infrastructure] Wrote ${COVERAGE_PATH}`);
  console.info(`[Infrastructure] Wrote ${CONNECTIONS_OUTPUT_PATH}`);
  console.info(`[Infrastructure] Wrote ${CONNECTIONS_COVERAGE_PATH}`);
  console.info(`[Infrastructure] Wrote ${AIRPORTS_GEOJSON_PATH}`);
  console.info(`[Infrastructure] Wrote ${PORTS_GEOJSON_PATH}`);
  console.info(`[Infrastructure] Wrote ${RAILROADS_GEOJSON_PATH}`);
  console.info(`[Infrastructure] Wrote ${HIGHWAYS_GEOJSON_PATH}`);
  console.info(`[Infrastructure] Wrote ${VISUAL_LAYERS_COVERAGE_PATH}`);
  console.info(`[Infrastructure] Total airports: ${summary.airports.total}`);
  console.info(`[Infrastructure] Matched airports: ${summary.airports.matched}`);
  console.info(`[Infrastructure] Unmatched airports: ${summary.airports.unmatched}`);
  console.info(`[Infrastructure] Major airports: ${summary.airports.major}`);
  console.info(`[Infrastructure] Total ports: ${summary.ports.total}`);
  console.info(`[Infrastructure] Matched ports: ${summary.ports.matched}`);
  console.info(`[Infrastructure] Unmatched ports: ${summary.ports.unmatched}`);
  console.info(`[Infrastructure] Major ports: ${summary.ports.major}`);
  console.info(`[Infrastructure] Road segments processed: ${summary.roads.segmentsProcessed}`);
  console.info(`[Infrastructure] Rail segments processed: ${summary.railroads.segmentsProcessed}`);
}

main().catch((error) => {
  console.error("Failed to import Natural Earth infrastructure.", error);
  process.exitCode = 1;
});
