import {
  URBAN_CENTRES_COVERAGE_PATH,
  URBAN_CENTRES_PATH,
  buildUrbanCentresDataset,
  writeJson,
} from "./lib/ghslSettlement.mjs";

async function main() {
  const { urbanCentresById, coverage } = await buildUrbanCentresDataset();

  await writeJson(URBAN_CENTRES_PATH, urbanCentresById);
  await writeJson(URBAN_CENTRES_COVERAGE_PATH, coverage);

  console.info(`Wrote ${URBAN_CENTRES_PATH}`);
  console.info(`Wrote ${URBAN_CENTRES_COVERAGE_PATH}`);
  console.info(`Urban centres processed: ${Object.keys(urbanCentresById).length}`);
}

main().catch((error) => {
  console.error("Failed to build GHSL urban centres dataset.", error);
  process.exitCode = 1;
});
