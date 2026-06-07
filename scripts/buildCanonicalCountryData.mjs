import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WDI_PATH = resolve(__dirname, "..", "public", "data", "country-stats.json");
const WGI_PATH = resolve(__dirname, "..", "public", "data", "governance-stats.json");
const IMF_PATH = resolve(__dirname, "..", "public", "data", "imf-weo-stats.json");
const WPP_PATH = resolve(__dirname, "..", "public", "data", "un-wpp-demographics.json");
const ATLAS_PATH = resolve(__dirname, "..", "public", "data", "atlas-trade-profiles.json");
const FACTBOOK_PATH = resolve(__dirname, "..", "public", "data", "factbook-political-profiles.json");
const SECURITY_PATH = resolve(__dirname, "..", "public", "data", "security-stats.json");
const HEALTH_PATH = resolve(__dirname, "..", "public", "data", "health-stats.json");
const PUBLIC_HEALTH_ENVIRONMENT_PATH = resolve(
  __dirname,
  "..",
  "public",
  "data",
  "public-health-environment-stats.json",
);
const WHO_IHR_SPAR_PATH = resolve(__dirname, "..", "public", "data", "who-ihr-spar-stats.json");
const URBAN_CENTRES_PATH = resolve(__dirname, "..", "public", "data", "urban-centres.json");
const CANONICAL_PROVINCE_PATH = resolve(__dirname, "..", "public", "data", "canonical-province-data.json");
const INFRASTRUCTURE_CONNECTIONS_PATH = resolve(
  __dirname,
  "..",
  "public",
  "data",
  "infrastructure-connections.json",
);

const OUTPUT_PATH = process.env.CANONICAL_COUNTRY_OUTPUT_PATH
  ? resolve(process.env.CANONICAL_COUNTRY_OUTPUT_PATH)
  : resolve(__dirname, "..", "public", "data", "canonical-country-data.json");
const COVERAGE_PATH = process.env.CANONICAL_COUNTRY_COVERAGE_PATH
  ? resolve(process.env.CANONICAL_COUNTRY_COVERAGE_PATH)
  : resolve(__dirname, "..", "public", "data", "canonical-country-data-coverage.json");

const OVERLAP_CONFIG = {
  gdpCurrentUsd: {
    wdi: "gdpCurrentUsd",
    imf: "gdpCurrentUsdBillions",
    imfMultiplier: 1_000_000_000,
    defaultPreference: "IMF WEO / DataMapper",
  },
  gdpPerCapitaCurrentUsd: {
    wdi: "gdpPerCapitaCurrentUsd",
    imf: "gdpPerCapitaCurrentUsd",
    defaultPreference: "IMF WEO / DataMapper",
  },
  gdpGrowthAnnualPct: {
    wdi: "gdpGrowthAnnualPct",
    imf: "realGdpGrowthPct",
    defaultPreference: "IMF WEO / DataMapper",
  },
  inflationAnnualPct: {
    wdi: "inflationConsumerAnnualPct",
    imf: "inflationAverageConsumerPricesPct",
    defaultPreference: "IMF WEO / DataMapper",
  },
};

const GOVERNANCE_KEYS = [
  "voiceAndAccountability",
  "politicalStability",
  "governmentEffectiveness",
  "regulatoryQuality",
  "ruleOfLaw",
  "controlOfCorruption",
];

const TRADE_STRUCTURE_KEYS = [
  "totalExportsUsd",
  "totalImportsUsd",
  "tradeBalanceUsd",
  "exportDiversityProductCount",
  "importDiversityProductCount",
  "exportConcentrationHhi",
  "importConcentrationHhi",
  "economicComplexityIndex",
];

const SECURITY_KEYS = [
  "militaryExpenditureUsd",
  "militaryExpenditurePctOfGdp",
  "militaryExpenditurePctOfGovtExpenditure",
  "armedForcesPersonnel",
  "armedForcesPctOfLaborForce",
  "armsImportsSipriTiv",
  "armsExportsSipriTiv",
  "militarySpendPerCapitaUsd",
  "militarySpendPerSoldierUsd",
  "mobilizationBasePct",
];

const HEALTH_KEYS = [
  "hospitalBedsPer1000",
  "physiciansPer1000",
  "nursesMidwivesPer1000",
  "currentHealthExpenditurePerCapitaUsd",
  "currentHealthExpenditurePctOfGdp",
  "healthCapacityScore",
  "medicalWorkforceScore",
  "hospitalSurgeCapacityScore",
  "outbreakTreatmentScore",
  "healthDataFreshnessScore",
  "healthFieldCoverageScore",
  "healthCapacityScoreConfidence",
];

const PUBLIC_HEALTH_ENVIRONMENT_KEYS = [
  "safelyManagedDrinkingWaterPct",
  "safelyManagedSanitationPct",
  "basicHandwashingFacilitiesPct",
  "accessToElectricityPct",
  "ruralElectricityAccessPct",
  "urbanElectricityAccessPct",
  "cleanCookingFuelAccessPct",
  "publicHealthEnvironmentScore",
  "waterborneDiseaseRiskScore",
  "hygieneTransmissionRiskScore",
  "serviceReliabilityScore",
  "publicHealthEnvironmentFieldCoverageScore",
  "publicHealthEnvironmentFreshnessScore",
  "publicHealthEnvironmentScoreConfidence",
];

const HEALTH_EMERGENCY_PREPAREDNESS_KEYS = [
  "ihrSparAverageScore",
  "outbreakPreparednessScore",
  "outbreakPreparednessScoreConfidence",
];

const POLITICAL_SYSTEM_TEXT_KEYS = [
  "governmentType",
  "capital",
  "administrativeDivisions",
  "independence",
  "constitution",
  "legalSystem",
  "suffrage",
  "executiveBranch",
  "legislativeBranch",
  "judicialBranch",
  "politicalPartiesAndLeaders",
  "electionsAppointments",
  "internationalOrganizationParticipation",
  "governmentFamily",
  "monarchyType",
  "legislatureType",
  "headOfStateTitle",
  "headOfGovernmentTitle",
];

const POLITICAL_SYSTEM_BOOLEAN_KEYS = [
  "hasMonarchy",
  "hasParliament",
  "hasElections",
  "hasUniversalSuffrage",
  "isFederal",
  "isRepublic",
  "isOnePartyState",
  "isMilitaryRegime",
];

const CANONICAL_KEYS = {
  economy: [
    "population",
    "gdpCurrentUsd",
    "gdpPerCapitaCurrentUsd",
    "gdpGrowthAnnualPct",
    "inflationAnnualPct",
    "unemploymentPct",
    "urbanPopulationPct",
    "lifeExpectancyYears",
    "tradePctOfGdp",
  ],
  demographics: [
    "medianAgeYears",
    "fertilityRateBirthsPerWoman",
    "populationGrowthRatePct",
    "netMigration",
    "youthSharePct",
    "workingAgeSharePct",
    "elderlySharePct",
    "childDependencyRatio",
    "oldAgeDependencyRatio",
    "totalDependencyRatio",
  ],
  fiscal: [
    "currentAccountBalancePctOfGdp",
    "governmentNetLendingBorrowingPctOfGdp",
    "governmentGrossDebtPctOfGdp",
  ],
  governance: GOVERNANCE_KEYS,
  tradeStructure: TRADE_STRUCTURE_KEYS,
  security: SECURITY_KEYS,
  healthSystem: HEALTH_KEYS,
  publicHealthEnvironment: PUBLIC_HEALTH_ENVIRONMENT_KEYS,
  healthEmergencyPreparedness: HEALTH_EMERGENCY_PREPAREDNESS_KEYS,
};

const HEALTH_RAW_SOURCE = "World Bank WDI / WHO";
const HEALTH_DERIVED_SOURCE = "Derived from World Bank WDI / WHO health indicators";
const OUTBREAK_DERIVED_SOURCE =
  "Derived from World Bank WDI / WHO health indicators, World Bank WGI, and infrastructure connectivity";
const HEALTH_CONFIDENCE_SOURCE =
  "Derived from World Bank WDI / WHO health indicator coverage and selected years";
const PUBLIC_HEALTH_ENVIRONMENT_DERIVED_SOURCE =
  "Atlas Core derived from World Bank public health environment indicators";
const HEALTH_EMERGENCY_PREPAREDNESS_RAW_SOURCE = "WHO GHO / IHR SPAR second edition";
const HEALTH_EMERGENCY_PREPAREDNESS_DERIVED_SOURCE =
  "Atlas Core derived from WHO GHO IHR SPAR second edition";

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function readJson(path) {
  return readFile(path, "utf8").then((raw) => JSON.parse(raw));
}

async function readJsonOptional(path) {
  try {
    await access(path, fsConstants.F_OK);
    return readJson(path);
  } catch {
    return null;
  }
}

function getValue(record, key, multiplier = 1) {
  const value = record?.indicators?.[key];
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return value * multiplier;
}

function getYear(record, key) {
  const year = record?.indicatorYears?.[key];
  if (typeof year !== "number" || Number.isNaN(year)) {
    return null;
  }
  return year;
}

function makeDataPoint(value, year, source) {
  if (value === null || year === null || !source) {
    return { value: null, year: null, source: null };
  }
  return { value, year, source };
}

function makeTextDataPoint(value, source) {
  if (typeof value !== "string" || value.trim().length === 0 || !source) {
    return { value: null, source: null };
  }
  return { value: value.trim(), source };
}

function makeBooleanDataPoint(value, source) {
  if (typeof value !== "boolean" || !source) {
    return { value: null, source: null };
  }
  return { value, source };
}

function getSecurityFact(record, key) {
  const fact = record?.security?.[key];
  if (!isRecord(fact)) {
    return null;
  }

  const value = typeof fact.value === "number" && Number.isFinite(fact.value) ? fact.value : null;
  const year = typeof fact.year === "number" && Number.isFinite(fact.year) ? fact.year : null;
  const source = typeof fact.source === "string" && fact.source.length > 0 ? fact.source : null;
  if (value === null || year === null || source === null) {
    return null;
  }

  return { value, year, source };
}

function getSecurityDataPoint(record, key) {
  const fact = getSecurityFact(record, key);
  if (!fact) {
    return makeDataPoint(null, null, null);
  }
  return makeDataPoint(fact.value, fact.year, fact.source);
}

function getHealthFact(record, key) {
  const fact = record?.healthSystem?.[key];
  if (!isRecord(fact)) {
    return null;
  }

  const value = typeof fact.value === "number" && Number.isFinite(fact.value) ? fact.value : null;
  const year = typeof fact.year === "number" && Number.isFinite(fact.year) ? fact.year : null;
  const source = typeof fact.source === "string" && fact.source.length > 0 ? fact.source : null;
  if (value === null || year === null || source === null) {
    return null;
  }

  return { value, year, source };
}

function getHealthDataPoint(record, key) {
  const fact = getHealthFact(record, key);
  if (!fact) {
    return makeDataPoint(null, null, null);
  }
  return makeDataPoint(fact.value, fact.year, fact.source);
}

function getPublicHealthEnvironmentFact(record, key) {
  const fact = record?.publicHealthEnvironment?.[key];
  if (!isRecord(fact)) {
    return null;
  }

  const value = typeof fact.value === "number" && Number.isFinite(fact.value) ? fact.value : null;
  const year = typeof fact.year === "number" && Number.isFinite(fact.year) ? fact.year : null;
  const source = typeof fact.source === "string" && fact.source.length > 0 ? fact.source : null;
  if (value === null || year === null || source === null) {
    return null;
  }

  return { value, year, source };
}

function getPublicHealthEnvironmentDataPoint(record, key) {
  const fact = getPublicHealthEnvironmentFact(record, key);
  if (!fact) {
    return makeDataPoint(null, null, null);
  }
  return makeDataPoint(fact.value, fact.year, fact.source);
}

function getHealthEmergencyPreparednessFact(record, key) {
  const fact = record?.[key];
  if (!isRecord(fact)) {
    return null;
  }

  const value = typeof fact.value === "number" && Number.isFinite(fact.value) ? fact.value : null;
  const year = typeof fact.year === "number" && Number.isFinite(fact.year) ? fact.year : null;
  const source = typeof fact.source === "string" && fact.source.length > 0 ? fact.source : null;
  if (value === null || year === null || source === null) {
    return null;
  }

  return { value, year, source };
}

function getHealthEmergencyPreparednessDataPoint(record, key) {
  const fact = getHealthEmergencyPreparednessFact(record, key);
  if (!fact) {
    return makeDataPoint(null, null, null);
  }
  return makeDataPoint(fact.value, fact.year, fact.source);
}

function makeDerivedSecurityDataPoint(value, year, source) {
  if (typeof value !== "number" || !Number.isFinite(value) || year === null || !source) {
    return makeDataPoint(null, null, null);
  }
  return makeDataPoint(value, year, source);
}

function makeDerivedScoreDataPoint(value, source) {
  if (typeof value !== "number" || !Number.isFinite(value) || !source) {
    return makeDataPoint(null, null, null);
  }
  return { value: roundNumber(clamp(value, 0, 100), 2), year: null, source };
}

function makeDerivedScoreDataPointWithYear(value, year, source) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(year) || !source) {
    return makeDataPoint(null, null, null);
  }
  return makeDataPoint(roundNumber(clamp(value, 0, 100), 2), year, source);
}

function derivePerCapitaPoint(numerator, denominator, source) {
  if (!numerator || !denominator || denominator.value <= 0) {
    return makeDataPoint(null, null, null);
  }

  return makeDerivedSecurityDataPoint(
    numerator.value / denominator.value,
    numerator.year,
    source,
  );
}

function deriveMobilizationBasePoint(personnel, population, source) {
  if (!personnel || !population || population.value <= 0) {
    return makeDataPoint(null, null, null);
  }

  return makeDerivedSecurityDataPoint(
    (personnel.value / population.value) * 100,
    personnel.year,
    source,
  );
}

function pickOverlapDataPoint(wdiRecord, imfRecord, config, coverageSummary) {
  const wdiValue = getValue(wdiRecord, config.wdi);
  const wdiYear = getYear(wdiRecord, config.wdi);

  const imfValue = getValue(imfRecord, config.imf, config.imfMultiplier ?? 1);
  const imfYear = getYear(imfRecord, config.imf);

  const hasWdi = wdiValue !== null;
  const hasImf = imfValue !== null;

  if (!hasWdi && !hasImf) {
    return makeDataPoint(null, null, null);
  }
  if (hasWdi && !hasImf) {
    return makeDataPoint(wdiValue, wdiYear, "World Bank WDI");
  }
  if (!hasWdi && hasImf) {
    return makeDataPoint(imfValue, imfYear, "IMF WEO / DataMapper");
  }

  if (wdiYear !== null && imfYear !== null && wdiYear !== imfYear) {
    if (wdiYear > imfYear) {
      return makeDataPoint(wdiValue, wdiYear, "World Bank WDI");
    }
    return makeDataPoint(imfValue, imfYear, "IMF WEO / DataMapper");
  }

  const wdiCoverage = coverageSummary.wdi[config.wdi] ?? 0;
  const imfCoverage = coverageSummary.imf[config.imf] ?? 0;

  if (wdiCoverage > imfCoverage) {
    return makeDataPoint(wdiValue, wdiYear, "World Bank WDI");
  }
  if (imfCoverage > wdiCoverage) {
    return makeDataPoint(imfValue, imfYear, "IMF WEO / DataMapper");
  }

  if (config.defaultPreference === "World Bank WDI") {
    return makeDataPoint(wdiValue, wdiYear, "World Bank WDI");
  }
  return makeDataPoint(imfValue, imfYear, "IMF WEO / DataMapper");
}

function computeCoverageCounts(recordsByIso3, keys) {
  const counts = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const record of Object.values(recordsByIso3)) {
    for (const key of keys) {
      const value = record?.indicators?.[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        counts[key] += 1;
      }
    }
  }
  return counts;
}

function getCountryName(
  iso3,
  wdi,
  imf,
  wgi,
  wpp,
  atlas,
  factbook,
  security,
  health,
  publicHealthEnvironment,
  healthEmergencyPreparedness,
) {
  return (
    wdi?.countriesByIso3?.[iso3]?.name ??
    imf?.countriesByIso3?.[iso3]?.name ??
    wgi?.countriesByIso3?.[iso3]?.name ??
    wpp?.countriesByIso3?.[iso3]?.name ??
    atlas?.countriesByIso3?.[iso3]?.name ??
    factbook?.countriesByIso3?.[iso3]?.name ??
    security?.countriesByIso3?.[iso3]?.name ??
    health?.countriesByIso3?.[iso3]?.name ??
    publicHealthEnvironment?.[iso3]?.countryName ??
    healthEmergencyPreparedness?.[iso3]?.countryName ??
    iso3
  );
}

function getAtlasIndicatorValue(record, key) {
  const value = record?.indicators?.[key];
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return value;
}

function getAtlasIndicatorYear(record) {
  return typeof record?.year === "number" && Number.isFinite(record.year) ? record.year : null;
}

function getAtlasTopArray(record, key) {
  const value = record?.[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => isRecord(entry) && typeof entry.productCode === "string")
    .map((entry) => ({
      productCode: entry.productCode,
      productName: typeof entry.productName === "string" ? entry.productName : null,
      exportValueUsd: typeof entry.exportValueUsd === "number" ? entry.exportValueUsd : undefined,
      importValueUsd: typeof entry.importValueUsd === "number" ? entry.importValueUsd : undefined,
      shareOfExportsPct: typeof entry.shareOfExportsPct === "number" ? entry.shareOfExportsPct : undefined,
      shareOfImportsPct: typeof entry.shareOfImportsPct === "number" ? entry.shareOfImportsPct : undefined,
    }))
    .map((entry) => {
      const clean = {
        productCode: entry.productCode,
        productName: entry.productName,
      };
      if (entry.exportValueUsd !== undefined) {
        clean.exportValueUsd = entry.exportValueUsd;
      }
      if (entry.importValueUsd !== undefined) {
        clean.importValueUsd = entry.importValueUsd;
      }
      if (entry.shareOfExportsPct !== undefined) {
        clean.shareOfExportsPct = entry.shareOfExportsPct;
      }
      if (entry.shareOfImportsPct !== undefined) {
        clean.shareOfImportsPct = entry.shareOfImportsPct;
      }
      return clean;
    });
}

function getNumericFactValue(fact) {
  return typeof fact?.value === "number" && Number.isFinite(fact.value) ? fact.value : null;
}

function getBooleanFactValue(fact) {
  return typeof fact?.value === "boolean" ? fact.value : null;
}

function sumNumbers(values) {
  return values.reduce((sum, value) => sum + value, 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundNumber(value, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function getPointValue(point) {
  return typeof point?.value === "number" && Number.isFinite(point.value) ? point.value : null;
}

function quantile(sortedValues, percentile) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
    return null;
  }

  const position = clamp(percentile, 0, 1) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lowerValue = sortedValues[lowerIndex];
  const upperValue = sortedValues[upperIndex];

  if (!Number.isFinite(lowerValue) || !Number.isFinite(upperValue)) {
    return null;
  }

  if (lowerIndex === upperIndex) {
    return lowerValue;
  }

  const fraction = position - lowerIndex;
  return lowerValue + (upperValue - lowerValue) * fraction;
}

function buildNormalizer(values) {
  const cleaned = values
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);

  if (cleaned.length < 2) {
    return () => null;
  }

  const minValue = cleaned[0];
  const maxValue = cleaned[cleaned.length - 1];
  if (minValue === maxValue) {
    return () => null;
  }

  const lowerBound = quantile(cleaned, 0.05) ?? minValue;
  const upperBound = quantile(cleaned, 0.95) ?? maxValue;
  const boundedMin = Number.isFinite(lowerBound) ? lowerBound : minValue;
  const boundedMax = Number.isFinite(upperBound) ? upperBound : maxValue;
  const effectiveMin = boundedMin < boundedMax ? boundedMin : minValue;
  const effectiveMax = boundedMin < boundedMax ? boundedMax : maxValue;

  if (!Number.isFinite(effectiveMin) || !Number.isFinite(effectiveMax) || effectiveMin === effectiveMax) {
    return () => null;
  }

  return (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    return roundNumber(((clamp(value, effectiveMin, effectiveMax) - effectiveMin) / (effectiveMax - effectiveMin)) * 100, 4);
  };
}

function computeWeightedAverage(components) {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const component of components) {
    if (!component || typeof component.value !== "number" || !Number.isFinite(component.value)) {
      continue;
    }
    if (typeof component.weight !== "number" || !Number.isFinite(component.weight) || component.weight <= 0) {
      continue;
    }
    weightedSum += component.value * component.weight;
    totalWeight += component.weight;
  }

  if (totalWeight <= 0) {
    return null;
  }

  return clamp(weightedSum / totalWeight, 0, 100);
}

function freshnessFactor(year) {
  if (!Number.isFinite(year)) {
    return null;
  }
  if (year >= 2023) {
    return 1.0;
  }
  if (year >= 2020) {
    return 0.85;
  }
  if (year >= 2015) {
    return 0.65;
  }
  if (year >= 2010) {
    return 0.4;
  }
  return 0.2;
}

function publicHealthEnvironmentFreshnessValue(year) {
  if (!Number.isFinite(year)) {
    return null;
  }
  if (year >= 2024) {
    return 100;
  }
  if (year === 2023) {
    return 85;
  }
  if (year === 2022) {
    return 70;
  }
  return null;
}

function healthEmergencyPreparednessFreshnessValue(year) {
  if (!Number.isFinite(year)) {
    return null;
  }
  if (year >= 2024) {
    return 100;
  }
  if (year === 2023) {
    return 85;
  }
  if (year === 2022) {
    return 70;
  }
  return null;
}

function getNewestFactYear(points) {
  const years = points
    .map((point) => (typeof point?.year === "number" && Number.isFinite(point.year) ? point.year : null))
    .filter((year) => year !== null);
  if (years.length === 0) {
    return null;
  }
  return Math.max(...years);
}

function computeHhi(values) {
  const filtered = values.filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (filtered.length === 0) {
    return null;
  }
  const total = sumNumbers(filtered);
  if (total <= 0) {
    return null;
  }
  return filtered.reduce((sum, value) => {
    const share = value / total;
    return sum + share * share;
  }, 0);
}

function buildSettlementDataPoint(value, year, source, digits = 3) {
  if (typeof value !== "number" || !Number.isFinite(value) || year === null || !source) {
    return makeDataPoint(null, null, null);
  }
  const factor = 10 ** digits;
  return makeDataPoint(Math.round(value * factor) / factor, year, source);
}

function buildInfrastructureDataPoint(value, source, digits = 3) {
  if (typeof value !== "number" || !Number.isFinite(value) || !source) {
    return makeDataPoint(null, null, null);
  }
  return makeDataPoint(roundNumber(value, digits), 2025, source);
}

function buildInfrastructureBooleanPoint(value, source) {
  if (typeof value !== "boolean" || !source) {
    return { value: null, year: null, source: null };
  }
  return { value, year: 2025, source };
}

function buildInfrastructureArrayPoint(value, source) {
  if (!Array.isArray(value) || !source) {
    return { value: [], year: null, source: null };
  }
  return { value, year: 2025, source };
}

function getProvinceWeight(record) {
  const rasterPopulation = getNumericFactValue(record?.settlement?.rasterPopulationEstimate);
  if (rasterPopulation !== null && rasterPopulation > 0) {
    return { value: rasterPopulation, basis: "population" };
  }

  const areaKm2 = getNumericFactValue(record?.areaKm2);
  if (areaKm2 !== null && areaKm2 > 0) {
    return { value: areaKm2, basis: "area" };
  }

  return { value: 1, basis: "simple-average" };
}

function createEmptyCountryConnectionRollup() {
  return {
    domesticHighwayEdgeCount: buildInfrastructureDataPoint(0, "Derived from Natural Earth 1:10m roads", 0),
    domesticRailEdgeCount: buildInfrastructureDataPoint(0, "Derived from Natural Earth 1:10m railroads", 0),
    internationalHighwayEdgeCount: buildInfrastructureDataPoint(0, "Derived from Natural Earth 1:10m roads", 0),
    internationalRailEdgeCount: buildInfrastructureDataPoint(0, "Derived from Natural Earth 1:10m railroads", 0),
    connectedCountryCount: buildInfrastructureDataPoint(0, "Derived from Natural Earth 1:10m transport connections", 0),
    internationallyConnectedCountryIso3s: buildInfrastructureArrayPoint(
      [],
      "Derived from Natural Earth 1:10m transport connections",
    ),
  };
}

function buildCountryConnectionRollup(iso3, connectionEdges) {
  const rollup = createEmptyCountryConnectionRollup();
  const connectedCountries = new Set();

  for (const edge of Array.isArray(connectionEdges) ? connectionEdges : []) {
    if (!edge || typeof edge !== "object") {
      continue;
    }

    const mode = edge.mode;
    if (mode !== "highway" && mode !== "rail") {
      continue;
    }

    if (edge.fromCountryIso3 !== iso3 && edge.toCountryIso3 !== iso3) {
      continue;
    }

    if (edge.isInternational === true) {
      const otherCountryIso3 = edge.fromCountryIso3 === iso3 ? edge.toCountryIso3 : edge.fromCountryIso3;
      if (typeof otherCountryIso3 === "string" && otherCountryIso3.length > 0 && otherCountryIso3 !== iso3) {
        connectedCountries.add(otherCountryIso3);
      }

      if (mode === "highway") {
        rollup.internationalHighwayEdgeCount.value += 1;
      } else {
        rollup.internationalRailEdgeCount.value += 1;
      }
      continue;
    }

    if (edge.fromCountryIso3 === iso3 && edge.toCountryIso3 === iso3) {
      if (mode === "highway") {
        rollup.domesticHighwayEdgeCount.value += 1;
      } else {
        rollup.domesticRailEdgeCount.value += 1;
      }
    }
  }

  rollup.connectedCountryCount.value = connectedCountries.size;
  rollup.internationallyConnectedCountryIso3s = buildInfrastructureArrayPoint(
    [...connectedCountries].sort(),
    "Derived from Natural Earth 1:10m transport connections",
  );

  return rollup;
}

function buildCountryInfrastructure(iso3, canonicalProvinceDataById, connectionEdges = null) {
  const provinceRecords = Object.values(canonicalProvinceDataById).filter((record) => record?.countryIso3 === iso3);

  if (provinceRecords.length === 0) {
    const infrastructure = {
      airports: {
        count: 0,
        majorCount: 0,
        provinceCountWithAirport: 0,
        hasAirport: false,
      },
      ports: {
        count: 0,
        majorCount: 0,
        provinceCountWithPort: 0,
        hasPort: false,
      },
      rail: {
        lengthKm: 0,
        densityKmPer1000Km2: 0,
        provinceCountWithRail: 0,
        hasRail: false,
      },
      roads: {
        highwayLengthKm: 0,
        densityKmPer1000Km2: 0,
        provinceCountWithHighway: 0,
        hasHighway: false,
      },
      connectivityScore: {
        value: null,
        year: null,
        source: null,
      },
    };
    if (Array.isArray(connectionEdges)) {
      infrastructure.connections = createEmptyCountryConnectionRollup();
    }
    return infrastructure;
  }

  const totalAreaKm2 = sumNumbers(provinceRecords.map((record) => getNumericFactValue(record?.areaKm2)).filter((value) => value !== null));

  const airportCount = sumNumbers(
    provinceRecords.map((record) => getNumericFactValue(record?.infrastructure?.airports?.count)).filter((value) => value !== null),
  );
  const airportMajorCount = sumNumbers(
    provinceRecords.map((record) => getNumericFactValue(record?.infrastructure?.airports?.majorCount)).filter((value) => value !== null),
  );
  const provincesWithAirport = provinceRecords.filter(
    (record) => getBooleanFactValue(record?.infrastructure?.airports?.hasAirport) === true,
  ).length;

  const portCount = sumNumbers(
    provinceRecords.map((record) => getNumericFactValue(record?.infrastructure?.ports?.count)).filter((value) => value !== null),
  );
  const portMajorCount = sumNumbers(
    provinceRecords.map((record) => getNumericFactValue(record?.infrastructure?.ports?.majorCount)).filter((value) => value !== null),
  );
  const provincesWithPort = provinceRecords.filter(
    (record) => getBooleanFactValue(record?.infrastructure?.ports?.hasPort) === true,
  ).length;

  const railLengthKm = sumNumbers(
    provinceRecords.map((record) => getNumericFactValue(record?.infrastructure?.rail?.lengthKm)).filter((value) => value !== null),
  );
  const provincesWithRail = provinceRecords.filter(
    (record) => getBooleanFactValue(record?.infrastructure?.rail?.hasRail) === true,
  ).length;

  const highwayLengthKm = sumNumbers(
    provinceRecords.map((record) => getNumericFactValue(record?.infrastructure?.roads?.highwayLengthKm)).filter((value) => value !== null),
  );
  const provincesWithHighway = provinceRecords.filter(
    (record) => getBooleanFactValue(record?.infrastructure?.roads?.hasHighway) === true,
  ).length;

  let weightedConnectivitySum = 0;
  let totalWeight = 0;
  let weightingMode = "simple average";
  let sawPopulationWeight = false;
  let sawAreaWeight = false;

  for (const record of provinceRecords) {
    const score = getNumericFactValue(record?.infrastructure?.connectivityScore);
    if (score === null) {
      continue;
    }
    const weight = getProvinceWeight(record);
    if (weight.basis === "population") {
      sawPopulationWeight = true;
    } else if (weight.basis === "area") {
      sawAreaWeight = true;
    }
    weightedConnectivitySum += score * weight.value;
    totalWeight += weight.value;
  }

  if (sawPopulationWeight) {
    weightingMode = "province raster population where available, then province area, then simple average";
  } else if (sawAreaWeight) {
    weightingMode = "province area where raster population is unavailable, then simple average";
  }

  const connectivityValue = totalWeight > 0 ? weightedConnectivitySum / totalWeight : null;

  const infrastructure = {
    airports: {
      count: airportCount,
      majorCount: airportMajorCount,
      provinceCountWithAirport: provincesWithAirport,
      hasAirport: airportCount > 0,
    },
    ports: {
      count: portCount,
      majorCount: portMajorCount,
      provinceCountWithPort: provincesWithPort,
      hasPort: portCount > 0,
    },
    rail: {
      lengthKm: roundNumber(railLengthKm, 3) ?? 0,
      densityKmPer1000Km2: totalAreaKm2 > 0 ? roundNumber((railLengthKm / totalAreaKm2) * 1000, 3) ?? 0 : 0,
      provinceCountWithRail: provincesWithRail,
      hasRail: railLengthKm > 0,
    },
    roads: {
      highwayLengthKm: roundNumber(highwayLengthKm, 3) ?? 0,
      densityKmPer1000Km2: totalAreaKm2 > 0 ? roundNumber((highwayLengthKm / totalAreaKm2) * 1000, 3) ?? 0 : 0,
      provinceCountWithHighway: provincesWithHighway,
      hasHighway: highwayLengthKm > 0,
    },
    // Country connectivity rolls up province strategic-infrastructure scores using province raster population when available,
    // otherwise province area, otherwise a simple average, so countries with larger populated provinces carry proportionate weight.
    connectivityScore: {
      value: connectivityValue === null ? null : roundNumber(connectivityValue, 2),
      year: connectivityValue === null ? null : 2025,
      source:
        connectivityValue === null
          ? null
          : `Derived from province strategic infrastructure rollup weighted by ${weightingMode}`,
    },
  };

  if (Array.isArray(connectionEdges)) {
    infrastructure.connections = buildCountryConnectionRollup(iso3, connectionEdges);
  }

  return infrastructure;
}

function buildCountrySettlement(iso3, canonicalProvinceDataById, urbanCentresById) {
  const provinceRecords = Object.values(canonicalProvinceDataById).filter((record) => record?.countryIso3 === iso3);
  const urbanCentres = Object.values(urbanCentresById).filter((record) => record?.countryIso3 === iso3);

  if (provinceRecords.length === 0 && urbanCentres.length === 0) {
    return {
      urbanCentreCount: makeDataPoint(null, null, null),
      largestUrbanCentres: [],
      urbanCentreBuiltUpAreaKm2: makeDataPoint(null, null, null),
      urbanCentreBuiltUpSharePct: makeDataPoint(null, null, null),
      populationConcentrationHhi: makeDataPoint(null, null, null),
      provincePopulationCoveragePct: makeDataPoint(null, null, null),
      rasterPopulationEstimate: makeDataPoint(null, null, null),
      rasterBuiltUpSurfaceKm2: makeDataPoint(null, null, null),
      rasterPopulationDensityPerKm2: makeDataPoint(null, null, null),
      rasterBuiltUpSurfaceSharePct: makeDataPoint(null, null, null),
      rasterPopulationPerBuiltUpKm2: makeDataPoint(null, null, null),
      nonUrbanCentrePopulationEstimate: makeDataPoint(null, null, null),
      urbanCentrePopulationSharePct: makeDataPoint(null, null, null),
      provinceRasterPopulationCoveragePct: makeDataPoint(null, null, null),
      rasterSettlementDataCompleteness: {
        value: "partial-ghsl-raster",
        year: 2025,
        source: "GHSL GHS-POP R2023A + GHSL GHS-BUILT-S R2023A",
      },
      settlementDataCompleteness: {
        value: "urban-centres-only",
        year: 2025,
        source: "GHSL GHS-UCDB; does not include full raster population or full built-up surface",
      },
    };
  }

  const urbanCentreBuiltUpAreaKm2 = sumNumbers(
    provinceRecords
      .map((record) => getNumericFactValue(record?.settlement?.urbanCentreBuiltUpAreaKm2))
      .filter((value) => value !== null),
  );
  const totalAreaKm2 = sumNumbers(
    provinceRecords.map((record) => getNumericFactValue(record?.areaKm2)).filter((value) => value !== null),
  );
  const provincesWithPopulationEstimate = provinceRecords.filter(
    (record) => getNumericFactValue(record?.settlement?.urbanCentrePopulationEstimate) !== null,
  ).length;
  const rasterPopulationTotal = sumNumbers(
    provinceRecords
      .map((record) => getNumericFactValue(record?.settlement?.rasterPopulationEstimate))
      .filter((value) => value !== null),
  );
  const rasterBuiltUpSurfaceKm2 = sumNumbers(
    provinceRecords
      .map((record) => getNumericFactValue(record?.settlement?.rasterBuiltUpSurfaceKm2))
      .filter((value) => value !== null),
  );
  const urbanCentrePopulationTotal = sumNumbers(
    provinceRecords
      .map((record) => getNumericFactValue(record?.settlement?.urbanCentrePopulationEstimate))
      .filter((value) => value !== null),
  );
  const urbanCentrePopulationTotalOrZero = urbanCentrePopulationTotal >= 0 ? urbanCentrePopulationTotal : 0;
  const provincesWithRasterPopulationEstimate = provinceRecords.filter(
    (record) => getNumericFactValue(record?.settlement?.rasterPopulationEstimate) !== null,
  ).length;
  const provincesWithRasterBuiltUpSurface = provinceRecords.filter(
    (record) => getNumericFactValue(record?.settlement?.rasterBuiltUpSurfaceKm2) !== null,
  ).length;
  const countryHhi = computeHhi(
    urbanCentres.map((record) => getNumericFactValue(record?.population)).filter((value) => value !== null),
  );
  const largestUrbanCentres = [...urbanCentres]
    .sort((left, right) => (getNumericFactValue(right.population) ?? -1) - (getNumericFactValue(left.population) ?? -1))
    .slice(0, 10)
    .map((record) => ({
      id: record.id,
      name: record.name,
      provinceId: record.provinceId,
      population: isRecord(record.population) ? record.population : makeDataPoint(null, null, null),
    }));

  return {
    urbanCentreCount: buildSettlementDataPoint(urbanCentres.length, 2025, "GHSL GHS-UCDB R2024A", 0),
    largestUrbanCentres,
    urbanCentreBuiltUpAreaKm2:
      urbanCentreBuiltUpAreaKm2 > 0
        ? buildSettlementDataPoint(urbanCentreBuiltUpAreaKm2, 2025, "GHSL GHS-UCDB R2024A matched province rollup")
        : makeDataPoint(null, null, null),
    urbanCentreBuiltUpSharePct:
      urbanCentreBuiltUpAreaKm2 > 0 && totalAreaKm2 > 0
        ? buildSettlementDataPoint(
            (urbanCentreBuiltUpAreaKm2 / totalAreaKm2) * 100,
            2025,
            "GHSL GHS-UCDB R2024A matched province rollup + Natural Earth province geometry",
          )
        : makeDataPoint(null, null, null),
    populationConcentrationHhi:
      countryHhi === null
        ? makeDataPoint(null, null, null)
        : buildSettlementDataPoint(countryHhi, 2025, "Derived from GHSL GHS-UCDB R2024A", 4),
    provincePopulationCoveragePct:
      provinceRecords.length > 0
        ? buildSettlementDataPoint(
            (provincesWithPopulationEstimate / provinceRecords.length) * 100,
            2025,
            "Derived coverage audit",
            2,
          )
        : makeDataPoint(null, null, null),
    rasterPopulationEstimate:
      rasterPopulationTotal > 0
        ? buildSettlementDataPoint(
            rasterPopulationTotal,
            2025,
            "GHSL GHS-POP R2023A province raster rollup",
            0,
          )
        : makeDataPoint(null, null, null),
    rasterBuiltUpSurfaceKm2:
      rasterBuiltUpSurfaceKm2 > 0
        ? buildSettlementDataPoint(
            rasterBuiltUpSurfaceKm2,
            2025,
            "GHSL GHS-BUILT-S R2023A province raster rollup",
          )
        : makeDataPoint(null, null, null),
    rasterPopulationDensityPerKm2:
      rasterPopulationTotal > 0 && totalAreaKm2 > 0
        ? buildSettlementDataPoint(
            rasterPopulationTotal / totalAreaKm2,
            2025,
            "GHSL GHS-POP R2023A province raster rollup + Natural Earth province geometry",
            2,
          )
        : makeDataPoint(null, null, null),
    rasterBuiltUpSurfaceSharePct:
      rasterBuiltUpSurfaceKm2 > 0 && totalAreaKm2 > 0
        ? buildSettlementDataPoint(
            (rasterBuiltUpSurfaceKm2 / totalAreaKm2) * 100,
            2025,
            "GHSL GHS-BUILT-S R2023A province raster rollup + Natural Earth province geometry",
            3,
          )
        : makeDataPoint(null, null, null),
    rasterPopulationPerBuiltUpKm2:
      rasterPopulationTotal > 0 && rasterBuiltUpSurfaceKm2 > 0
        ? buildSettlementDataPoint(
            rasterPopulationTotal / rasterBuiltUpSurfaceKm2,
            2025,
            "GHSL GHS-POP R2023A + GHSL GHS-BUILT-S R2023A province raster rollup",
            2,
          )
        : makeDataPoint(null, null, null),
    nonUrbanCentrePopulationEstimate:
      rasterPopulationTotal > 0
        ? buildSettlementDataPoint(
            Math.max(0, rasterPopulationTotal - urbanCentrePopulationTotalOrZero),
            2025,
            "GHSL GHS-POP R2023A province raster rollup + GHSL GHS-UCDB R2024A",
            0,
          )
        : makeDataPoint(null, null, null),
    urbanCentrePopulationSharePct:
      rasterPopulationTotal > 0
        ? buildSettlementDataPoint(
            (urbanCentrePopulationTotalOrZero / rasterPopulationTotal) * 100,
            2025,
            "GHSL GHS-UCDB R2024A + GHSL GHS-POP R2023A",
            2,
          )
        : makeDataPoint(null, null, null),
    provinceRasterPopulationCoveragePct:
      provinceRecords.length > 0
        ? buildSettlementDataPoint(
            (provincesWithRasterPopulationEstimate / provinceRecords.length) * 100,
            2025,
            "Derived coverage audit",
            2,
          )
        : makeDataPoint(null, null, null),
    rasterSettlementDataCompleteness: {
      value:
        provinceRecords.length > 0 &&
        provincesWithRasterPopulationEstimate / provinceRecords.length >= 0.99 &&
        provincesWithRasterBuiltUpSurface / provinceRecords.length >= 0.99
          ? "full-ghsl-raster"
          : "partial-ghsl-raster",
      year: 2025,
      source: "GHSL GHS-POP R2023A + GHSL GHS-BUILT-S R2023A",
    },
    settlementDataCompleteness: {
      value: "urban-centres-only",
      year: 2025,
      source: "GHSL GHS-UCDB; does not include full raster population or full built-up surface",
    },
  };
}

async function main() {
  const [
    wdi,
    wgi,
    imf,
    wpp,
    atlasMaybe,
    factbookMaybe,
    securityMaybe,
    healthMaybe,
    publicHealthEnvironmentMaybe,
    healthEmergencyPreparednessMaybe,
    urbanCentresMaybe,
    canonicalProvinceMaybe,
    infrastructureConnectionsMaybe,
  ] = await Promise.all([
    readJson(WDI_PATH),
    readJson(WGI_PATH),
    readJson(IMF_PATH),
    readJson(WPP_PATH),
    readJsonOptional(ATLAS_PATH),
    readJsonOptional(FACTBOOK_PATH),
    readJsonOptional(SECURITY_PATH),
    readJsonOptional(HEALTH_PATH),
    readJsonOptional(PUBLIC_HEALTH_ENVIRONMENT_PATH),
    readJsonOptional(WHO_IHR_SPAR_PATH),
    readJsonOptional(URBAN_CENTRES_PATH),
    readJsonOptional(CANONICAL_PROVINCE_PATH),
    readJsonOptional(INFRASTRUCTURE_CONNECTIONS_PATH),
  ]);

  if (
    !isRecord(wdi?.countriesByIso3) ||
    !isRecord(wgi?.countriesByIso3) ||
    !isRecord(imf?.countriesByIso3) ||
    !isRecord(wpp?.countriesByIso3)
  ) {
    throw new Error(
      "Expected country-stats.json, governance-stats.json, imf-weo-stats.json, and un-wpp-demographics.json to contain countriesByIso3",
    );
  }

  const atlasCountriesByIso3 =
    isRecord(atlasMaybe?.countriesByIso3) ? atlasMaybe.countriesByIso3 : {};
  const factbookCountriesByIso3 =
    isRecord(factbookMaybe?.countriesByIso3) ? factbookMaybe.countriesByIso3 : {};
  const securityCountriesByIso3 =
    isRecord(securityMaybe?.countriesByIso3) ? securityMaybe.countriesByIso3 : {};
  const healthCountriesByIso3 =
    isRecord(healthMaybe?.countriesByIso3) ? healthMaybe.countriesByIso3 : {};
  const publicHealthEnvironmentCountriesByIso3 = isRecord(publicHealthEnvironmentMaybe)
    ? publicHealthEnvironmentMaybe
    : {};
  const healthEmergencyPreparednessByIso3 = isRecord(healthEmergencyPreparednessMaybe)
    ? healthEmergencyPreparednessMaybe
    : {};
  if (!isRecord(atlasMaybe?.countriesByIso3)) {
    console.warn("atlas-trade-profiles.json not found or invalid; tradeStructure will be emitted as null datapoints.");
  }
  if (!isRecord(factbookMaybe?.countriesByIso3)) {
    console.warn("factbook-political-profiles.json not found or invalid; politicalSystem will be emitted with nulls.");
  }
  if (!isRecord(securityMaybe?.countriesByIso3)) {
    console.warn("security-stats.json not found or invalid; security will be emitted as null datapoints.");
  }
  if (!isRecord(healthMaybe?.countriesByIso3)) {
    console.warn("health-stats.json not found or invalid; healthSystem will be emitted as null datapoints.");
  }
  if (!isRecord(publicHealthEnvironmentMaybe)) {
    console.warn(
      "public-health-environment-stats.json not found or invalid; publicHealthEnvironment will be omitted.",
    );
  }
  if (!isRecord(healthEmergencyPreparednessMaybe)) {
    console.warn(
      "who-ihr-spar-stats.json not found or invalid; healthEmergencyPreparedness will be emitted as null datapoints.",
    );
  }
  const urbanCentresById = isRecord(urbanCentresMaybe) ? urbanCentresMaybe : {};
  const canonicalProvinceDataById = isRecord(canonicalProvinceMaybe) ? canonicalProvinceMaybe : {};
  if (!isRecord(urbanCentresMaybe)) {
    console.warn("urban-centres.json not found or invalid; settlement largest urban centre summaries will be emitted as nulls.");
  }
  if (!isRecord(canonicalProvinceMaybe)) {
    console.warn("canonical-province-data.json not found or invalid; settlement province rollups will be emitted as nulls.");
  }
  if (!Array.isArray(infrastructureConnectionsMaybe)) {
    console.warn(
      "infrastructure-connections.json not found or invalid; country infrastructure will omit province-connection rollups.",
    );
  }

  const wdiCoverage = computeCoverageCounts(wdi.countriesByIso3, [
    "gdpCurrentUsd",
    "gdpPerCapitaCurrentUsd",
    "gdpGrowthAnnualPct",
    "inflationConsumerAnnualPct",
  ]);
  const imfCoverage = computeCoverageCounts(imf.countriesByIso3, [
    "gdpCurrentUsdBillions",
    "gdpPerCapitaCurrentUsd",
    "realGdpGrowthPct",
    "inflationAverageConsumerPricesPct",
  ]);

  const coverageSummary = { wdi: wdiCoverage, imf: imfCoverage };

  const allIso3 = Array.from(
    new Set([
      ...Object.keys(wdi.countriesByIso3),
      ...Object.keys(wgi.countriesByIso3),
      ...Object.keys(imf.countriesByIso3),
      ...Object.keys(wpp.countriesByIso3),
      ...Object.keys(atlasCountriesByIso3),
      ...Object.keys(factbookCountriesByIso3),
      ...Object.keys(securityCountriesByIso3),
      ...Object.keys(healthCountriesByIso3),
      ...Object.keys(publicHealthEnvironmentCountriesByIso3),
      ...Object.keys(healthEmergencyPreparednessByIso3),
      ...Object.values(urbanCentresById)
        .map((record) => (isRecord(record) && typeof record.countryIso3 === "string" ? record.countryIso3 : null))
        .filter(Boolean),
      ...Object.values(canonicalProvinceDataById)
        .map((record) => (isRecord(record) && typeof record.countryIso3 === "string" ? record.countryIso3 : null))
        .filter(Boolean),
    ]),
  ).sort();

  const countriesByIso3 = {};

  for (const iso3 of allIso3) {
    const wdiRecord = wdi.countriesByIso3[iso3];
    const imfRecord = imf.countriesByIso3[iso3];
    const wgiRecord = wgi.countriesByIso3[iso3];
    const wppRecord = wpp.countriesByIso3[iso3];
    const atlasRecord = atlasCountriesByIso3[iso3];
    const factbookRecord = factbookCountriesByIso3[iso3];
    const securityRecord = securityCountriesByIso3[iso3];
    const healthRecord = healthCountriesByIso3[iso3];
    const publicHealthEnvironmentRecord = publicHealthEnvironmentCountriesByIso3[iso3];
    const healthEmergencyPreparednessRecord = healthEmergencyPreparednessByIso3[iso3];
    const atlasYear = getAtlasIndicatorYear(atlasRecord);
    const factbookSource = factbookRecord?.source === "CIA World Factbook" ? "CIA World Factbook" : null;

    const economy = {
      population: makeDataPoint(
        getValue(wdiRecord, "population"),
        getYear(wdiRecord, "population"),
        getValue(wdiRecord, "population") === null ? null : "World Bank WDI",
      ),
      gdpCurrentUsd: pickOverlapDataPoint(
        wdiRecord,
        imfRecord,
        OVERLAP_CONFIG.gdpCurrentUsd,
        coverageSummary,
      ),
      gdpPerCapitaCurrentUsd: pickOverlapDataPoint(
        wdiRecord,
        imfRecord,
        OVERLAP_CONFIG.gdpPerCapitaCurrentUsd,
        coverageSummary,
      ),
      gdpGrowthAnnualPct: pickOverlapDataPoint(
        wdiRecord,
        imfRecord,
        OVERLAP_CONFIG.gdpGrowthAnnualPct,
        coverageSummary,
      ),
      inflationAnnualPct: pickOverlapDataPoint(
        wdiRecord,
        imfRecord,
        OVERLAP_CONFIG.inflationAnnualPct,
        coverageSummary,
      ),
      unemploymentPct: makeDataPoint(
        getValue(wdiRecord, "unemploymentPct"),
        getYear(wdiRecord, "unemploymentPct"),
        getValue(wdiRecord, "unemploymentPct") === null ? null : "World Bank WDI",
      ),
      urbanPopulationPct: makeDataPoint(
        getValue(wdiRecord, "urbanPopulationPct"),
        getYear(wdiRecord, "urbanPopulationPct"),
        getValue(wdiRecord, "urbanPopulationPct") === null ? null : "World Bank WDI",
      ),
      lifeExpectancyYears: makeDataPoint(
        getValue(wdiRecord, "lifeExpectancyYears"),
        getYear(wdiRecord, "lifeExpectancyYears"),
        getValue(wdiRecord, "lifeExpectancyYears") === null ? null : "World Bank WDI",
      ),
      tradePctOfGdp: makeDataPoint(
        getValue(wdiRecord, "tradePctOfGdp"),
        getYear(wdiRecord, "tradePctOfGdp"),
        getValue(wdiRecord, "tradePctOfGdp") === null ? null : "World Bank WDI",
      ),
    };

    const demographics = {
      medianAgeYears: makeDataPoint(
        getValue(wppRecord, "medianAgeYears"),
        getYear(wppRecord, "medianAgeYears"),
        getValue(wppRecord, "medianAgeYears") === null ? null : "UN WPP 2024",
      ),
      fertilityRateBirthsPerWoman: makeDataPoint(
        getValue(wppRecord, "fertilityRateBirthsPerWoman"),
        getYear(wppRecord, "fertilityRateBirthsPerWoman"),
        getValue(wppRecord, "fertilityRateBirthsPerWoman") === null ? null : "UN WPP 2024",
      ),
      populationGrowthRatePct: makeDataPoint(
        getValue(wppRecord, "populationGrowthRatePct"),
        getYear(wppRecord, "populationGrowthRatePct"),
        getValue(wppRecord, "populationGrowthRatePct") === null ? null : "UN WPP 2024",
      ),
      netMigration: makeDataPoint(
        getValue(wppRecord, "netMigration"),
        getYear(wppRecord, "netMigration"),
        getValue(wppRecord, "netMigration") === null ? null : "UN WPP 2024",
      ),
      youthSharePct: makeDataPoint(
        getValue(wppRecord, "youthSharePct"),
        getYear(wppRecord, "youthSharePct"),
        getValue(wppRecord, "youthSharePct") === null ? null : "UN WPP 2024",
      ),
      workingAgeSharePct: makeDataPoint(
        getValue(wppRecord, "workingAgeSharePct"),
        getYear(wppRecord, "workingAgeSharePct"),
        getValue(wppRecord, "workingAgeSharePct") === null ? null : "UN WPP 2024",
      ),
      elderlySharePct: makeDataPoint(
        getValue(wppRecord, "elderlySharePct"),
        getYear(wppRecord, "elderlySharePct"),
        getValue(wppRecord, "elderlySharePct") === null ? null : "UN WPP 2024",
      ),
      childDependencyRatio: makeDataPoint(
        getValue(wppRecord, "childDependencyRatio"),
        getYear(wppRecord, "childDependencyRatio"),
        getValue(wppRecord, "childDependencyRatio") === null ? null : "UN WPP 2024",
      ),
      oldAgeDependencyRatio: makeDataPoint(
        getValue(wppRecord, "oldAgeDependencyRatio"),
        getYear(wppRecord, "oldAgeDependencyRatio"),
        getValue(wppRecord, "oldAgeDependencyRatio") === null ? null : "UN WPP 2024",
      ),
      totalDependencyRatio: makeDataPoint(
        getValue(wppRecord, "totalDependencyRatio"),
        getYear(wppRecord, "totalDependencyRatio"),
        getValue(wppRecord, "totalDependencyRatio") === null ? null : "UN WPP 2024",
      ),
    };

    const fiscal = {
      currentAccountBalancePctOfGdp: makeDataPoint(
        getValue(imfRecord, "currentAccountBalancePctOfGdp"),
        getYear(imfRecord, "currentAccountBalancePctOfGdp"),
        getValue(imfRecord, "currentAccountBalancePctOfGdp") === null ? null : "IMF WEO / DataMapper",
      ),
      governmentNetLendingBorrowingPctOfGdp: makeDataPoint(
        getValue(imfRecord, "governmentNetLendingBorrowingPctOfGdp"),
        getYear(imfRecord, "governmentNetLendingBorrowingPctOfGdp"),
        getValue(imfRecord, "governmentNetLendingBorrowingPctOfGdp") === null ? null : "IMF WEO / DataMapper",
      ),
      governmentGrossDebtPctOfGdp: makeDataPoint(
        getValue(imfRecord, "governmentGrossDebtPctOfGdp"),
        getYear(imfRecord, "governmentGrossDebtPctOfGdp"),
        getValue(imfRecord, "governmentGrossDebtPctOfGdp") === null ? null : "IMF WEO / DataMapper",
      ),
    };

    const governance = {
      voiceAndAccountability: makeDataPoint(
        getValue(wgiRecord, "voiceAndAccountability"),
        getYear(wgiRecord, "voiceAndAccountability"),
        getValue(wgiRecord, "voiceAndAccountability") === null ? null : "World Bank WGI",
      ),
      politicalStability: makeDataPoint(
        getValue(wgiRecord, "politicalStability"),
        getYear(wgiRecord, "politicalStability"),
        getValue(wgiRecord, "politicalStability") === null ? null : "World Bank WGI",
      ),
      governmentEffectiveness: makeDataPoint(
        getValue(wgiRecord, "governmentEffectiveness"),
        getYear(wgiRecord, "governmentEffectiveness"),
        getValue(wgiRecord, "governmentEffectiveness") === null ? null : "World Bank WGI",
      ),
      regulatoryQuality: makeDataPoint(
        getValue(wgiRecord, "regulatoryQuality"),
        getYear(wgiRecord, "regulatoryQuality"),
        getValue(wgiRecord, "regulatoryQuality") === null ? null : "World Bank WGI",
      ),
      ruleOfLaw: makeDataPoint(
        getValue(wgiRecord, "ruleOfLaw"),
        getYear(wgiRecord, "ruleOfLaw"),
        getValue(wgiRecord, "ruleOfLaw") === null ? null : "World Bank WGI",
      ),
      controlOfCorruption: makeDataPoint(
        getValue(wgiRecord, "controlOfCorruption"),
        getYear(wgiRecord, "controlOfCorruption"),
        getValue(wgiRecord, "controlOfCorruption") === null ? null : "World Bank WGI",
      ),
    };

    const tradeStructure = {
      totalExportsUsd: makeDataPoint(
        getAtlasIndicatorValue(atlasRecord, "totalExportsUsd"),
        atlasYear,
        getAtlasIndicatorValue(atlasRecord, "totalExportsUsd") === null ? null : "Atlas of Economic Complexity",
      ),
      totalImportsUsd: makeDataPoint(
        getAtlasIndicatorValue(atlasRecord, "totalImportsUsd"),
        atlasYear,
        getAtlasIndicatorValue(atlasRecord, "totalImportsUsd") === null ? null : "Atlas of Economic Complexity",
      ),
      tradeBalanceUsd: makeDataPoint(
        getAtlasIndicatorValue(atlasRecord, "tradeBalanceUsd"),
        atlasYear,
        getAtlasIndicatorValue(atlasRecord, "tradeBalanceUsd") === null ? null : "Atlas of Economic Complexity",
      ),
      exportDiversityProductCount: makeDataPoint(
        getAtlasIndicatorValue(atlasRecord, "exportDiversityProductCount"),
        atlasYear,
        getAtlasIndicatorValue(atlasRecord, "exportDiversityProductCount") === null
          ? null
          : "Atlas of Economic Complexity",
      ),
      importDiversityProductCount: makeDataPoint(
        getAtlasIndicatorValue(atlasRecord, "importDiversityProductCount"),
        atlasYear,
        getAtlasIndicatorValue(atlasRecord, "importDiversityProductCount") === null
          ? null
          : "Atlas of Economic Complexity",
      ),
      exportConcentrationHhi: makeDataPoint(
        getAtlasIndicatorValue(atlasRecord, "exportConcentrationHhi"),
        atlasYear,
        getAtlasIndicatorValue(atlasRecord, "exportConcentrationHhi") === null
          ? null
          : "Atlas of Economic Complexity",
      ),
      importConcentrationHhi: makeDataPoint(
        getAtlasIndicatorValue(atlasRecord, "importConcentrationHhi"),
        atlasYear,
        getAtlasIndicatorValue(atlasRecord, "importConcentrationHhi") === null
          ? null
          : "Atlas of Economic Complexity",
      ),
      economicComplexityIndex: makeDataPoint(
        getAtlasIndicatorValue(atlasRecord, "economicComplexityIndex"),
        atlasYear,
        getAtlasIndicatorValue(atlasRecord, "economicComplexityIndex") === null
          ? null
          : "Atlas of Economic Complexity",
      ),
      topExports: getAtlasTopArray(atlasRecord, "topExports"),
      topImports: getAtlasTopArray(atlasRecord, "topImports"),
    };

    const politicalSystem = {
      source: factbookSource,
      governmentType: makeTextDataPoint(factbookRecord?.raw?.governmentType ?? null, factbookSource),
      capital: makeTextDataPoint(factbookRecord?.raw?.capital ?? null, factbookSource),
      administrativeDivisions: makeTextDataPoint(factbookRecord?.raw?.administrativeDivisions ?? null, factbookSource),
      independence: makeTextDataPoint(factbookRecord?.raw?.independence ?? null, factbookSource),
      constitution: makeTextDataPoint(factbookRecord?.raw?.constitution ?? null, factbookSource),
      legalSystem: makeTextDataPoint(factbookRecord?.raw?.legalSystem ?? null, factbookSource),
      suffrage: makeTextDataPoint(factbookRecord?.raw?.suffrage ?? null, factbookSource),
      executiveBranch: makeTextDataPoint(factbookRecord?.raw?.executiveBranch ?? null, factbookSource),
      legislativeBranch: makeTextDataPoint(factbookRecord?.raw?.legislativeBranch ?? null, factbookSource),
      judicialBranch: makeTextDataPoint(factbookRecord?.raw?.judicialBranch ?? null, factbookSource),
      politicalPartiesAndLeaders: makeTextDataPoint(
        factbookRecord?.raw?.politicalPartiesAndLeaders ?? null,
        factbookSource,
      ),
      electionsAppointments: makeTextDataPoint(factbookRecord?.raw?.electionsAppointments ?? null, factbookSource),
      internationalOrganizationParticipation: makeTextDataPoint(
        factbookRecord?.raw?.internationalOrganizationParticipation ?? null,
        factbookSource,
      ),
      governmentFamily: makeTextDataPoint(factbookRecord?.normalized?.governmentFamily ?? null, factbookSource),
      hasMonarchy: makeBooleanDataPoint(factbookRecord?.normalized?.hasMonarchy ?? null, factbookSource),
      monarchyType: makeTextDataPoint(factbookRecord?.normalized?.monarchyType ?? null, factbookSource),
      hasParliament: makeBooleanDataPoint(factbookRecord?.normalized?.hasParliament ?? null, factbookSource),
      legislatureType: makeTextDataPoint(factbookRecord?.normalized?.legislatureType ?? null, factbookSource),
      hasElections: makeBooleanDataPoint(factbookRecord?.normalized?.hasElections ?? null, factbookSource),
      hasUniversalSuffrage: makeBooleanDataPoint(
        factbookRecord?.normalized?.hasUniversalSuffrage ?? null,
        factbookSource,
      ),
      isFederal: makeBooleanDataPoint(factbookRecord?.normalized?.isFederal ?? null, factbookSource),
      isRepublic: makeBooleanDataPoint(factbookRecord?.normalized?.isRepublic ?? null, factbookSource),
      isOnePartyState: makeBooleanDataPoint(factbookRecord?.normalized?.isOnePartyState ?? null, factbookSource),
      isMilitaryRegime: makeBooleanDataPoint(factbookRecord?.normalized?.isMilitaryRegime ?? null, factbookSource),
      headOfStateTitle: makeTextDataPoint(factbookRecord?.normalized?.headOfStateTitle ?? null, factbookSource),
      headOfGovernmentTitle: makeTextDataPoint(factbookRecord?.normalized?.headOfGovernmentTitle ?? null, factbookSource),
    };

    const militaryExpenditureUsd = getSecurityFact(securityRecord, "militaryExpenditureUsd");
    const armedForcesPersonnel = getSecurityFact(securityRecord, "armedForcesPersonnel");
    const population = economy.population.value !== null &&
      economy.population.year !== null &&
      economy.population.source !== null
      ? economy.population
      : null;

    const security = {
      militaryExpenditureUsd: getSecurityDataPoint(securityRecord, "militaryExpenditureUsd"),
      militaryExpenditurePctOfGdp: getSecurityDataPoint(securityRecord, "militaryExpenditurePctOfGdp"),
      militaryExpenditurePctOfGovtExpenditure: getSecurityDataPoint(
        securityRecord,
        "militaryExpenditurePctOfGovtExpenditure",
      ),
      armedForcesPersonnel: getSecurityDataPoint(securityRecord, "armedForcesPersonnel"),
      armedForcesPctOfLaborForce: getSecurityDataPoint(securityRecord, "armedForcesPctOfLaborForce"),
      armsImportsSipriTiv: getSecurityDataPoint(securityRecord, "armsImportsSipriTiv"),
      armsExportsSipriTiv: getSecurityDataPoint(securityRecord, "armsExportsSipriTiv"),
      militarySpendPerCapitaUsd: derivePerCapitaPoint(
        militaryExpenditureUsd,
        population,
        "Derived from World Bank WDI / SIPRI and WDI population",
      ),
      militarySpendPerSoldierUsd: derivePerCapitaPoint(
        militaryExpenditureUsd,
        armedForcesPersonnel,
        "Derived from World Bank WDI / SIPRI and World Bank WDI / IISS",
      ),
      mobilizationBasePct: deriveMobilizationBasePoint(
        armedForcesPersonnel,
        population,
        "Derived from World Bank WDI / IISS and WDI population",
      ),
    };

    const healthSystem = {
      hospitalBedsPer1000: getHealthDataPoint(healthRecord, "hospitalBedsPer1000"),
      physiciansPer1000: getHealthDataPoint(healthRecord, "physiciansPer1000"),
      nursesMidwivesPer1000: getHealthDataPoint(healthRecord, "nursesMidwivesPer1000"),
      currentHealthExpenditurePerCapitaUsd: getHealthDataPoint(
        healthRecord,
        "currentHealthExpenditurePerCapitaUsd",
      ),
      currentHealthExpenditurePctOfGdp: getHealthDataPoint(healthRecord, "currentHealthExpenditurePctOfGdp"),
      healthCapacityScore: makeDataPoint(null, null, null),
      medicalWorkforceScore: makeDataPoint(null, null, null),
      hospitalSurgeCapacityScore: makeDataPoint(null, null, null),
      outbreakTreatmentScore: makeDataPoint(null, null, null),
      healthDataFreshnessScore: makeDataPoint(null, null, null),
      healthFieldCoverageScore: makeDataPoint(null, null, null),
      healthCapacityScoreConfidence: makeDataPoint(null, null, null),
    };

    const publicHealthEnvironmentRaw = {
      safelyManagedDrinkingWaterPct: getPublicHealthEnvironmentDataPoint(
        publicHealthEnvironmentRecord,
        "safelyManagedDrinkingWaterPct",
      ),
      safelyManagedSanitationPct: getPublicHealthEnvironmentDataPoint(
        publicHealthEnvironmentRecord,
        "safelyManagedSanitationPct",
      ),
      basicHandwashingFacilitiesPct: getPublicHealthEnvironmentDataPoint(
        publicHealthEnvironmentRecord,
        "basicHandwashingFacilitiesPct",
      ),
      accessToElectricityPct: getPublicHealthEnvironmentDataPoint(
        publicHealthEnvironmentRecord,
        "accessToElectricityPct",
      ),
      ruralElectricityAccessPct: getPublicHealthEnvironmentDataPoint(
        publicHealthEnvironmentRecord,
        "ruralElectricityAccessPct",
      ),
      urbanElectricityAccessPct: getPublicHealthEnvironmentDataPoint(
        publicHealthEnvironmentRecord,
        "urbanElectricityAccessPct",
      ),
      cleanCookingFuelAccessPct: getPublicHealthEnvironmentDataPoint(
        publicHealthEnvironmentRecord,
        "cleanCookingFuelAccessPct",
      ),
    };
    const publicHealthEnvironmentHasAnyRawField = Object.values(publicHealthEnvironmentRaw).some(
      (point) => point.value !== null,
    );
    const publicHealthEnvironment = publicHealthEnvironmentHasAnyRawField
      ? {
          ...publicHealthEnvironmentRaw,
          publicHealthEnvironmentScore: makeDataPoint(null, null, null),
          waterborneDiseaseRiskScore: makeDataPoint(null, null, null),
          hygieneTransmissionRiskScore: makeDataPoint(null, null, null),
          serviceReliabilityScore: makeDataPoint(null, null, null),
          publicHealthEnvironmentFieldCoverageScore: makeDataPoint(null, null, null),
          publicHealthEnvironmentFreshnessScore: makeDataPoint(null, null, null),
          publicHealthEnvironmentScoreConfidence: makeDataPoint(null, null, null),
        }
      : null;

    const settlement = buildCountrySettlement(iso3, canonicalProvinceDataById, urbanCentresById);
    const infrastructure = buildCountryInfrastructure(iso3, canonicalProvinceDataById, infrastructureConnectionsMaybe);

    countriesByIso3[iso3] = {
      iso3,
      name: getCountryName(
        iso3,
        wdi,
        imf,
        wgi,
        wpp,
        atlasMaybe,
        factbookMaybe,
        securityMaybe,
        healthMaybe,
        publicHealthEnvironmentCountriesByIso3,
        healthEmergencyPreparednessByIso3,
      ),
      gameStartDate: "2025-01-01",
      economy,
      demographics,
      fiscal,
      governance,
      tradeStructure,
      security,
      healthSystem,
      healthEmergencyPreparedness: {
        ihrSparAverageScore: getHealthEmergencyPreparednessDataPoint(
          healthEmergencyPreparednessRecord,
          "ihrSparAverageScore",
        ),
        outbreakPreparednessScore: makeDataPoint(null, null, null),
        outbreakPreparednessScoreConfidence: makeDataPoint(null, null, null),
      },
      politicalSystem,
      ...(publicHealthEnvironment ? { publicHealthEnvironment } : {}),
      settlement,
      infrastructure,
    };
  }

  const countryList = Object.values(countriesByIso3);
  const normalizeHospitalBeds = buildNormalizer(
    countryList.map((country) => getPointValue(country.healthSystem?.hospitalBedsPer1000)),
  );
  const normalizePhysicians = buildNormalizer(
    countryList.map((country) => getPointValue(country.healthSystem?.physiciansPer1000)),
  );
  const normalizeNurses = buildNormalizer(
    countryList.map((country) => getPointValue(country.healthSystem?.nursesMidwivesPer1000)),
  );
  const normalizeHealthSpendPerCapita = buildNormalizer(
    countryList.map((country) => getPointValue(country.healthSystem?.currentHealthExpenditurePerCapitaUsd)),
  );
  const normalizeHealthSpendPctGdp = buildNormalizer(
    countryList.map((country) => getPointValue(country.healthSystem?.currentHealthExpenditurePctOfGdp)),
  );
  const normalizeGovernmentEffectiveness = buildNormalizer(
    countryList.map((country) => getPointValue(country.governance?.governmentEffectiveness)),
  );
  const normalizeRuleOfLaw = buildNormalizer(
    countryList.map((country) => getPointValue(country.governance?.ruleOfLaw)),
  );
  const normalizeConnectivity = buildNormalizer(
    countryList.map((country) => getPointValue(country.infrastructure?.connectivityScore)),
  );
  const healthCapacityWeights = [
    ["hospitalBedsPer1000", 0.30],
    ["physiciansPer1000", 0.25],
    ["nursesMidwivesPer1000", 0.20],
    ["currentHealthExpenditurePerCapitaUsd", 0.15],
    ["currentHealthExpenditurePctOfGdp", 0.10],
  ];

  for (const country of countryList) {
    const hospitalBedsScore = normalizeHospitalBeds(getPointValue(country.healthSystem?.hospitalBedsPer1000));
    const physiciansScore = normalizePhysicians(getPointValue(country.healthSystem?.physiciansPer1000));
    const nursesScore = normalizeNurses(getPointValue(country.healthSystem?.nursesMidwivesPer1000));
    const spendPerCapitaScore = normalizeHealthSpendPerCapita(
      getPointValue(country.healthSystem?.currentHealthExpenditurePerCapitaUsd),
    );
    const spendPctGdpScore = normalizeHealthSpendPctGdp(
      getPointValue(country.healthSystem?.currentHealthExpenditurePctOfGdp),
    );

    const medicalWorkforceScore = computeWeightedAverage([
      { value: physiciansScore, weight: 0.55 },
      { value: nursesScore, weight: 0.45 },
    ]);
    const hospitalSurgeCapacityScore = computeWeightedAverage([
      { value: hospitalBedsScore, weight: 1 },
    ]);
    const healthCapacityScore = computeWeightedAverage([
      { value: hospitalBedsScore, weight: 0.30 },
      { value: physiciansScore, weight: 0.25 },
      { value: nursesScore, weight: 0.20 },
      { value: spendPerCapitaScore, weight: 0.15 },
      { value: spendPctGdpScore, weight: 0.10 },
    ]);

    const outbreakTreatmentScore = computeWeightedAverage([
      { value: healthCapacityScore, weight: 0.60 },
      {
        value: normalizeGovernmentEffectiveness(getPointValue(country.governance?.governmentEffectiveness)),
        weight: 0.20,
      },
      {
        value: normalizeRuleOfLaw(getPointValue(country.governance?.ruleOfLaw)),
        weight: 0.10,
      },
      {
        value: normalizeConnectivity(getPointValue(country.infrastructure?.connectivityScore)),
        weight: 0.10,
      },
    ]);

    const healthFreshnessScore = computeWeightedAverage(
      healthCapacityWeights.map(([key, weight]) => {
        const freshness = freshnessFactor(country.healthSystem?.[key]?.year ?? null);
        return {
          value: freshness === null ? null : freshness * 100,
          weight,
        };
      }),
    );
    const availableHealthFieldCount = healthCapacityWeights.filter(([key]) => {
      const value = getPointValue(country.healthSystem?.[key]);
      return value !== null;
    }).length;
    const healthFieldCoverageScore =
      availableHealthFieldCount > 0
        ? roundNumber((availableHealthFieldCount / healthCapacityWeights.length) * 100, 2)
        : null;
    const healthCapacityScoreConfidence = computeWeightedAverage([
      { value: healthFieldCoverageScore, weight: 0.65 },
      { value: healthFreshnessScore, weight: 0.35 },
    ]);

    country.healthSystem = {
      ...country.healthSystem,
      healthCapacityScore: makeDerivedScoreDataPoint(healthCapacityScore, HEALTH_DERIVED_SOURCE),
      medicalWorkforceScore: makeDerivedScoreDataPoint(medicalWorkforceScore, HEALTH_DERIVED_SOURCE),
      hospitalSurgeCapacityScore: makeDerivedScoreDataPoint(hospitalSurgeCapacityScore, HEALTH_DERIVED_SOURCE),
      outbreakTreatmentScore: makeDerivedScoreDataPoint(outbreakTreatmentScore, OUTBREAK_DERIVED_SOURCE),
      healthDataFreshnessScore: makeDerivedScoreDataPoint(healthFreshnessScore, HEALTH_CONFIDENCE_SOURCE),
      healthFieldCoverageScore: makeDerivedScoreDataPoint(healthFieldCoverageScore, HEALTH_CONFIDENCE_SOURCE),
      healthCapacityScoreConfidence: makeDerivedScoreDataPoint(
        healthCapacityScoreConfidence,
        HEALTH_CONFIDENCE_SOURCE,
      ),
    };

    if (country.publicHealthEnvironment) {
      const rawPublicHealthFields = [
        country.publicHealthEnvironment.safelyManagedDrinkingWaterPct,
        country.publicHealthEnvironment.safelyManagedSanitationPct,
        country.publicHealthEnvironment.basicHandwashingFacilitiesPct,
        country.publicHealthEnvironment.accessToElectricityPct,
        country.publicHealthEnvironment.ruralElectricityAccessPct,
        country.publicHealthEnvironment.urbanElectricityAccessPct,
        country.publicHealthEnvironment.cleanCookingFuelAccessPct,
      ];
      const newestPublicHealthEnvironmentYear = getNewestFactYear(rawPublicHealthFields);
      const publicHealthEnvironmentScore = computeWeightedAverage([
        { value: getPointValue(country.publicHealthEnvironment.safelyManagedDrinkingWaterPct), weight: 0.25 },
        { value: getPointValue(country.publicHealthEnvironment.safelyManagedSanitationPct), weight: 0.25 },
        { value: getPointValue(country.publicHealthEnvironment.basicHandwashingFacilitiesPct), weight: 0.20 },
        { value: getPointValue(country.publicHealthEnvironment.accessToElectricityPct), weight: 0.15 },
        { value: getPointValue(country.publicHealthEnvironment.cleanCookingFuelAccessPct), weight: 0.15 },
      ]);
      const waterborneDiseaseProtection = computeWeightedAverage([
        { value: getPointValue(country.publicHealthEnvironment.safelyManagedDrinkingWaterPct), weight: 0.55 },
        { value: getPointValue(country.publicHealthEnvironment.safelyManagedSanitationPct), weight: 0.45 },
      ]);
      const hygieneTransmissionProtection = computeWeightedAverage([
        { value: getPointValue(country.publicHealthEnvironment.basicHandwashingFacilitiesPct), weight: 0.50 },
        { value: getPointValue(country.publicHealthEnvironment.safelyManagedSanitationPct), weight: 0.30 },
        { value: getPointValue(country.publicHealthEnvironment.safelyManagedDrinkingWaterPct), weight: 0.20 },
      ]);
      const serviceReliabilityScore = computeWeightedAverage([
        { value: getPointValue(country.publicHealthEnvironment.accessToElectricityPct), weight: 0.50 },
        { value: getPointValue(country.publicHealthEnvironment.ruralElectricityAccessPct), weight: 0.20 },
        { value: getPointValue(country.publicHealthEnvironment.urbanElectricityAccessPct), weight: 0.10 },
        { value: getPointValue(country.publicHealthEnvironment.cleanCookingFuelAccessPct), weight: 0.20 },
      ]);
      const waterborneDiseaseRiskScore =
        waterborneDiseaseProtection === null ? null : 100 - waterborneDiseaseProtection;
      const hygieneTransmissionRiskScore =
        hygieneTransmissionProtection === null ? null : 100 - hygieneTransmissionProtection;
      const availablePublicHealthFieldCount = rawPublicHealthFields.filter((point) => point.value !== null).length;
      const publicHealthEnvironmentFieldCoverageScore =
        availablePublicHealthFieldCount > 0
          ? roundNumber((availablePublicHealthFieldCount / 7) * 100, 2)
          : null;
      const publicHealthEnvironmentFreshnessScore = computeWeightedAverage(
        rawPublicHealthFields.map((point) => ({
          value: publicHealthEnvironmentFreshnessValue(point.year),
          weight: 1,
        })),
      );
      const publicHealthEnvironmentScoreConfidence = computeWeightedAverage([
        { value: publicHealthEnvironmentFieldCoverageScore, weight: 0.65 },
        { value: publicHealthEnvironmentFreshnessScore, weight: 0.35 },
      ]);

      country.publicHealthEnvironment = {
        ...country.publicHealthEnvironment,
        publicHealthEnvironmentScore: makeDerivedScoreDataPointWithYear(
          publicHealthEnvironmentScore,
          newestPublicHealthEnvironmentYear,
          PUBLIC_HEALTH_ENVIRONMENT_DERIVED_SOURCE,
        ),
        waterborneDiseaseRiskScore: makeDerivedScoreDataPointWithYear(
          waterborneDiseaseRiskScore,
          newestPublicHealthEnvironmentYear,
          PUBLIC_HEALTH_ENVIRONMENT_DERIVED_SOURCE,
        ),
        hygieneTransmissionRiskScore: makeDerivedScoreDataPointWithYear(
          hygieneTransmissionRiskScore,
          newestPublicHealthEnvironmentYear,
          PUBLIC_HEALTH_ENVIRONMENT_DERIVED_SOURCE,
        ),
        serviceReliabilityScore: makeDerivedScoreDataPointWithYear(
          serviceReliabilityScore,
          newestPublicHealthEnvironmentYear,
          PUBLIC_HEALTH_ENVIRONMENT_DERIVED_SOURCE,
        ),
        publicHealthEnvironmentFieldCoverageScore: makeDerivedScoreDataPointWithYear(
          publicHealthEnvironmentFieldCoverageScore,
          newestPublicHealthEnvironmentYear,
          PUBLIC_HEALTH_ENVIRONMENT_DERIVED_SOURCE,
        ),
        publicHealthEnvironmentFreshnessScore: makeDerivedScoreDataPointWithYear(
          publicHealthEnvironmentFreshnessScore,
          newestPublicHealthEnvironmentYear,
          PUBLIC_HEALTH_ENVIRONMENT_DERIVED_SOURCE,
        ),
        publicHealthEnvironmentScoreConfidence: makeDerivedScoreDataPointWithYear(
          publicHealthEnvironmentScoreConfidence,
          newestPublicHealthEnvironmentYear,
          PUBLIC_HEALTH_ENVIRONMENT_DERIVED_SOURCE,
        ),
      };
    }

    const ihrSparAverageScore = country.healthEmergencyPreparedness?.ihrSparAverageScore ?? makeDataPoint(null, null, null);
    const outbreakPreparednessScoreConfidence = healthEmergencyPreparednessFreshnessValue(ihrSparAverageScore.year);

    country.healthEmergencyPreparedness = {
      ...country.healthEmergencyPreparedness,
      outbreakPreparednessScore:
        ihrSparAverageScore.value !== null && ihrSparAverageScore.year !== null
          ? makeDataPoint(
              ihrSparAverageScore.value,
              ihrSparAverageScore.year,
              HEALTH_EMERGENCY_PREPAREDNESS_DERIVED_SOURCE,
            )
          : makeDataPoint(null, null, null),
      outbreakPreparednessScoreConfidence:
        outbreakPreparednessScoreConfidence !== null && ihrSparAverageScore.year !== null
          ? makeDataPoint(
              outbreakPreparednessScoreConfidence,
              ihrSparAverageScore.year,
              HEALTH_EMERGENCY_PREPAREDNESS_DERIVED_SOURCE,
            )
          : makeDataPoint(null, null, null),
    };
  }

  const canonical = {
    source: "Canonical merged country data",
    gameStartDate: "2025-01-01",
    generatedAt: new Date().toISOString(),
    countriesByIso3,
  };

  const metricCoverage = {};
  const sourceUsageByMetric = {};
  const missingByCountry = {};
  const sourceUsageTotals = {
    wdiValuesUsed: 0,
    imfValuesUsed: 0,
    wgiValuesUsed: 0,
    wppValuesUsed: 0,
    atlasValuesUsed: 0,
    securitySipriValuesUsed: 0,
    securityIissValuesUsed: 0,
    derivedSecurityValuesUsed: 0,
    healthWhoValuesUsed: 0,
    derivedHealthValuesUsed: 0,
    publicHealthEnvironmentJmpValuesUsed: 0,
    publicHealthEnvironmentSdg7ValuesUsed: 0,
    derivedPublicHealthEnvironmentValuesUsed: 0,
    healthEmergencyPreparednessWhoValuesUsed: 0,
    derivedHealthEmergencyPreparednessValuesUsed: 0,
    factbookTextValuesUsed: 0,
    factbookBooleanValuesUsed: 0,
  };

  for (const section of Object.keys(CANONICAL_KEYS)) {
    for (const metric of CANONICAL_KEYS[section]) {
      metricCoverage[metric] = 0;
      sourceUsageByMetric[metric] = {
        "World Bank WDI": 0,
        "IMF WEO / DataMapper": 0,
        "World Bank WGI": 0,
        "UN WPP 2024": 0,
        "Atlas of Economic Complexity": 0,
        "World Bank WDI / SIPRI": 0,
        "World Bank WDI / IISS": 0,
        "World Bank WDI / WHO": 0,
        "World Bank WDI / WHO-UNICEF JMP": 0,
        "World Bank WDI / SDG7": 0,
        "WHO GHO / IHR SPAR second edition": 0,
        derived: 0,
        nullSource: 0,
      };
    }
  }

  for (const [iso3, country] of Object.entries(countriesByIso3)) {
    const missingMetrics = [];

    for (const section of Object.keys(CANONICAL_KEYS)) {
      for (const metric of CANONICAL_KEYS[section]) {
        const point = country[section]?.[metric] ?? makeDataPoint(null, null, null);
        if (point.value !== null) {
          metricCoverage[metric] += 1;
        } else {
          missingMetrics.push(metric);
        }

        if (point.source === "World Bank WDI") {
          sourceUsageByMetric[metric]["World Bank WDI"] += 1;
          sourceUsageTotals.wdiValuesUsed += 1;
        } else if (point.source === "IMF WEO / DataMapper") {
          sourceUsageByMetric[metric]["IMF WEO / DataMapper"] += 1;
          sourceUsageTotals.imfValuesUsed += 1;
        } else if (point.source === "World Bank WGI") {
          sourceUsageByMetric[metric]["World Bank WGI"] += 1;
          sourceUsageTotals.wgiValuesUsed += 1;
        } else if (point.source === "UN WPP 2024") {
          sourceUsageByMetric[metric]["UN WPP 2024"] += 1;
          sourceUsageTotals.wppValuesUsed += 1;
        } else if (point.source === "Atlas of Economic Complexity") {
          sourceUsageByMetric[metric]["Atlas of Economic Complexity"] += 1;
          sourceUsageTotals.atlasValuesUsed += 1;
        } else if (point.source === "World Bank WDI / SIPRI") {
          sourceUsageByMetric[metric]["World Bank WDI / SIPRI"] += 1;
          sourceUsageTotals.securitySipriValuesUsed += 1;
        } else if (point.source === "World Bank WDI / IISS") {
          sourceUsageByMetric[metric]["World Bank WDI / IISS"] += 1;
          sourceUsageTotals.securityIissValuesUsed += 1;
        } else if (point.source === "World Bank WDI / WHO") {
          sourceUsageByMetric[metric]["World Bank WDI / WHO"] += 1;
          sourceUsageTotals.healthWhoValuesUsed += 1;
        } else if (point.source === "World Bank WDI / WHO-UNICEF JMP") {
          sourceUsageByMetric[metric]["World Bank WDI / WHO-UNICEF JMP"] += 1;
          sourceUsageTotals.publicHealthEnvironmentJmpValuesUsed += 1;
        } else if (point.source === "World Bank WDI / SDG7") {
          sourceUsageByMetric[metric]["World Bank WDI / SDG7"] += 1;
          sourceUsageTotals.publicHealthEnvironmentSdg7ValuesUsed += 1;
        } else if (point.source === HEALTH_EMERGENCY_PREPAREDNESS_RAW_SOURCE) {
          sourceUsageByMetric[metric]["WHO GHO / IHR SPAR second edition"] += 1;
          sourceUsageTotals.healthEmergencyPreparednessWhoValuesUsed += 1;
        } else if (point.source === HEALTH_EMERGENCY_PREPAREDNESS_DERIVED_SOURCE) {
          sourceUsageByMetric[metric].derived += 1;
          sourceUsageTotals.derivedHealthEmergencyPreparednessValuesUsed += 1;
        } else if (point.source === PUBLIC_HEALTH_ENVIRONMENT_DERIVED_SOURCE) {
          sourceUsageByMetric[metric].derived += 1;
          sourceUsageTotals.derivedPublicHealthEnvironmentValuesUsed += 1;
        } else if (typeof point.source === "string" && point.source.startsWith("Derived from ")) {
          sourceUsageByMetric[metric].derived += 1;
          if (HEALTH_KEYS.includes(metric)) {
            sourceUsageTotals.derivedHealthValuesUsed += 1;
          } else {
            sourceUsageTotals.derivedSecurityValuesUsed += 1;
          }
        } else {
          sourceUsageByMetric[metric].nullSource += 1;
        }
      }
    }

    if (missingMetrics.length > 0) {
      missingByCountry[iso3] = {
        name: country.name,
        missingMetrics,
      };
    }
  }

  const politicalSystemCoverage = {
    textFieldCoverage: {},
    booleanFieldCoverage: {},
    countriesWithAnyPoliticalSystemData: 0,
    countriesWithNoPoliticalSystemData: 0,
  };

  for (const key of POLITICAL_SYSTEM_TEXT_KEYS) {
    politicalSystemCoverage.textFieldCoverage[key] = 0;
  }
  for (const key of POLITICAL_SYSTEM_BOOLEAN_KEYS) {
    politicalSystemCoverage.booleanFieldCoverage[key] = 0;
  }

  for (const country of Object.values(countriesByIso3)) {
    let anyPoliticalData = false;

    for (const key of POLITICAL_SYSTEM_TEXT_KEYS) {
      const point = country.politicalSystem[key];
      if (point?.value !== null) {
        politicalSystemCoverage.textFieldCoverage[key] += 1;
        anyPoliticalData = true;
        if (point.source === "CIA World Factbook") {
          sourceUsageTotals.factbookTextValuesUsed += 1;
        }
      }
    }

    for (const key of POLITICAL_SYSTEM_BOOLEAN_KEYS) {
      const point = country.politicalSystem[key];
      if (typeof point?.value === "boolean") {
        politicalSystemCoverage.booleanFieldCoverage[key] += 1;
        anyPoliticalData = true;
        if (point.source === "CIA World Factbook") {
          sourceUsageTotals.factbookBooleanValuesUsed += 1;
        }
      }
    }

    if (anyPoliticalData) {
      politicalSystemCoverage.countriesWithAnyPoliticalSystemData += 1;
    } else {
      politicalSystemCoverage.countriesWithNoPoliticalSystemData += 1;
    }
  }

  const coverage = {
    generatedAt: new Date().toISOString(),
    totalCountries: allIso3.length,
    coverageByCanonicalMetric: metricCoverage,
    sourceUsedByMetric: sourceUsageByMetric,
    politicalSystemCoverage,
    settlementCoverage: {
      countriesWithSettlementData: Object.values(countriesByIso3).filter(
        (country) =>
          country.settlement.urbanCentreCount.value !== null ||
          country.settlement.urbanCentreBuiltUpAreaKm2.value !== null ||
          country.settlement.populationConcentrationHhi.value !== null,
      ).length,
      countriesWithRasterPopulationEstimate: Object.values(countriesByIso3).filter(
        (country) => country.settlement.rasterPopulationEstimate.value !== null,
      ).length,
      countriesWithRasterBuiltUpSurfaceKm2: Object.values(countriesByIso3).filter(
        (country) => country.settlement.rasterBuiltUpSurfaceKm2.value !== null,
      ).length,
      countriesWithLargestUrbanCentres: Object.values(countriesByIso3).filter(
        (country) => country.settlement.largestUrbanCentres.length > 0,
      ).length,
      urbanCentresLoaded: Object.keys(urbanCentresById).length,
      provincesLoaded: Object.keys(canonicalProvinceDataById).length,
      countriesWithFullRasterSettlementData: Object.values(countriesByIso3).filter(
        (country) => country.settlement.rasterSettlementDataCompleteness.value === "full-ghsl-raster",
      ).length,
      countriesWithPartialRasterSettlementData: Object.values(countriesByIso3).filter(
        (country) => country.settlement.rasterSettlementDataCompleteness.value === "partial-ghsl-raster",
      ).length,
      provinceRasterPopulationCoveragePct: roundNumber(
        Object.values(countriesByIso3).reduce(
          (sum, country) => sum + (country.settlement.provinceRasterPopulationCoveragePct.value ?? 0),
          0,
        ) / Math.max(1, Object.values(countriesByIso3).length),
        2,
      ),
      settlementDataCompleteness: {
        value: "urban-centres-only",
        year: 2025,
        source: "GHSL GHS-UCDB; does not include full raster population or full built-up surface",
      },
      rasterSettlementDataCompleteness: {
        value: Object.values(countriesByIso3).every(
          (country) => country.settlement.rasterSettlementDataCompleteness.value === "full-ghsl-raster",
        )
          ? "full-ghsl-raster"
          : "partial-ghsl-raster",
        year: 2025,
        source: "GHSL GHS-POP R2023A + GHSL GHS-BUILT-S R2023A",
      },
    },
    infrastructureCoverage: {
      countriesWithInfrastructureData: Object.values(countriesByIso3).filter(
        (country) => country.infrastructure.connectivityScore.value !== null,
      ).length,
      countriesWithAirport: Object.values(countriesByIso3).filter((country) => country.infrastructure.airports.hasAirport === true).length,
      countriesWithPort: Object.values(countriesByIso3).filter((country) => country.infrastructure.ports.hasPort === true).length,
      countriesWithRail: Object.values(countriesByIso3).filter((country) => country.infrastructure.rail.hasRail === true).length,
      countriesWithHighway: Object.values(countriesByIso3).filter((country) => country.infrastructure.roads.hasHighway === true).length,
      countriesWithConnectionRollups: Object.values(countriesByIso3).filter(
        (country) => country.infrastructure.connections?.connectedCountryCount?.year === 2025,
      ).length,
    },
    ...sourceUsageTotals,
    unresolvedMissingValues: {
      countriesWithMissingMetrics: Object.keys(missingByCountry).length,
      missingByCountry,
    },
  };

  await mkdir(resolve(__dirname, "..", "public", "data"), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(canonical, null, 2)}\n`, "utf8");
  await writeFile(COVERAGE_PATH, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");

  console.info(`Wrote ${OUTPUT_PATH}`);
  console.info(`Wrote ${COVERAGE_PATH}`);
  console.info(`Countries in canonical dataset: ${allIso3.length}`);
}

main().catch((error) => {
  console.error("Failed to build canonical country data.", error);
  process.exitCode = 1;
});
