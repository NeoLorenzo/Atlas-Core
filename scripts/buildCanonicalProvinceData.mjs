import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProvinceIndex } from "./lib/provinceUtils.mjs";
import { writeJson } from "./lib/ghslSettlement.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SETTLEMENT_STATS_PATH = resolve(__dirname, "..", "public", "data", "province-settlement-stats.json");
const OUTPUT_PATH = resolve(__dirname, "..", "public", "data", "canonical-province-data.json");
const COVERAGE_PATH = resolve(__dirname, "..", "public", "data", "canonical-province-data-coverage.json");

async function main() {
  const provinceIndex = await buildProvinceIndex();
  const settlementStats = JSON.parse(await readFile(SETTLEMENT_STATS_PATH, "utf8"));

  const canonicalProvinceData = {};
  let provincesWithSettlementData = 0;
  let provincesWithPopulationEstimate = 0;
  let provincesWithUrbanCentre = 0;

  for (const province of provinceIndex.provinces) {
    const settlementRecord = settlementStats?.[province.provinceId] ?? null;
    const settlement = settlementRecord?.settlement ?? null;
    if (settlement) {
      provincesWithSettlementData += 1;
    }
    if (settlement?.urbanCentrePopulationEstimate?.value !== null) {
      provincesWithPopulationEstimate += 1;
    }
    if ((settlement?.urbanCentreCount?.value ?? 0) > 0) {
      provincesWithUrbanCentre += 1;
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
      settlement:
        settlement ?? {
          urbanCentrePopulationEstimate: { value: null, year: null, source: null },
          urbanCentrePopulationDensityPerKm2: { value: null, year: null, source: null },
          urbanCentreBuiltUpAreaKm2: { value: null, year: null, source: null },
          urbanCentreBuiltUpSharePct: { value: null, year: null, source: null },
          urbanCentreCount: { value: 0, year: 2025, source: "GHSL GHS-UCDB R2024A" },
          largestUrbanCentreId: null,
          largestUrbanCentreName: null,
          largestUrbanCentrePopulationEstimate: { value: null, year: null, source: null },
          populationConcentrationHhi: { value: null, year: null, source: null },
          settlementDataCompleteness: {
            value: "urban-centres-only",
            year: 2025,
            source: "GHSL GHS-UCDB; does not include full raster population or full built-up surface",
          },
        },
    };
  }

  const coverage = {
    source: "Natural Earth provinces + GHSL settlement rollup",
    generatedAt: new Date().toISOString(),
    provinces: {
      total: provinceIndex.provinces.length,
      withSettlementData: provincesWithSettlementData,
      withUrbanCentrePopulationEstimate: provincesWithPopulationEstimate,
      withUrbanCentre: provincesWithUrbanCentre,
      withoutSettlementData: provinceIndex.provinces.length - provincesWithUrbanCentre,
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
          (Object.values(canonicalProvinceData).filter((record) => record.settlement.urbanCentreBuiltUpAreaKm2.value !== null).length /
            provinceIndex.provinces.length) *
          100
        ).toFixed(2),
      ),
      urbanCentreCount: Number(((provincesWithUrbanCentre / provinceIndex.provinces.length) * 100).toFixed(2)),
      populationConcentrationHhi: Number(
        (
          (Object.values(canonicalProvinceData).filter(
            (record) => record.settlement.populationConcentrationHhi.value !== null,
          ).length /
            provinceIndex.provinces.length) *
          100
        ).toFixed(2),
      ),
    },
    notes: [
      "Province area is derived from Natural Earth province geometry.",
      "Settlement metrics in this file are urban-centre-only aggregates from matched GHSL UCDB records.",
    ],
    settlementDataCompleteness: {
      value: "urban-centres-only",
      year: 2025,
      source: "GHSL GHS-UCDB; does not include full raster population or full built-up surface",
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
