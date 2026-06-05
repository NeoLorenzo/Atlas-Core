import {
  PROVINCE_RASTER_SETTLEMENT_STATS_COVERAGE_PATH,
  PROVINCE_RASTER_SETTLEMENT_STATS_PARTIAL_PATH,
  PROVINCE_RASTER_SETTLEMENT_STATS_PATH,
  PROVINCE_RASTER_SETTLEMENT_STATS_PROGRESS_PATH,
  buildProvinceRasterSettlementDataset,
  cleanupProvinceRasterProgressArtifacts,
  writeJson,
} from "./lib/ghslRaster.mjs";

async function main() {
  const { provinceRecords, coverage } = await buildProvinceRasterSettlementDataset();

  await writeJson(PROVINCE_RASTER_SETTLEMENT_STATS_PATH, provinceRecords);
  await writeJson(PROVINCE_RASTER_SETTLEMENT_STATS_COVERAGE_PATH, coverage);
  await cleanupProvinceRasterProgressArtifacts();

  console.info(`[GHSL Raster] Wrote final stats: ${PROVINCE_RASTER_SETTLEMENT_STATS_PATH}`);
  console.info(`[GHSL Raster] Wrote final coverage: ${PROVINCE_RASTER_SETTLEMENT_STATS_COVERAGE_PATH}`);
  console.info(`[GHSL Raster] Removed checkpoint files: ${PROVINCE_RASTER_SETTLEMENT_STATS_PARTIAL_PATH}`);
  console.info(`[GHSL Raster] Removed checkpoint files: ${PROVINCE_RASTER_SETTLEMENT_STATS_PROGRESS_PATH}`);
  console.info(`[GHSL Raster] Province raster settlement records: ${Object.keys(provinceRecords).length}`);
  console.info(
    `[GHSL Raster] Final coverage summary: matched=${coverage.provinces.matched}/${coverage.provinces.total}, skipped=${coverage.provinces.skipped}, populationCoverage=${coverage.fieldCoverage.rasterPopulationEstimate.pct}%, builtCoverage=${coverage.fieldCoverage.rasterBuiltUpSurfaceKm2.pct}%`,
  );
}

main().catch((error) => {
  console.error("Failed to import GHSL raster settlement data.", error);
  process.exitCode = 1;
});
