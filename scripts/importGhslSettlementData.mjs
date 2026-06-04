import {
  PROVINCE_SETTLEMENT_STATS_COVERAGE_PATH,
  PROVINCE_SETTLEMENT_STATS_PATH,
  buildProvinceSettlementDataset,
  buildUrbanCentresDataset,
  writeJson,
} from "./lib/ghslSettlement.mjs";

async function main() {
  const { provinceIndex, urbanCentresById } = await buildUrbanCentresDataset();
  const { provinceRecords, coverage } = buildProvinceSettlementDataset(provinceIndex, urbanCentresById);

  await writeJson(PROVINCE_SETTLEMENT_STATS_PATH, provinceRecords);
  await writeJson(PROVINCE_SETTLEMENT_STATS_COVERAGE_PATH, coverage);

  console.info(`Wrote ${PROVINCE_SETTLEMENT_STATS_PATH}`);
  console.info(`Wrote ${PROVINCE_SETTLEMENT_STATS_COVERAGE_PATH}`);
  console.info(`Province settlement records: ${Object.keys(provinceRecords).length}`);
}

main().catch((error) => {
  console.error("Failed to import GHSL settlement data.", error);
  process.exitCode = 1;
});
