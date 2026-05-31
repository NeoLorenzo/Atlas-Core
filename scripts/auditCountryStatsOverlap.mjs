import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WDI_PATH = resolve(__dirname, "..", "public", "data", "country-stats.json");
const WGI_PATH = resolve(__dirname, "..", "public", "data", "governance-stats.json");
const IMF_PATH = resolve(__dirname, "..", "public", "data", "imf-weo-stats.json");
const OUTPUT_PATH = resolve(__dirname, "..", "public", "data", "stats-overlap-audit.json");

const OVERLAPS = [
  {
    canonicalMetric: "gdpCurrentUsd",
    wdi: { key: "gdpCurrentUsd", yearKey: "gdpCurrentUsd" },
    imf: { key: "gdpCurrentUsdBillions", yearKey: "gdpCurrentUsdBillions", multiplier: 1_000_000_000 },
  },
  {
    canonicalMetric: "gdpPerCapitaCurrentUsd",
    wdi: { key: "gdpPerCapitaCurrentUsd", yearKey: "gdpPerCapitaCurrentUsd" },
    imf: { key: "gdpPerCapitaCurrentUsd", yearKey: "gdpPerCapitaCurrentUsd" },
  },
  {
    canonicalMetric: "gdpGrowthAnnualPct",
    wdi: { key: "gdpGrowthAnnualPct", yearKey: "gdpGrowthAnnualPct" },
    imf: { key: "realGdpGrowthPct", yearKey: "realGdpGrowthPct" },
  },
  {
    canonicalMetric: "inflationAnnualPct",
    wdi: { key: "inflationConsumerAnnualPct", yearKey: "inflationConsumerAnnualPct" },
    imf: { key: "inflationAverageConsumerPricesPct", yearKey: "inflationAverageConsumerPricesPct" },
  },
];

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function readJson(path) {
  return readFile(path, "utf8").then((raw) => JSON.parse(raw));
}

function getCountryName(iso3, wdi, imf) {
  return wdi?.countriesByIso3?.[iso3]?.name ?? imf?.countriesByIso3?.[iso3]?.name ?? iso3;
}

function getNumeric(record, key, multiplier = 1) {
  const value = record?.indicators?.[key];
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return value * multiplier;
}

function getYear(record, key) {
  const value = record?.indicatorYears?.[key];
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return value;
}

function summarizeYears(years) {
  if (years.length === 0) {
    return { average: null, latest: null };
  }

  const total = years.reduce((sum, year) => sum + year, 0);
  return {
    average: Number((total / years.length).toFixed(2)),
    latest: Math.max(...years),
  };
}

async function main() {
  const [wdi, wgi, imf] = await Promise.all([readJson(WDI_PATH), readJson(WGI_PATH), readJson(IMF_PATH)]);

  if (!isRecord(wdi?.countriesByIso3) || !isRecord(imf?.countriesByIso3) || !isRecord(wgi?.countriesByIso3)) {
    throw new Error("Expected country-stats.json, governance-stats.json, and imf-weo-stats.json to contain countriesByIso3");
  }

  const allIso3 = Array.from(
    new Set([
      ...Object.keys(wdi.countriesByIso3),
      ...Object.keys(imf.countriesByIso3),
      ...Object.keys(wgi.countriesByIso3),
    ]),
  ).sort();

  const metrics = {};

  for (const overlap of OVERLAPS) {
    const wdiYears = [];
    const imfYears = [];
    let wdiCount = 0;
    let imfCount = 0;
    let wdiNewer = 0;
    let imfNewer = 0;
    let bothExist = 0;
    let onlyWdi = 0;
    let onlyImf = 0;

    for (const iso3 of allIso3) {
      const wdiRecord = wdi.countriesByIso3[iso3];
      const imfRecord = imf.countriesByIso3[iso3];

      const wdiValue = getNumeric(wdiRecord, overlap.wdi.key);
      const imfValue = getNumeric(imfRecord, overlap.imf.key, overlap.imf.multiplier ?? 1);
      const wdiYear = getYear(wdiRecord, overlap.wdi.yearKey);
      const imfYear = getYear(imfRecord, overlap.imf.yearKey);

      if (wdiValue !== null) {
        wdiCount += 1;
        if (wdiYear !== null) {
          wdiYears.push(wdiYear);
        }
      }

      if (imfValue !== null) {
        imfCount += 1;
        if (imfYear !== null) {
          imfYears.push(imfYear);
        }
      }

      if (wdiValue !== null && imfValue !== null) {
        bothExist += 1;
        if (wdiYear !== null && imfYear !== null) {
          if (wdiYear > imfYear) {
            wdiNewer += 1;
          } else if (imfYear > wdiYear) {
            imfNewer += 1;
          }
        }
      } else if (wdiValue !== null) {
        onlyWdi += 1;
      } else if (imfValue !== null) {
        onlyImf += 1;
      }
    }

    metrics[overlap.canonicalMetric] = {
      canonicalMetric: overlap.canonicalMetric,
      comparedSources: {
        wdi: overlap.wdi.key,
        imf: overlap.imf.key,
      },
      totals: {
        countriesWithWdiValue: wdiCount,
        countriesWithImfValue: imfCount,
        countriesWhereBothExist: bothExist,
        countriesWhereOnlyWdiExists: onlyWdi,
        countriesWhereOnlyImfExists: onlyImf,
      },
      years: {
        wdi: summarizeYears(wdiYears),
        imf: summarizeYears(imfYears),
      },
      recencyComparison: {
        countriesWhereWdiIsNewer: wdiNewer,
        countriesWhereImfIsNewer: imfNewer,
      },
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    gameStartDate: "2025-01-01",
    totalCountriesConsidered: allIso3.length,
    metrics,
  };

  await mkdir(resolve(__dirname, "..", "public", "data"), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.info("=== Country Stats Overlap Audit ===");
  console.info(`Countries considered: ${allIso3.length}`);

  for (const overlap of OVERLAPS) {
    const result = metrics[overlap.canonicalMetric];
    console.info(`\n${overlap.canonicalMetric}`);
    console.info(`  WDI (${overlap.wdi.key}) coverage: ${result.totals.countriesWithWdiValue}`);
    console.info(`  IMF (${overlap.imf.key}) coverage: ${result.totals.countriesWithImfValue}`);
    console.info(`  Both: ${result.totals.countriesWhereBothExist}`);
    console.info(`  WDI only: ${result.totals.countriesWhereOnlyWdiExists}`);
    console.info(`  IMF only: ${result.totals.countriesWhereOnlyImfExists}`);
    console.info(`  WDI newer: ${result.recencyComparison.countriesWhereWdiIsNewer}`);
    console.info(`  IMF newer: ${result.recencyComparison.countriesWhereImfIsNewer}`);
    console.info(`  WDI avg/latest year: ${result.years.wdi.average ?? "n/a"}/${result.years.wdi.latest ?? "n/a"}`);
    console.info(`  IMF avg/latest year: ${result.years.imf.average ?? "n/a"}/${result.years.imf.latest ?? "n/a"}`);
  }

  console.info(`\nWrote ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error("Failed to audit country stats overlap.", error);
  process.exitCode = 1;
});
