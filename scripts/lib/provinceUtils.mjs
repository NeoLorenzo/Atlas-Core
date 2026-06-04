import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { area, bbox, booleanPointInPolygon, point } from "@turf/turf";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const PROVINCES_PATH = resolve(__dirname, "..", "..", "public", "data", "provinces.geojson");

const COUNTRY_NAME_ALIASES = {
  "bolivia": "BOL",
  "bolivia plurinational state of": "BOL",
  "brunei": "BRN",
  "brunei darussalam": "BRN",
  "congo brazzaville": "COG",
  "congo democratic republic of the": "COD",
  "cote divoire": "CIV",
  "czech republic": "CZE",
  "czechia": "CZE",
  "eswatini": "SWZ",
  "iran": "IRN",
  "iran islamic republic of": "IRN",
  "korea democratic peoples republic of": "PRK",
  "korea republic of": "KOR",
  "lao peoples democratic republic": "LAO",
  "micronesia federated states of": "FSM",
  "moldova republic of": "MDA",
  "myanmar": "MMR",
  "north macedonia": "MKD",
  "palestine": "PSE",
  "russia": "RUS",
  "russian federation": "RUS",
  "state of palestine": "PSE",
  "swaziland": "SWZ",
  "syria": "SYR",
  "syrian arab republic": "SYR",
  "taiwan": "TWN",
  "tanzania": "TZA",
  "tanzania united republic of": "TZA",
  "the bahamas": "BHS",
  "the gambia": "GMB",
  "turkiye": "TUR",
  "united states": "USA",
  "united states of america": "USA",
  "venezuela": "VEN",
  "venezuela bolivarian republic of": "VEN",
  "viet nam": "VNM",
};

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

export function normalizeLooseText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

export function getProvinceName(properties) {
  return (
    pickString(properties, [
      "name",
      "NAME",
      "name_en",
      "NAME_EN",
      "name_1",
      "NAME_1",
      "province",
      "PROVINCE",
      "region",
      "REGION",
      "adm1_name",
      "ADM1_NAME",
      "gn_name",
      "GN_NAME",
    ]) ?? "Unknown province"
  );
}

export function getProvinceCountryName(properties) {
  return (
    pickString(properties, [
      "admin",
      "ADMIN",
      "adm0_name",
      "ADM0_NAME",
      "country",
      "COUNTRY",
      "country_name",
      "COUNTRY_NAME",
      "geonunit",
      "GEONUNIT",
    ]) ?? "Unknown"
  );
}

export function getProvinceIso3(properties) {
  const value = pickString(properties, [
    "adm0_a3",
    "ADM0_A3",
    "iso_a3",
    "ISO_A3",
    "sov_a3",
    "SOV_A3",
    "gu_a3",
    "GU_A3",
  ]);
  if (!value) {
    return null;
  }
  const normalized = value.toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

export function deriveProvinceId(properties, index) {
  const stableId =
    pickString(properties, ["adm1_code", "ADM1_CODE"]) ??
    pickString(properties, ["iso_3166_2", "ISO_3166_2"]) ??
    pickString(properties, ["code_hasc", "CODE_HASC"]);
  if (stableId) {
    return stableId;
  }

  const countryIso3 = getProvinceIso3(properties) ?? "UNK";
  const provinceName = getProvinceName(properties);
  const fallbackToken =
    properties?.gn_id ??
    properties?.postal ??
    properties?.adm1_code ??
    properties?.iso_3166_2 ??
    properties?.code_hasc ??
    index;

  return `${countryIso3}:${provinceName}:${String(fallbackToken)}`;
}

export async function loadProvinceFeatureCollection() {
  const raw = await readFile(PROVINCES_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new Error("Invalid provinces.geojson: expected a GeoJSON FeatureCollection.");
  }
  return parsed;
}

function buildCountryAliasMap(provinces, canonicalCountriesByIso3 = null) {
  const aliases = new Map();

  for (const province of provinces) {
    if (province.countryIso3) {
      aliases.set(normalizeLooseText(province.countryName), province.countryIso3);
    }
  }

  if (isRecord(canonicalCountriesByIso3)) {
    for (const [iso3, country] of Object.entries(canonicalCountriesByIso3)) {
      if (isRecord(country) && typeof country.name === "string") {
        aliases.set(normalizeLooseText(country.name), iso3);
      }
    }
  }

  for (const [alias, iso3] of Object.entries(COUNTRY_NAME_ALIASES)) {
    aliases.set(alias, iso3);
  }

  return aliases;
}

export function resolveCountryIso3FromNames(countryAliasMap, ...names) {
  for (const name of names) {
    const normalized = normalizeLooseText(name);
    if (!normalized) {
      continue;
    }
    const mapped = countryAliasMap.get(normalized);
    if (mapped) {
      return mapped;
    }
  }
  return null;
}

export async function buildProvinceIndex({ canonicalCountriesByIso3 = null } = {}) {
  const geoJson = await loadProvinceFeatureCollection();
  const provinces = geoJson.features.map((feature, index) => {
    const properties = isRecord(feature.properties) ? feature.properties : {};
    const provinceId = deriveProvinceId(properties, index);
    const provinceName = getProvinceName(properties);
    const countryIso3 = getProvinceIso3(properties);
    const countryName = getProvinceCountryName(properties);
    const areaKm2 = area(feature) / 1_000_000;
    return {
      provinceId,
      provinceName,
      countryIso3,
      countryName,
      areaKm2,
      bbox: bbox(feature),
      feature,
      properties,
    };
  });

  const byId = new Map(provinces.map((province) => [province.provinceId, province]));
  const byCountryIso3 = new Map();
  for (const province of provinces) {
    if (!province.countryIso3) {
      continue;
    }
    if (!byCountryIso3.has(province.countryIso3)) {
      byCountryIso3.set(province.countryIso3, []);
    }
    byCountryIso3.get(province.countryIso3).push(province);
  }

  return {
    geoJson,
    provinces,
    byId,
    byCountryIso3,
    countryAliasToIso3: buildCountryAliasMap(provinces, canonicalCountriesByIso3),
  };
}

function pointWithinBbox([lon, lat], [minLon, minLat, maxLon, maxLat]) {
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

export function matchPointToProvince(coordinates, provinceIndex, preferredCountryIso3 = null) {
  const [lon, lat] = coordinates;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null;
  }

  const searchPool =
    (preferredCountryIso3 && provinceIndex.byCountryIso3.get(preferredCountryIso3)) ?? provinceIndex.provinces;
  const pt = point([lon, lat]);

  for (const province of searchPool) {
    if (!pointWithinBbox([lon, lat], province.bbox)) {
      continue;
    }
    if (booleanPointInPolygon(pt, province.feature)) {
      return province;
    }
  }

  if (preferredCountryIso3) {
    for (const province of provinceIndex.provinces) {
      if (!pointWithinBbox([lon, lat], province.bbox)) {
        continue;
      }
      if (booleanPointInPolygon(pt, province.feature)) {
        return province;
      }
    }
  }

  return null;
}
