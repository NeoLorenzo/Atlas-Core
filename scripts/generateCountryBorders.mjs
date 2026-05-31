import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COUNTRY_KEY_CANDIDATES = [
  "admin",
  "ADMIN",
  "adm0_name",
  "ADM0_NAME",
  "country",
  "COUNTRY",
  "country_name",
  "COUNTRY_NAME",
  "name_0",
  "NAME_0",
  "geonunit",
  "GEONUNIT",
  "adm0_a3",
  "ADM0_A3",
  "sov_a3",
  "SOV_A3",
  "__countryKey",
];

function getCountryKey(properties) {
  const props = properties && typeof properties === "object" ? properties : {};
  for (const key of COUNTRY_KEY_CANDIDATES) {
    const value = props[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "Unknown";
}

function normalizeFeatures(rawFeatures) {
  return rawFeatures
    .filter(
      (feature) =>
        feature &&
        feature.type === "Feature" &&
        feature.geometry &&
        (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon"),
    )
    .map((feature, index) => {
      const properties = feature.properties && typeof feature.properties === "object" ? feature.properties : {};
      const countryKey = getCountryKey(properties);
      return {
        ...feature,
        id: feature.id ?? `province-${index}`,
        properties: {
          ...properties,
          __countryKey: countryKey,
        },
      };
    });
}

async function main() {
  const inputPath = resolve(__dirname, "..", "public", "data", "provinces.geojson");
  const outputPath = resolve(__dirname, "..", "public", "data", "country-borders.geojson");

  const raw = await readFile(inputPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new Error("Invalid provinces.geojson. Expected a FeatureCollection.");
  }

  const normalizedFeatures = normalizeFeatures(parsed.features);
  if (normalizedFeatures.length === 0) {
    throw new Error("No polygon features found in provinces.geojson.");
  }

  const featuresByCountry = new Map();
  for (const feature of normalizedFeatures) {
    const countryKey = feature.properties.__countryKey;
    if (!featuresByCountry.has(countryKey)) {
      featuresByCountry.set(countryKey, []);
    }
    featuresByCountry.get(countryKey).push(feature);
  }

  const dissolvedFeatures = [];
  for (const [countryKey, features] of featuresByCountry.entries()) {
    if (features.length === 1) {
      dissolvedFeatures.push({
        ...features[0],
        properties: { __countryKey: countryKey },
      });
      continue;
    }

    let mergedFeature = null;
    try {
      mergedFeature = turf.union(
        turf.featureCollection(features),
      );
    } catch (error) {
      console.warn(`Union failed for ${countryKey}; falling back to combined geometry.`, error);
    }

    if (!mergedFeature) {
      const combined = turf.combine(turf.featureCollection(features));
      const fallbackFeature = combined.features[0];
      mergedFeature = {
        ...fallbackFeature,
        properties: { __countryKey: countryKey },
      };
    }

    dissolvedFeatures.push({
      ...mergedFeature,
      properties: { __countryKey: countryKey },
    });
  }

  const output = {
    type: "FeatureCollection",
    name: "country_borders_derived_from_provinces",
    metadata: {
      source: "Derived from public/data/provinces.geojson",
      generatedAt: new Date().toISOString(),
      countryCount: dissolvedFeatures.length,
    },
    features: dissolvedFeatures,
  };

  await writeFile(outputPath, `${JSON.stringify(output)}\n`, "utf8");

  console.info(`Wrote ${outputPath}`);
  console.info(`Countries dissolved: ${output.features.length}`);
  console.info(`Input provinces used: ${normalizedFeatures.length}`);
}

main().catch((error) => {
  console.error("Failed to generate country borders from provinces.geojson.", error);
  process.exitCode = 1;
});
