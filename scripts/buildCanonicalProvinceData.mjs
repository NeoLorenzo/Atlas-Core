import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProvinceIndex } from "./lib/provinceUtils.mjs";
import { writeJson } from "./lib/ghslSettlement.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SETTLEMENT_STATS_PATH = resolve(__dirname, "..", "public", "data", "province-settlement-stats.json");
const RASTER_SETTLEMENT_STATS_PATH = resolve(
  __dirname,
  "..",
  "public",
  "data",
  "province-raster-settlement-stats.json",
);
const OUTPUT_PATH = resolve(__dirname, "..", "public", "data", "canonical-province-data.json");
const COVERAGE_PATH = resolve(__dirname, "..", "public", "data", "canonical-province-data-coverage.json");

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

async function readJsonOptional(path) {
  try {
    await access(path, fsConstants.F_OK);
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function createEmptySettlement() {
  return {
    urbanCentrePopulationEstimate: buildNullFact(),
    urbanCentrePopulationDensityPerKm2: buildNullFact(),
    urbanCentreBuiltUpAreaKm2: buildNullFact(),
    urbanCentreBuiltUpSharePct: buildNullFact(),
    urbanCentreCount: { value: 0, year: 2025, source: "GHSL GHS-UCDB R2024A" },
    largestUrbanCentreId: null,
    largestUrbanCentreName: null,
    largestUrbanCentrePopulationEstimate: buildNullFact(),
    populationConcentrationHhi: buildNullFact(),
    settlementDataCompleteness: {
      value: "urban-centres-only",
      year: 2025,
      source: "GHSL GHS-UCDB; does not include full raster population or full built-up surface",
    },
    rasterPopulationEstimate: buildNullFact(),
    rasterPopulationDensityPerKm2: buildNullFact(),
    rasterBuiltUpSurfaceKm2: buildNullFact(),
    rasterBuiltUpSurfaceSharePct: buildNullFact(),
    rasterPopulationPerBuiltUpKm2: buildNullFact(),
    nonUrbanCentrePopulationEstimate: buildNullFact(),
    urbanCentrePopulationSharePct: buildNullFact(),
    rasterSettlementDataCompleteness: {
      value: "partial-ghsl-raster",
      year: 2025,
      source: "GHSL GHS-POP R2023A + GHSL GHS-BUILT-S R2023A",
    },
  };
}

function buildDerivedSettlement(urbanSettlement, rasterSettlement) {
  const merged = {
    ...createEmptySettlement(),
    ...(urbanSettlement ?? {}),
    ...(rasterSettlement ?? {}),
  };

  const urbanPopulation = merged.urbanCentrePopulationEstimate?.value;
  const rasterPopulation = merged.rasterPopulationEstimate?.value;
  const hasRasterPopulation = typeof rasterPopulation === "number";
  const urbanPopulationOrZero = typeof urbanPopulation === "number" ? urbanPopulation : 0;

  merged.nonUrbanCentrePopulationEstimate =
    hasRasterPopulation && rasterPopulation > 0
      ? {
          value: roundNumber(Math.max(0, rasterPopulation - urbanPopulationOrZero), 0),
          year: 2025,
          source: "GHSL GHS-POP R2023A + GHSL GHS-UCDB R2024A",
        }
      : buildNullFact();

  merged.urbanCentrePopulationSharePct =
    hasRasterPopulation && rasterPopulation > 0
      ? {
          value: roundNumber((urbanPopulationOrZero / rasterPopulation) * 100, 2),
          year: 2025,
          source: "GHSL GHS-UCDB R2024A + GHSL GHS-POP R2023A",
        }
      : buildNullFact();

  return merged;
}

function computeFieldCoverage(records, fieldName) {
  return roundNumber(
    (records.filter((record) => record.settlement?.[fieldName]?.value !== null).length / records.length) * 100,
    2,
  );
}

async function main() {
  const provinceIndex = await buildProvinceIndex();
  const settlementStats = JSON.parse(await readFile(SETTLEMENT_STATS_PATH, "utf8"));
  const rasterSettlementStats = await readJsonOptional(RASTER_SETTLEMENT_STATS_PATH);

  const canonicalProvinceData = {};
  let provincesWithSettlementData = 0;
  let provincesWithPopulationEstimate = 0;
  let provincesWithUrbanCentre = 0;
  let provincesWithRasterPopulationEstimate = 0;
  let provincesWithRasterBuiltUpSurface = 0;

  for (const province of provinceIndex.provinces) {
    const settlementRecord = settlementStats?.[province.provinceId] ?? null;
    const urbanSettlement = settlementRecord?.settlement ?? null;
    const rasterSettlementRecord = rasterSettlementStats?.[province.provinceId] ?? null;
    const rasterSettlement = rasterSettlementRecord
      ? {
          rasterPopulationEstimate: rasterSettlementRecord.rasterPopulationEstimate ?? buildNullFact(),
          rasterPopulationDensityPerKm2: rasterSettlementRecord.rasterPopulationDensityPerKm2 ?? buildNullFact(),
          rasterBuiltUpSurfaceKm2: rasterSettlementRecord.rasterBuiltUpSurfaceKm2 ?? buildNullFact(),
          rasterBuiltUpSurfaceSharePct: rasterSettlementRecord.rasterBuiltUpSurfaceSharePct ?? buildNullFact(),
          rasterPopulationPerBuiltUpKm2: rasterSettlementRecord.rasterPopulationPerBuiltUpKm2 ?? buildNullFact(),
          rasterSettlementDataCompleteness:
            rasterSettlementRecord.rasterSettlementDataCompleteness ?? createEmptySettlement().rasterSettlementDataCompleteness,
        }
      : null;
    const settlement = buildDerivedSettlement(urbanSettlement, rasterSettlement);

    if (urbanSettlement) {
      provincesWithSettlementData += 1;
    }
    if (settlement.urbanCentrePopulationEstimate.value !== null) {
      provincesWithPopulationEstimate += 1;
    }
    if ((settlement.urbanCentreCount.value ?? 0) > 0) {
      provincesWithUrbanCentre += 1;
    }
    if (settlement.rasterPopulationEstimate.value !== null) {
      provincesWithRasterPopulationEstimate += 1;
    }
    if (settlement.rasterBuiltUpSurfaceKm2.value !== null) {
      provincesWithRasterBuiltUpSurface += 1;
    }

    canonicalProvinceData[province.provinceId] = {
      provinceId: province.provinceId,
      provinceName: province.provinceName,
      countryIso3: province.countryIso3,
      countryName: province.countryName,
      areaKm2: {
        value: Number(province.areaKm2.toFixed(3)),
        year: 2025,
        source: "Derived from Natural Earth province geometry",
      },
      settlement,
    };
  }

  const canonicalProvinceValues = Object.values(canonicalProvinceData);

  const coverage = {
    source: "Natural Earth provinces + GHSL settlement rollup + GHSL raster aggregation",
    generatedAt: new Date().toISOString(),
    provinces: {
      total: provinceIndex.provinces.length,
      withSettlementData: provincesWithSettlementData,
      withUrbanCentrePopulationEstimate: provincesWithPopulationEstimate,
      withUrbanCentre: provincesWithUrbanCentre,
      withRasterPopulationEstimate: provincesWithRasterPopulationEstimate,
      withRasterBuiltUpSurfaceKm2: provincesWithRasterBuiltUpSurface,
      withoutSettlementData: provinceIndex.provinces.length - provincesWithSettlementData,
    },
    countries: {
      total: new Set(provinceIndex.provinces.map((province) => province.countryIso3).filter(Boolean)).size,
      withSettlementData: new Set(
        Object.values(canonicalProvinceData)
          .filter((record) => record.settlement.urbanCentrePopulationEstimate.value !== null && record.countryIso3)
          .map((record) => record.countryIso3),
      ).size,
    },
    fieldCoverage: {
      urbanCentrePopulationEstimate: Number(((provincesWithPopulationEstimate / provinceIndex.provinces.length) * 100).toFixed(2)),
      urbanCentreBuiltUpAreaKm2: Number(
        (
          (canonicalProvinceValues.filter((record) => record.settlement.urbanCentreBuiltUpAreaKm2.value !== null).length /
            provinceIndex.provinces.length) *
          100
        ).toFixed(2),
      ),
      urbanCentreCount: Number(((provincesWithUrbanCentre / provinceIndex.provinces.length) * 100).toFixed(2)),
      populationConcentrationHhi: Number(
        (
          (canonicalProvinceValues.filter((record) => record.settlement.populationConcentrationHhi.value !== null).length /
            provinceIndex.provinces.length) *
          100
        ).toFixed(2),
      ),
      rasterPopulationEstimate: computeFieldCoverage(canonicalProvinceValues, "rasterPopulationEstimate"),
      rasterPopulationDensityPerKm2: computeFieldCoverage(canonicalProvinceValues, "rasterPopulationDensityPerKm2"),
      rasterBuiltUpSurfaceKm2: computeFieldCoverage(canonicalProvinceValues, "rasterBuiltUpSurfaceKm2"),
      rasterBuiltUpSurfaceSharePct: computeFieldCoverage(canonicalProvinceValues, "rasterBuiltUpSurfaceSharePct"),
      rasterPopulationPerBuiltUpKm2: computeFieldCoverage(canonicalProvinceValues, "rasterPopulationPerBuiltUpKm2"),
      nonUrbanCentrePopulationEstimate: computeFieldCoverage(canonicalProvinceValues, "nonUrbanCentrePopulationEstimate"),
      urbanCentrePopulationSharePct: computeFieldCoverage(canonicalProvinceValues, "urbanCentrePopulationSharePct"),
    },
    notes: [
      "Province area is derived from Natural Earth province geometry.",
      "Settlement metrics in this file are urban-centre-only aggregates from matched GHSL UCDB records.",
      "Raster settlement metrics in this file are province-wide GHSL raster aggregates merged alongside UCDB-only fields.",
    ],
    settlementDataCompleteness: {
      value: "urban-centres-only",
      year: 2025,
      source: "GHSL GHS-UCDB; does not include full raster population or full built-up surface",
    },
    rasterSettlementDataCompleteness: {
      value:
        provincesWithRasterPopulationEstimate === provinceIndex.provinces.length &&
        provincesWithRasterBuiltUpSurface === provinceIndex.provinces.length
          ? "full-ghsl-raster"
          : "partial-ghsl-raster",
      year: 2025,
      source: "GHSL GHS-POP R2023A + GHSL GHS-BUILT-S R2023A",
    },
  };

  await writeJson(OUTPUT_PATH, canonicalProvinceData);
  await writeJson(COVERAGE_PATH, coverage);

  console.info(`Wrote ${OUTPUT_PATH}`);
  console.info(`Wrote ${COVERAGE_PATH}`);
  console.info(`Canonical province records: ${Object.keys(canonicalProvinceData).length}`);
}

main().catch((error) => {
  console.error("Failed to build canonical province data.", error);
  process.exitCode = 1;
});
