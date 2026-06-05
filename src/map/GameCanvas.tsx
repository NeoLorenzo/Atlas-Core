import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import maplibregl, {
  type ErrorEvent,
  type Map as MapLibreMap,
  type MapGeoJSONFeature,
  type MapLayerMouseEvent,
  type MapMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import "./GameCanvas.css";

const NO_DATA_COLOR = "#475569";

const COUNTRY_COLOR_PALETTE = [
  "#64748b",
  "#475569",
  "#7c3aed",
  "#2563eb",
  "#0891b2",
  "#059669",
  "#65a30d",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#be123c",
  "#9333ea",
  "#0f766e",
  "#4d7c0f",
  "#a16207",
  "#b45309",
];

const PROVINCE_COLOR_PALETTE = [
  "#1e3a8a",
  "#0f766e",
  "#3f6212",
  "#9a3412",
  "#7e22ce",
  "#0c4a6e",
  "#365314",
  "#991b1b",
  "#6b21a8",
  "#155e75",
  "#3f3f46",
  "#78350f",
];

const ISO3_PROPERTY_CANDIDATES = [
  "adm0_a3",
  "ADM0_A3",
  "iso_a3",
  "ISO_A3",
  "sov_a3",
  "SOV_A3",
  "gu_a3",
  "GU_A3",
];

type FeatureProperties = Record<string, unknown>;
type ProvinceFeatureCollection = FeatureCollection<Geometry, GeoJsonProperties>;
type DataSource = string | null;

type DataPoint = {
  value: number | null;
  year: number | null;
  source: DataSource;
};

type TextFactPoint = {
  value: string | null;
  year: number | null;
  source: DataSource;
};

type EconomyData = {
  population: DataPoint;
  gdpCurrentUsd: DataPoint;
  gdpPerCapitaCurrentUsd: DataPoint;
  gdpGrowthAnnualPct: DataPoint;
  inflationAnnualPct: DataPoint;
  unemploymentPct: DataPoint;
  urbanPopulationPct: DataPoint;
  lifeExpectancyYears: DataPoint;
  tradePctOfGdp: DataPoint;
};

type FiscalData = {
  currentAccountBalancePctOfGdp: DataPoint;
  governmentNetLendingBorrowingPctOfGdp: DataPoint;
  governmentGrossDebtPctOfGdp: DataPoint;
};

type GovernanceData = {
  voiceAndAccountability: DataPoint;
  politicalStability: DataPoint;
  governmentEffectiveness: DataPoint;
  regulatoryQuality: DataPoint;
  ruleOfLaw: DataPoint;
  controlOfCorruption: DataPoint;
};

type DemographicsData = {
  medianAgeYears: DataPoint;
  fertilityRateBirthsPerWoman: DataPoint;
  populationGrowthRatePct: DataPoint;
  netMigration: DataPoint;
  youthSharePct: DataPoint;
  workingAgeSharePct: DataPoint;
  elderlySharePct: DataPoint;
  childDependencyRatio: DataPoint;
  oldAgeDependencyRatio: DataPoint;
  totalDependencyRatio: DataPoint;
};

type TradeStructureProduct = {
  productCode: string;
  productName: string | null;
  exportValueUsd?: number;
  importValueUsd?: number;
  shareOfExportsPct?: number;
  shareOfImportsPct?: number;
};

type TradeStructureData = {
  totalExportsUsd: DataPoint;
  totalImportsUsd: DataPoint;
  tradeBalanceUsd: DataPoint;
  exportDiversityProductCount: DataPoint;
  importDiversityProductCount: DataPoint;
  exportConcentrationHhi: DataPoint;
  importConcentrationHhi: DataPoint;
  economicComplexityIndex: DataPoint;
  topExports: TradeStructureProduct[];
  topImports: TradeStructureProduct[];
};

type SecurityData = {
  militaryExpenditureUsd: DataPoint;
  militaryExpenditurePctOfGdp: DataPoint;
  militaryExpenditurePctOfGovtExpenditure: DataPoint;
  armedForcesPersonnel: DataPoint;
  armedForcesPctOfLaborForce: DataPoint;
  armsImportsSipriTiv: DataPoint;
  armsExportsSipriTiv: DataPoint;
  militarySpendPerCapitaUsd: DataPoint;
  militarySpendPerSoldierUsd: DataPoint;
  mobilizationBasePct: DataPoint;
};

type TextDataPoint = {
  value: string | null;
  source: DataSource;
};

type BooleanDataPoint = {
  value: boolean | null;
  source: "CIA World Factbook" | null;
};

type PoliticalSystemData = {
  source: "CIA World Factbook" | null;
  governmentType: TextDataPoint;
  capital: TextDataPoint;
  administrativeDivisions: TextDataPoint;
  independence: TextDataPoint;
  constitution: TextDataPoint;
  legalSystem: TextDataPoint;
  suffrage: TextDataPoint;
  executiveBranch: TextDataPoint;
  legislativeBranch: TextDataPoint;
  judicialBranch: TextDataPoint;
  politicalPartiesAndLeaders: TextDataPoint;
  electionsAppointments: TextDataPoint;
  internationalOrganizationParticipation: TextDataPoint;
  governmentFamily: TextDataPoint;
  hasMonarchy: BooleanDataPoint;
  monarchyType: TextDataPoint;
  hasParliament: BooleanDataPoint;
  legislatureType: TextDataPoint;
  hasElections: BooleanDataPoint;
  hasUniversalSuffrage: BooleanDataPoint;
  isFederal: BooleanDataPoint;
  isRepublic: BooleanDataPoint;
  isOnePartyState: BooleanDataPoint;
  isMilitaryRegime: BooleanDataPoint;
  headOfStateTitle: TextDataPoint;
  headOfGovernmentTitle: TextDataPoint;
};

type CanonicalCountryData = {
  iso3: string;
  name: string;
  gameStartDate: "2025-01-01";
  economy: EconomyData;
  fiscal: FiscalData;
  governance: GovernanceData;
  demographics: DemographicsData;
  tradeStructure: TradeStructureData;
  security: SecurityData;
  politicalSystem: PoliticalSystemData;
  settlement?: CountrySettlementData;
};

type CanonicalCountryDataFile = {
  source: string;
  gameStartDate: "2025-01-01";
  generatedAt: string;
  countriesByIso3: Record<string, CanonicalCountryData>;
};

type CountrySettlementData = {
  urbanCentreCount: DataPoint;
  largestUrbanCentres: Array<{
    id: string;
    name: string;
    provinceId: string | null;
    population: DataPoint;
  }>;
  urbanCentreBuiltUpAreaKm2: DataPoint;
  urbanCentreBuiltUpSharePct: DataPoint;
  populationConcentrationHhi: DataPoint;
  provincePopulationCoveragePct: DataPoint;
  rasterPopulationEstimate: DataPoint;
  rasterBuiltUpSurfaceKm2: DataPoint;
  rasterPopulationDensityPerKm2: DataPoint;
  rasterBuiltUpSurfaceSharePct: DataPoint;
  rasterPopulationPerBuiltUpKm2: DataPoint;
  nonUrbanCentrePopulationEstimate: DataPoint;
  urbanCentrePopulationSharePct: DataPoint;
  provinceRasterPopulationCoveragePct: DataPoint;
  rasterSettlementDataCompleteness: TextFactPoint;
  settlementDataCompleteness: TextFactPoint;
};

type ProvinceSettlementData = {
  urbanCentrePopulationEstimate: DataPoint;
  urbanCentrePopulationDensityPerKm2: DataPoint;
  urbanCentreBuiltUpAreaKm2: DataPoint;
  urbanCentreBuiltUpSharePct: DataPoint;
  urbanCentreCount: DataPoint;
  largestUrbanCentreId: string | null;
  largestUrbanCentreName: string | null;
  largestUrbanCentrePopulationEstimate: DataPoint;
  populationConcentrationHhi: DataPoint;
  rasterPopulationEstimate: DataPoint;
  rasterPopulationDensityPerKm2: DataPoint;
  rasterBuiltUpSurfaceKm2: DataPoint;
  rasterBuiltUpSurfaceSharePct: DataPoint;
  rasterPopulationPerBuiltUpKm2: DataPoint;
  nonUrbanCentrePopulationEstimate: DataPoint;
  urbanCentrePopulationSharePct: DataPoint;
  rasterSettlementDataCompleteness: TextFactPoint;
  settlementDataCompleteness: TextFactPoint;
};

type CanonicalProvinceData = {
  provinceId: string;
  provinceName: string;
  countryIso3: string | null;
  countryName: string;
  areaKm2: DataPoint;
  settlement: ProvinceSettlementData;
};

type CanonicalProvinceDataFile = Record<string, CanonicalProvinceData>;

type MapMode =
  | "countries"
  | "provinces"
  | "urbanCentrePopulationEstimate"
  | "urbanCentrePopulationDensity"
  | "rasterPopulationDensity"
  | "urbanCentreCount"
  | "urbanCentreBuiltUpSharePct"
  | "population"
  | "gdp"
  | "gdpPerCapita"
  | "gdpGrowth"
  | "inflation"
  | "unemployment"
  | "lifeExpectancy"
  | "governmentDebt"
  | "fiscalBalance"
  | "currentAccount"
  | "voiceAndAccountability"
  | "politicalStability"
  | "governmentEffectiveness"
  | "regulatoryQuality"
  | "ruleOfLaw"
  | "controlOfCorruption"
  | "medianAge"
  | "fertilityRate"
  | "populationGrowth"
  | "netMigration"
  | "youthShare"
  | "workingAgeShare"
  | "elderlyShare"
  | "totalDependency"
  | "totalExports"
  | "totalImports"
  | "tradeBalance"
  | "exportDiversity"
  | "exportConcentration"
  | "economicComplexity"
  | "militaryExpenditure"
  | "militaryExpenditurePctOfGdp"
  | "armedForcesPersonnel"
  | "militarySpendPerCapita"
  | "governmentFamily"
  | "monarchy"
  | "parliament"
  | "elections"
  | "federalism"
  | "onePartyState";

type SelectedProvince = {
  id: string;
  provinceName: string;
  countryName: string;
  countryKey: string;
  iso3: string | null;
  canonicalData: CanonicalCountryData | null;
  countryCanonicalData: CanonicalCountryData | null;
  provinceCanonicalData: CanonicalProvinceData | null;
  rawProperties: Record<string, unknown>;
};

type IndicatorRange = {
  min: number;
  max: number;
};

type ColorLegendEntry = {
  label: string;
  color: string;
};

type MapColorLegend = {
  title: string;
  detail: string;
  entries: ColorLegendEntry[];
  gradientStops?: string[];
  gradientLabels?: {
    left: string;
    center?: string;
    right: string;
  };
};

type CanonicalOverlaySummary = {
  countriesWithData: number;
  provinceMatchRate: number;
  wppCountriesWithData: number;
  wppProvinceMatchRate: number;
  atlasCountriesWithData: number;
  atlasProvinceMatchRate: number;
  securityCountriesWithData: number;
  securityProvinceMatchRate: number;
  factbookCountriesMatched: number;
  politicalProvinceMatchRate: number;
};

const COLOR_RAMPS = {
  urbanCentrePopulationEstimate: { low: "#172554", high: "#60a5fa" },
  urbanCentrePopulationDensity: { low: "#3f6212", high: "#bef264" },
  rasterPopulationDensity: { low: "#082f49", high: "#67e8f9" },
  urbanCentreCount: { low: "#4c0519", high: "#fb7185" },
  urbanCentreBuiltUpSharePct: { low: "#422006", high: "#f59e0b" },
  population: { low: "#0f172a", high: "#38bdf8" },
  gdp: { low: "#052e16", high: "#4ade80" },
  gdpPerCapita: { low: "#422006", high: "#fde047" },
  inflation: { low: "#431407", high: "#fb923c" },
  unemployment: { low: "#2e1065", high: "#c084fc" },
  lifeExpectancy: { low: "#500724", high: "#f9a8d4" },
  governmentDebt: { low: "#064e3b", high: "#ef4444" },
  fiscalBalance: { low: "#991b1b", mid: "#334155", high: "#22c55e" },
  currentAccount: { low: "#7f1d1d", mid: "#334155", high: "#38bdf8" },
  gdpGrowth: { low: "#991b1b", mid: "#334155", high: "#4ade80" },
  governance: { low: "#7f1d1d", mid: "#334155", high: "#22d3ee" },
  medianAge: { low: "#1e3a8a", high: "#f97316" },
  fertilityRate: { low: "#312e81", high: "#facc15" },
  populationGrowth: { low: "#7f1d1d", mid: "#334155", high: "#22c55e" },
  netMigration: { low: "#7f1d1d", mid: "#334155", high: "#38bdf8" },
  youthShare: { low: "#0f172a", high: "#22d3ee" },
  workingAgeShare: { low: "#14532d", high: "#86efac" },
  elderlyShare: { low: "#581c87", high: "#f0abfc" },
  totalDependency: { low: "#164e63", high: "#fb7185" },
  totalExports: { low: "#172554", high: "#60a5fa" },
  totalImports: { low: "#3b0764", high: "#d8b4fe" },
  tradeBalance: { low: "#7f1d1d", mid: "#334155", high: "#22c55e" },
  exportDiversity: { low: "#431407", high: "#facc15" },
  exportConcentration: { low: "#064e3b", high: "#ef4444" },
  economicComplexity: { low: "#1e1b4b", mid: "#334155", high: "#22d3ee" },
  militaryExpenditure: { low: "#172554", high: "#93c5fd" },
  militaryExpenditurePctOfGdp: { low: "#3f1d0d", high: "#f97316" },
  armedForcesPersonnel: { low: "#0f3d2e", high: "#4ade80" },
  militarySpendPerCapita: { low: "#3b0764", high: "#f0abfc" },
} as const;

const POLITICAL_SYSTEM_COLORS = {
  noData: "#475569",
  governmentFamily: {
    presidential_republic: "#2563eb",
    semi_presidential_republic: "#38bdf8",
    parliamentary_republic: "#22c55e",
    federal_republic: "#14b8a6",
    constitutional_monarchy: "#a855f7",
    absolute_monarchy: "#dc2626",
    one_party_state: "#f97316",
    military_regime: "#7f1d1d",
    theocracy: "#facc15",
    confederation: "#84cc16",
    dependent_territory: "#94a3b8",
    other: "#64748b",
  },
  boolean: {
    true: "#22c55e",
    false: "#334155",
    unknown: "#475569",
  },
  warningBoolean: {
    true: "#ef4444",
    false: "#334155",
    unknown: "#475569",
  },
  monarchyBoolean: {
    true: "#a855f7",
    false: "#334155",
    unknown: "#475569",
  },
  federalismBoolean: {
    true: "#38bdf8",
    false: "#334155",
    unknown: "#475569",
  },
} as const;

const MAP_MODES: { key: MapMode; label: string }[] = [
  { key: "countries", label: "Countries" },
  { key: "provinces", label: "Provinces" },
  { key: "urbanCentrePopulationEstimate", label: "Urban-centre population" },
  { key: "urbanCentrePopulationDensity", label: "Urban-centre density" },
  { key: "rasterPopulationDensity", label: "Raster population density" },
  { key: "urbanCentreCount", label: "Urban-centre count" },
  { key: "urbanCentreBuiltUpSharePct", label: "Urban-centre built-up share" },
  { key: "population", label: "Population" },
  { key: "gdp", label: "GDP" },
  { key: "gdpPerCapita", label: "GDP per Capita" },
  { key: "gdpGrowth", label: "GDP Growth" },
  { key: "inflation", label: "Inflation" },
  { key: "unemployment", label: "Unemployment" },
  { key: "lifeExpectancy", label: "Life Expectancy" },
  { key: "governmentDebt", label: "Government Debt" },
  { key: "fiscalBalance", label: "Fiscal Balance" },
  { key: "currentAccount", label: "Current Account" },
  { key: "voiceAndAccountability", label: "Voice & Accountability" },
  { key: "politicalStability", label: "Political Stability" },
  { key: "governmentEffectiveness", label: "Government Effectiveness" },
  { key: "regulatoryQuality", label: "Regulatory Quality" },
  { key: "ruleOfLaw", label: "Rule of Law" },
  { key: "controlOfCorruption", label: "Control of Corruption" },
  { key: "medianAge", label: "Median Age" },
  { key: "fertilityRate", label: "Fertility Rate" },
  { key: "populationGrowth", label: "Population Growth" },
  { key: "netMigration", label: "Net Migration" },
  { key: "youthShare", label: "Youth Share" },
  { key: "workingAgeShare", label: "Working-Age Share" },
  { key: "elderlyShare", label: "Elderly Share" },
  { key: "totalDependency", label: "Dependency Ratio" },
  { key: "totalExports", label: "Exports" },
  { key: "totalImports", label: "Imports" },
  { key: "tradeBalance", label: "Trade Balance" },
  { key: "exportDiversity", label: "Export Diversity" },
  { key: "exportConcentration", label: "Export Concentration" },
  { key: "economicComplexity", label: "Economic Complexity" },
  { key: "militaryExpenditure", label: "Military Expenditure" },
  { key: "militaryExpenditurePctOfGdp", label: "Military Spending (% GDP)" },
  { key: "armedForcesPersonnel", label: "Armed Forces Personnel" },
  { key: "militarySpendPerCapita", label: "Military Spend per Capita" },
  { key: "governmentFamily", label: "Government Type" },
  { key: "monarchy", label: "Monarchy" },
  { key: "parliament", label: "Parliament" },
  { key: "elections", label: "Elections" },
  { key: "federalism", label: "Federalism" },
  { key: "onePartyState", label: "One-Party State" },
];

const MAP_MODE_COLOR_PROPERTY: Record<MapMode, string> = {
  countries: "__countryFillColor",
  provinces: "__provinceFillColor",
  urbanCentrePopulationEstimate: "__urbanCentrePopulationEstimateColor",
  urbanCentrePopulationDensity: "__urbanCentrePopulationDensityColor",
  rasterPopulationDensity: "__rasterPopulationDensityColor",
  urbanCentreCount: "__urbanCentreCountColor",
  urbanCentreBuiltUpSharePct: "__urbanCentreBuiltUpSharePctColor",
  population: "__populationColor",
  gdp: "__gdpColor",
  gdpPerCapita: "__gdpPerCapitaColor",
  gdpGrowth: "__gdpGrowthColor",
  inflation: "__inflationColor",
  unemployment: "__unemploymentColor",
  lifeExpectancy: "__lifeExpectancyColor",
  governmentDebt: "__governmentDebtColor",
  fiscalBalance: "__fiscalBalanceColor",
  currentAccount: "__currentAccountColor",
  voiceAndAccountability: "__voiceAndAccountabilityColor",
  politicalStability: "__politicalStabilityColor",
  governmentEffectiveness: "__governmentEffectivenessColor",
  regulatoryQuality: "__regulatoryQualityColor",
  ruleOfLaw: "__ruleOfLawColor",
  controlOfCorruption: "__controlOfCorruptionColor",
  medianAge: "__medianAgeColor",
  fertilityRate: "__fertilityRateColor",
  populationGrowth: "__populationGrowthColor",
  netMigration: "__netMigrationColor",
  youthShare: "__youthShareColor",
  workingAgeShare: "__workingAgeShareColor",
  elderlyShare: "__elderlyShareColor",
  totalDependency: "__totalDependencyColor",
  totalExports: "__totalExportsColor",
  totalImports: "__totalImportsColor",
  tradeBalance: "__tradeBalanceColor",
  exportDiversity: "__exportDiversityColor",
  exportConcentration: "__exportConcentrationColor",
  economicComplexity: "__economicComplexityColor",
  militaryExpenditure: "__militaryExpenditureColor",
  militaryExpenditurePctOfGdp: "__militaryExpenditurePctOfGdpColor",
  armedForcesPersonnel: "__armedForcesPersonnelColor",
  militarySpendPerCapita: "__militarySpendPerCapitaColor",
  governmentFamily: "__governmentFamilyColor",
  monarchy: "__monarchyColor",
  parliament: "__parliamentColor",
  elections: "__electionsColor",
  federalism: "__federalismColor",
  onePartyState: "__onePartyStateColor",
};

const MAP_MODE_LABEL: Record<MapMode, string> = {
  countries: "Countries",
  provinces: "Provinces",
  urbanCentrePopulationEstimate: "Urban-centre population",
  urbanCentrePopulationDensity: "Urban-centre density",
  rasterPopulationDensity: "Raster population density",
  urbanCentreCount: "Urban-centre count",
  urbanCentreBuiltUpSharePct: "Urban-centre built-up share",
  population: "Population",
  gdp: "GDP",
  gdpPerCapita: "GDP per Capita",
  gdpGrowth: "GDP Growth",
  inflation: "Inflation",
  unemployment: "Unemployment",
  lifeExpectancy: "Life Expectancy",
  governmentDebt: "Government Debt",
  fiscalBalance: "Fiscal Balance",
  currentAccount: "Current Account",
  voiceAndAccountability: "Voice & Accountability",
  politicalStability: "Political Stability",
  governmentEffectiveness: "Government Effectiveness",
  regulatoryQuality: "Regulatory Quality",
  ruleOfLaw: "Rule of Law",
  controlOfCorruption: "Control of Corruption",
  medianAge: "Median Age",
  fertilityRate: "Fertility Rate",
  populationGrowth: "Population Growth",
  netMigration: "Net Migration",
  youthShare: "Youth Share",
  workingAgeShare: "Working-Age Share",
  elderlyShare: "Elderly Share",
  totalDependency: "Dependency Ratio",
  totalExports: "Exports",
  totalImports: "Imports",
  tradeBalance: "Trade Balance",
  exportDiversity: "Export Diversity",
  exportConcentration: "Export Concentration",
  economicComplexity: "Economic Complexity",
  militaryExpenditure: "Military Expenditure",
  militaryExpenditurePctOfGdp: "Military Spending (% GDP)",
  armedForcesPersonnel: "Armed Forces Personnel",
  militarySpendPerCapita: "Military Spend per Capita",
  governmentFamily: "Government Type",
  monarchy: "Monarchy",
  parliament: "Parliament",
  elections: "Elections",
  federalism: "Federalism",
  onePartyState: "One-Party State",
};

const GOVERNMENT_FAMILY_LABELS: Record<keyof typeof POLITICAL_SYSTEM_COLORS.governmentFamily, string> = {
  presidential_republic: "Presidential Republic",
  semi_presidential_republic: "Semi-Presidential Republic",
  parliamentary_republic: "Parliamentary Republic",
  federal_republic: "Federal Republic",
  constitutional_monarchy: "Constitutional Monarchy",
  absolute_monarchy: "Absolute Monarchy",
  one_party_state: "One-Party State",
  military_regime: "Military Regime",
  theocracy: "Theocracy",
  confederation: "Confederation",
  dependent_territory: "Dependent Territory",
  other: "Other / Mixed",
};

function createSequentialLegend(
  title: string,
  detail: string,
  ramp: { low: string; high: string },
  lowLabel = "Lower",
  highLabel = "Higher",
): MapColorLegend {
  return {
    title,
    detail,
    entries: [{ label: "No data", color: NO_DATA_COLOR }],
    gradientStops: [ramp.low, ramp.high],
    gradientLabels: { left: lowLabel, right: highLabel },
  };
}

function createDivergingLegend(
  title: string,
  detail: string,
  ramp: { low: string; mid: string; high: string },
  lowLabel: string,
  midLabel: string,
  highLabel: string,
): MapColorLegend {
  return {
    title,
    detail,
    entries: [{ label: "No data", color: NO_DATA_COLOR }],
    gradientStops: [ramp.low, ramp.mid, ramp.high],
    gradientLabels: { left: lowLabel, center: midLabel, right: highLabel },
  };
}

function getMapColorLegend(mode: MapMode): MapColorLegend {
  if (mode === "countries") {
    return {
      title: MAP_MODE_LABEL[mode],
      detail: "Stable identifier colors (not value-based).",
      entries: [{ label: "Unique color per country", color: COUNTRY_COLOR_PALETTE[0] }],
    };
  }

  if (mode === "provinces") {
    return {
      title: MAP_MODE_LABEL[mode],
      detail: "Stable identifier colors (not value-based).",
      entries: [{ label: "Unique color per province", color: PROVINCE_COLOR_PALETTE[0] }],
    };
  }

  if (mode === "urbanCentrePopulationEstimate") {
    return createSequentialLegend(
      MAP_MODE_LABEL[mode],
      "Matched GHSL urban-centre population captured inside each province.",
      COLOR_RAMPS.urbanCentrePopulationEstimate,
    );
  }

  if (mode === "urbanCentrePopulationDensity") {
    return createSequentialLegend(
      MAP_MODE_LABEL[mode],
      "Matched GHSL urban-centre population per province square kilometre.",
      COLOR_RAMPS.urbanCentrePopulationDensity,
    );
  }

  if (mode === "rasterPopulationDensity") {
    return createSequentialLegend(
      MAP_MODE_LABEL[mode],
      "Full-province GHSL raster population per province square kilometre.",
      COLOR_RAMPS.rasterPopulationDensity,
    );
  }

  if (mode === "urbanCentreCount") {
    return createSequentialLegend(
      MAP_MODE_LABEL[mode],
      "Number of GHSL urban centres matched to each province.",
      COLOR_RAMPS.urbanCentreCount,
    );
  }

  if (mode === "urbanCentreBuiltUpSharePct") {
    return createSequentialLegend(
      MAP_MODE_LABEL[mode],
      "Share of province area covered by matched urban-centre built-up surface.",
      COLOR_RAMPS.urbanCentreBuiltUpSharePct,
    );
  }

  if (mode === "gdpGrowth") {
    return createDivergingLegend(
      MAP_MODE_LABEL[mode],
      "Red = contraction, green = expansion.",
      COLOR_RAMPS.gdpGrowth,
      "Lower",
      "Neutral",
      "Higher",
    );
  }

  if (mode === "fiscalBalance") {
    return createDivergingLegend(
      MAP_MODE_LABEL[mode],
      "Deficit to surplus (% GDP).",
      COLOR_RAMPS.fiscalBalance,
      "Deficit",
      "Near 0",
      "Surplus",
    );
  }

  if (mode === "currentAccount") {
    return createDivergingLegend(
      MAP_MODE_LABEL[mode],
      "Deficit to surplus (% GDP).",
      COLOR_RAMPS.currentAccount,
      "Deficit",
      "Near 0",
      "Surplus",
    );
  }

  if (mode === "populationGrowth") {
    return createDivergingLegend(
      MAP_MODE_LABEL[mode],
      "Negative to positive annual growth.",
      COLOR_RAMPS.populationGrowth,
      "Decline",
      "Flat",
      "Growth",
    );
  }

  if (mode === "netMigration") {
    return createDivergingLegend(
      MAP_MODE_LABEL[mode],
      "Net outflow to net inflow.",
      COLOR_RAMPS.netMigration,
      "Outflow",
      "Balanced",
      "Inflow",
    );
  }

  if (mode === "tradeBalance") {
    return createDivergingLegend(
      MAP_MODE_LABEL[mode],
      "Deficit to surplus (USD).",
      COLOR_RAMPS.tradeBalance,
      "Deficit",
      "Balanced",
      "Surplus",
    );
  }

  if (mode === "economicComplexity") {
    return createDivergingLegend(
      MAP_MODE_LABEL[mode],
      "Lower to higher complexity index.",
      COLOR_RAMPS.economicComplexity,
      "Lower",
      "Median",
      "Higher",
    );
  }

  if (mode === "militaryExpenditure") {
    return createSequentialLegend(MAP_MODE_LABEL[mode], "Total military expenditure (USD).", COLOR_RAMPS.militaryExpenditure);
  }
  if (mode === "militaryExpenditurePctOfGdp") {
    return createSequentialLegend(
      MAP_MODE_LABEL[mode],
      "Military expenditure as a share of GDP.",
      COLOR_RAMPS.militaryExpenditurePctOfGdp,
    );
  }
  if (mode === "armedForcesPersonnel") {
    return createSequentialLegend(
      MAP_MODE_LABEL[mode],
      "Reported active armed-forces personnel.",
      COLOR_RAMPS.armedForcesPersonnel,
    );
  }
  if (mode === "militarySpendPerCapita") {
    return createSequentialLegend(
      MAP_MODE_LABEL[mode],
      "Derived military spending per resident.",
      COLOR_RAMPS.militarySpendPerCapita,
    );
  }

  if (
    mode === "voiceAndAccountability" ||
    mode === "politicalStability" ||
    mode === "governmentEffectiveness" ||
    mode === "regulatoryQuality" ||
    mode === "ruleOfLaw" ||
    mode === "controlOfCorruption"
  ) {
    return createDivergingLegend(
      MAP_MODE_LABEL[mode],
      "WGI scale from lower to higher governance quality.",
      COLOR_RAMPS.governance,
      "Lower",
      "Mid",
      "Higher",
    );
  }

  if (mode === "governmentFamily") {
    const entries: ColorLegendEntry[] = Object.entries(POLITICAL_SYSTEM_COLORS.governmentFamily).map(([key, color]) => ({
      label: GOVERNMENT_FAMILY_LABELS[key as keyof typeof POLITICAL_SYSTEM_COLORS.governmentFamily],
      color,
    }));
    entries.push({ label: "No data", color: POLITICAL_SYSTEM_COLORS.noData });
    return {
      title: MAP_MODE_LABEL[mode],
      detail: "CIA Factbook government-family categories.",
      entries,
    };
  }

  if (mode === "monarchy") {
    return {
      title: MAP_MODE_LABEL[mode],
      detail: "CIA Factbook monarchy flags.",
      entries: [
        { label: "Monarchy", color: POLITICAL_SYSTEM_COLORS.monarchyBoolean.true },
        { label: "No monarchy", color: POLITICAL_SYSTEM_COLORS.monarchyBoolean.false },
        { label: "Unknown", color: POLITICAL_SYSTEM_COLORS.monarchyBoolean.unknown },
      ],
    };
  }

  if (mode === "parliament") {
    return {
      title: MAP_MODE_LABEL[mode],
      detail: "CIA Factbook parliament flags.",
      entries: [
        { label: "Has parliament", color: POLITICAL_SYSTEM_COLORS.boolean.true },
        { label: "No parliament", color: POLITICAL_SYSTEM_COLORS.boolean.false },
        { label: "Unknown", color: POLITICAL_SYSTEM_COLORS.boolean.unknown },
      ],
    };
  }

  if (mode === "elections") {
    return {
      title: MAP_MODE_LABEL[mode],
      detail: "CIA Factbook elections flags.",
      entries: [
        { label: "Has elections", color: POLITICAL_SYSTEM_COLORS.warningBoolean.true },
        { label: "No elections", color: POLITICAL_SYSTEM_COLORS.warningBoolean.false },
        { label: "Unknown", color: POLITICAL_SYSTEM_COLORS.warningBoolean.unknown },
      ],
    };
  }

  if (mode === "federalism") {
    return {
      title: MAP_MODE_LABEL[mode],
      detail: "CIA Factbook federal-state flags.",
      entries: [
        { label: "Federal", color: POLITICAL_SYSTEM_COLORS.federalismBoolean.true },
        { label: "Unitary / non-federal", color: POLITICAL_SYSTEM_COLORS.federalismBoolean.false },
        { label: "Unknown", color: POLITICAL_SYSTEM_COLORS.federalismBoolean.unknown },
      ],
    };
  }

  if (mode === "onePartyState") {
    return {
      title: MAP_MODE_LABEL[mode],
      detail: "CIA Factbook one-party-state flags.",
      entries: [
        { label: "One-party state", color: POLITICAL_SYSTEM_COLORS.warningBoolean.true },
        { label: "Not one-party", color: POLITICAL_SYSTEM_COLORS.warningBoolean.false },
        { label: "Unknown", color: POLITICAL_SYSTEM_COLORS.warningBoolean.unknown },
      ],
    };
  }

  if (mode === "population") {
    return createSequentialLegend(MAP_MODE_LABEL[mode], "Population range.", COLOR_RAMPS.population);
  }
  if (mode === "gdp") {
    return createSequentialLegend(MAP_MODE_LABEL[mode], "Total GDP range.", COLOR_RAMPS.gdp);
  }
  if (mode === "gdpPerCapita") {
    return createSequentialLegend(MAP_MODE_LABEL[mode], "GDP per capita range.", COLOR_RAMPS.gdpPerCapita);
  }
  if (mode === "inflation") {
    return createSequentialLegend(MAP_MODE_LABEL[mode], "Inflation rate range.", COLOR_RAMPS.inflation);
  }
  if (mode === "unemployment") {
    return createSequentialLegend(MAP_MODE_LABEL[mode], "Unemployment rate range.", COLOR_RAMPS.unemployment);
  }
  if (mode === "lifeExpectancy") {
    return createSequentialLegend(MAP_MODE_LABEL[mode], "Life expectancy range.", COLOR_RAMPS.lifeExpectancy);
  }
  if (mode === "governmentDebt") {
    return createSequentialLegend(MAP_MODE_LABEL[mode], "Government gross debt (% GDP).", COLOR_RAMPS.governmentDebt);
  }
  if (mode === "medianAge") {
    return createSequentialLegend(MAP_MODE_LABEL[mode], "Median age range.", COLOR_RAMPS.medianAge);
  }
  if (mode === "fertilityRate") {
    return createSequentialLegend(MAP_MODE_LABEL[mode], "Births per woman range.", COLOR_RAMPS.fertilityRate);
  }
  if (mode === "youthShare") {
    return createSequentialLegend(MAP_MODE_LABEL[mode], "Youth population share range.", COLOR_RAMPS.youthShare);
  }
  if (mode === "workingAgeShare") {
    return createSequentialLegend(
      MAP_MODE_LABEL[mode],
      "Working-age population share range.",
      COLOR_RAMPS.workingAgeShare,
    );
  }
  if (mode === "elderlyShare") {
    return createSequentialLegend(MAP_MODE_LABEL[mode], "Elderly population share range.", COLOR_RAMPS.elderlyShare);
  }
  if (mode === "totalDependency") {
    return createSequentialLegend(MAP_MODE_LABEL[mode], "Dependency ratio range.", COLOR_RAMPS.totalDependency);
  }
  if (mode === "totalExports") {
    return createSequentialLegend(MAP_MODE_LABEL[mode], "Total exports range.", COLOR_RAMPS.totalExports);
  }
  if (mode === "totalImports") {
    return createSequentialLegend(MAP_MODE_LABEL[mode], "Total imports range.", COLOR_RAMPS.totalImports);
  }
  if (mode === "exportDiversity") {
    return createSequentialLegend(MAP_MODE_LABEL[mode], "Distinct export-product count range.", COLOR_RAMPS.exportDiversity);
  }
  if (mode === "exportConcentration") {
    return createSequentialLegend(
      MAP_MODE_LABEL[mode],
      "Export concentration (HHI) range.",
      COLOR_RAMPS.exportConcentration,
    );
  }

  return {
    title: MAP_MODE_LABEL[mode],
    detail: "Color scale unavailable.",
    entries: [{ label: "No data", color: NO_DATA_COLOR }],
  };
}

const EMPTY_POINT: DataPoint = { value: null, year: null, source: null };
const EMPTY_TEXT_FACT_POINT: TextFactPoint = { value: null, year: null, source: null };

function normalizeProvinceSettlementData(settlement: Record<string, unknown>): ProvinceSettlementData {
  return {
    urbanCentrePopulationEstimate: isDataPoint(settlement.urbanCentrePopulationEstimate) ? settlement.urbanCentrePopulationEstimate : EMPTY_POINT,
    urbanCentrePopulationDensityPerKm2: isDataPoint(settlement.urbanCentrePopulationDensityPerKm2)
      ? settlement.urbanCentrePopulationDensityPerKm2
      : EMPTY_POINT,
    urbanCentreBuiltUpAreaKm2: isDataPoint(settlement.urbanCentreBuiltUpAreaKm2) ? settlement.urbanCentreBuiltUpAreaKm2 : EMPTY_POINT,
    urbanCentreBuiltUpSharePct: isDataPoint(settlement.urbanCentreBuiltUpSharePct) ? settlement.urbanCentreBuiltUpSharePct : EMPTY_POINT,
    urbanCentreCount: isDataPoint(settlement.urbanCentreCount) ? settlement.urbanCentreCount : EMPTY_POINT,
    largestUrbanCentreId: typeof settlement.largestUrbanCentreId === "string" ? settlement.largestUrbanCentreId : null,
    largestUrbanCentreName: typeof settlement.largestUrbanCentreName === "string" ? settlement.largestUrbanCentreName : null,
    largestUrbanCentrePopulationEstimate: isDataPoint(settlement.largestUrbanCentrePopulationEstimate)
      ? settlement.largestUrbanCentrePopulationEstimate
      : EMPTY_POINT,
    populationConcentrationHhi: isDataPoint(settlement.populationConcentrationHhi)
      ? settlement.populationConcentrationHhi
      : EMPTY_POINT,
    rasterPopulationEstimate: isDataPoint(settlement.rasterPopulationEstimate) ? settlement.rasterPopulationEstimate : EMPTY_POINT,
    rasterPopulationDensityPerKm2: isDataPoint(settlement.rasterPopulationDensityPerKm2)
      ? settlement.rasterPopulationDensityPerKm2
      : EMPTY_POINT,
    rasterBuiltUpSurfaceKm2: isDataPoint(settlement.rasterBuiltUpSurfaceKm2) ? settlement.rasterBuiltUpSurfaceKm2 : EMPTY_POINT,
    rasterBuiltUpSurfaceSharePct: isDataPoint(settlement.rasterBuiltUpSurfaceSharePct)
      ? settlement.rasterBuiltUpSurfaceSharePct
      : EMPTY_POINT,
    rasterPopulationPerBuiltUpKm2: isDataPoint(settlement.rasterPopulationPerBuiltUpKm2)
      ? settlement.rasterPopulationPerBuiltUpKm2
      : EMPTY_POINT,
    nonUrbanCentrePopulationEstimate: isDataPoint(settlement.nonUrbanCentrePopulationEstimate)
      ? settlement.nonUrbanCentrePopulationEstimate
      : EMPTY_POINT,
    urbanCentrePopulationSharePct: isDataPoint(settlement.urbanCentrePopulationSharePct)
      ? settlement.urbanCentrePopulationSharePct
      : EMPTY_POINT,
    rasterSettlementDataCompleteness: isTextFactPoint(settlement.rasterSettlementDataCompleteness)
      ? settlement.rasterSettlementDataCompleteness
      : {
          value: "partial-ghsl-raster",
          year: 2025,
          source: "GHSL GHS-POP R2023A + GHSL GHS-BUILT-S R2023A",
        },
    settlementDataCompleteness: isTextFactPoint(settlement.settlementDataCompleteness)
      ? settlement.settlementDataCompleteness
      : EMPTY_TEXT_FACT_POINT,
  };
}

function normalizeCanonicalProvinceDataFile(value: CanonicalProvinceDataFile): CanonicalProvinceDataFile {
  return Object.fromEntries(
    Object.entries(value).map(([provinceId, record]) => [
      provinceId,
      {
        ...record,
        settlement: normalizeProvinceSettlementData(record.settlement as unknown as Record<string, unknown>),
      },
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDataPoint(value: unknown): value is DataPoint {
  return (
    isRecord(value) &&
    (typeof value.value === "number" || value.value === null) &&
    (typeof value.year === "number" || value.year === null) &&
    (typeof value.source === "string" || value.source === null)
  );
}

function isTextFactPoint(value: unknown): value is TextFactPoint {
  return (
    isRecord(value) &&
    (typeof value.value === "string" || value.value === null) &&
    (typeof value.year === "number" || value.year === null) &&
    (typeof value.source === "string" || value.source === null)
  );
}

function isTextDataPoint(value: unknown): value is TextDataPoint {
  return (
    isRecord(value) &&
    (typeof value.value === "string" || value.value === null) &&
    (value.source === "CIA World Factbook" || value.source === null)
  );
}

function isBooleanDataPoint(value: unknown): value is BooleanDataPoint {
  return (
    isRecord(value) &&
    (typeof value.value === "boolean" || value.value === null) &&
    (value.source === "CIA World Factbook" || value.source === null)
  );
}

function isCanonicalCountryData(value: unknown): value is CanonicalCountryData {
  if (!isRecord(value) || typeof value.iso3 !== "string" || typeof value.name !== "string") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    !isRecord(record.economy) ||
    !isRecord(record.fiscal) ||
    !isRecord(record.governance) ||
    !isRecord(record.demographics) ||
    !isRecord(record.tradeStructure) ||
    !isRecord(record.security) ||
    !isRecord(record.politicalSystem)
  ) {
    return false;
  }
  const economy = record.economy as Record<string, unknown>;
  const fiscal = record.fiscal as Record<string, unknown>;
  const governance = record.governance as Record<string, unknown>;
  const demographics = record.demographics as Record<string, unknown>;
  const tradeStructure = record.tradeStructure as Record<string, unknown>;
  const security = record.security as Record<string, unknown>;
  const politicalSystem = record.politicalSystem as Record<string, unknown>;

  const economyKeys: Array<keyof EconomyData> = [
    "population",
    "gdpCurrentUsd",
    "gdpPerCapitaCurrentUsd",
    "gdpGrowthAnnualPct",
    "inflationAnnualPct",
    "unemploymentPct",
    "urbanPopulationPct",
    "lifeExpectancyYears",
    "tradePctOfGdp",
  ];
  const fiscalKeys: Array<keyof FiscalData> = [
    "currentAccountBalancePctOfGdp",
    "governmentNetLendingBorrowingPctOfGdp",
    "governmentGrossDebtPctOfGdp",
  ];
  const governanceKeys: Array<keyof GovernanceData> = [
    "voiceAndAccountability",
    "politicalStability",
    "governmentEffectiveness",
    "regulatoryQuality",
    "ruleOfLaw",
    "controlOfCorruption",
  ];
  const demographicsKeys: Array<keyof DemographicsData> = [
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
  ];
  const tradeStructureKeys: Array<keyof Omit<TradeStructureData, "topExports" | "topImports">> = [
    "totalExportsUsd",
    "totalImportsUsd",
    "tradeBalanceUsd",
    "exportDiversityProductCount",
    "importDiversityProductCount",
    "exportConcentrationHhi",
    "importConcentrationHhi",
    "economicComplexityIndex",
  ];
  const securityKeys: Array<keyof SecurityData> = [
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
  const politicalTextKeys: Array<keyof Omit<PoliticalSystemData, "source" | "hasMonarchy" | "hasParliament" | "hasElections" | "hasUniversalSuffrage" | "isFederal" | "isRepublic" | "isOnePartyState" | "isMilitaryRegime">> = [
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
  const politicalBooleanKeys: Array<
    keyof Pick<
      PoliticalSystemData,
      | "hasMonarchy"
      | "hasParliament"
      | "hasElections"
      | "hasUniversalSuffrage"
      | "isFederal"
      | "isRepublic"
      | "isOnePartyState"
      | "isMilitaryRegime"
    >
  > = [
    "hasMonarchy",
    "hasParliament",
    "hasElections",
    "hasUniversalSuffrage",
    "isFederal",
    "isRepublic",
    "isOnePartyState",
    "isMilitaryRegime",
  ];

  return (
    economyKeys.every((key) => isDataPoint(economy[key])) &&
    fiscalKeys.every((key) => isDataPoint(fiscal[key])) &&
    governanceKeys.every((key) => isDataPoint(governance[key])) &&
    demographicsKeys.every((key) => isDataPoint(demographics[key])) &&
    tradeStructureKeys.every((key) => isDataPoint(tradeStructure[key])) &&
    securityKeys.every((key) => isDataPoint(security[key])) &&
    Array.isArray(tradeStructure.topExports) &&
    Array.isArray(tradeStructure.topImports) &&
    (politicalSystem.source === "CIA World Factbook" || politicalSystem.source === null) &&
    politicalTextKeys.every((key) => isTextDataPoint(politicalSystem[key])) &&
    politicalBooleanKeys.every((key) => isBooleanDataPoint(politicalSystem[key]))
  );
}

function isCanonicalCountryDataFile(value: unknown): value is CanonicalCountryDataFile {
  if (!isRecord(value) || !isRecord(value.countriesByIso3)) {
    return false;
  }
  return Object.values(value.countriesByIso3).every((country) => isCanonicalCountryData(country));
}

function isCanonicalProvinceData(value: unknown): value is CanonicalProvinceData {
  return (
    isRecord(value) &&
    typeof value.provinceId === "string" &&
    typeof value.provinceName === "string" &&
    typeof value.countryName === "string" &&
    isDataPoint(value.areaKm2) &&
    isRecord(value.settlement) &&
    isDataPoint(value.settlement.urbanCentrePopulationEstimate) &&
    isDataPoint(value.settlement.urbanCentrePopulationDensityPerKm2) &&
    isDataPoint(value.settlement.urbanCentreBuiltUpAreaKm2) &&
    isDataPoint(value.settlement.urbanCentreBuiltUpSharePct) &&
    isDataPoint(value.settlement.urbanCentreCount) &&
    (typeof value.settlement.largestUrbanCentreId === "string" || value.settlement.largestUrbanCentreId === null) &&
    (typeof value.settlement.largestUrbanCentreName === "string" || value.settlement.largestUrbanCentreName === null) &&
    isDataPoint(value.settlement.largestUrbanCentrePopulationEstimate) &&
    isDataPoint(value.settlement.populationConcentrationHhi) &&
    isTextFactPoint(value.settlement.settlementDataCompleteness)
  );
}

function isCanonicalProvinceDataFile(value: unknown): value is CanonicalProvinceDataFile {
  return isRecord(value) && Object.values(value).every((record) => isCanonicalProvinceData(record));
}

function isProvinceFeatureCollection(value: unknown): value is ProvinceFeatureCollection {
  if (!isRecord(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
    return false;
  }
  return value.features.every((feature) => isRecord(feature) && feature.type === "Feature");
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getCountryKey(properties: FeatureProperties): string {
  const candidates = [
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
  ];
  for (const key of candidates) {
    const value = properties[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "Unknown";
}

function getProvinceName(properties: Record<string, unknown>): string {
  const candidates = [
    "name",
    "NAME",
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
  ];
  for (const key of candidates) {
    const value = properties[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "Unknown province";
}

function getProvinceIso3(properties: Record<string, unknown>): string | null {
  for (const key of ISO3_PROPERTY_CANDIDATES) {
    const value = properties[key];
    if (typeof value === "string") {
      const normalized = value.trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(normalized)) {
        return normalized;
      }
    }
  }
  return null;
}

function getProvinceStableId(properties: Record<string, unknown>, fallbackIndex: number): string {
  const candidates = ["adm1_code", "ADM1_CODE", "iso_3166_2", "ISO_3166_2", "code_hasc", "CODE_HASC"];
  for (const key of candidates) {
    const value = properties[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return `province-${fallbackIndex}`;
}

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function getCountryColor(countryKey: string): string {
  const colorIndex = hashString(countryKey) % COUNTRY_COLOR_PALETTE.length;
  return COUNTRY_COLOR_PALETTE[colorIndex];
}

function getProvinceColor(provinceId: string): string {
  const colorIndex = hashString(provinceId) % PROVINCE_COLOR_PALETTE.length;
  return PROVINCE_COLOR_PALETTE[colorIndex];
}

function normalizeValue(value: number | null, min: number, max: number): number | null {
  if (value === null || Number.isNaN(value)) {
    return null;
  }
  if (max === min) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

function normalizeWgiScore(value: number | null): number | null {
  if (value === null || Number.isNaN(value)) {
    return null;
  }
  return Math.max(0, Math.min(1, (value + 2.5) / 5));
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}

function interpolateColor(lowHex: string, highHex: string, t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const [lr, lg, lb] = hexToRgb(lowHex);
  const [hr, hg, hb] = hexToRgb(highHex);
  const r = Math.round(lr + (hr - lr) * clamped);
  const g = Math.round(lg + (hg - lg) * clamped);
  const b = Math.round(lb + (hb - lb) * clamped);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b
    .toString(16)
    .padStart(2, "0")}`;
}

function interpolateDivergingColor(
  value: number | null,
  maxAbs: number | null,
  ramp: { low: string; mid: string; high: string },
): string {
  if (value === null || maxAbs === null || maxAbs === 0) {
    return value === null ? NO_DATA_COLOR : ramp.mid;
  }
  const normalized = Math.max(-1, Math.min(1, value / maxAbs));
  if (normalized < 0) {
    return interpolateColor(ramp.low, ramp.mid, normalized + 1);
  }
  return interpolateColor(ramp.mid, ramp.high, normalized);
}

function interpolateGovernanceColor(value: number | null): string {
  const t = normalizeWgiScore(value);
  if (t === null) {
    return NO_DATA_COLOR;
  }
  if (t <= 0.5) {
    return interpolateColor(COLOR_RAMPS.governance.low, COLOR_RAMPS.governance.mid, t / 0.5);
  }
  return interpolateColor(COLOR_RAMPS.governance.mid, COLOR_RAMPS.governance.high, (t - 0.5) / 0.5);
}

function getMaxAbs(values: Array<number | null>): number | null {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (filtered.length === 0) {
    return null;
  }
  return Math.max(...filtered.map((value) => Math.abs(value)));
}

function getIndicatorRange(values: Array<number | null>): IndicatorRange | null {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (filtered.length === 0) {
    return null;
  }
  return { min: Math.min(...filtered), max: Math.max(...filtered) };
}

function getFeatureProperties(feature: MapGeoJSONFeature): Record<string, unknown> {
  return isRecord(feature.properties) ? feature.properties : {};
}

function getFeatureId(feature: MapGeoJSONFeature): string | null {
  if (typeof feature.id === "string" || typeof feature.id === "number") {
    return String(feature.id);
  }
  return null;
}

function formatInteger(value: number | null): string {
  if (value === null) {
    return "No data";
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "No data";
  }
  return `${value.toFixed(1)}%`;
}

function formatPeoplePerKm2(value: number | null): string {
  if (value === null) {
    return "No data";
  }
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)} / km2`;
}

function formatYears(value: number | null): string {
  if (value === null) {
    return "No data";
  }
  return `${value.toFixed(1)} years`;
}

function formatGovernanceScore(value: number | null): string {
  if (value === null) {
    return "No data";
  }
  return value.toFixed(2);
}

function formatUsd(value: number | null): string {
  if (value === null) {
    return "No data";
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) {
    return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (abs >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)}`;
}

function formatUsdPerCapita(value: number | null): string {
  if (value === null) {
    return "No data";
  }
  return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)}`;
}

function formatSignedUsd(value: number | null): string {
  if (value === null) {
    return "No data";
  }
  if (value < 0) {
    return `-${formatUsd(Math.abs(value))}`;
  }
  return formatUsd(value);
}

function formatFertilityRate(value: number | null): string {
  if (value === null) {
    return "No data";
  }
  return `${value.toFixed(2)} births/woman`;
}

function formatDependencyRatio(value: number | null): string {
  if (value === null) {
    return "No data";
  }
  return `${value.toFixed(1)} per 100 working-age people`;
}

function formatHhi(value: number | null): string {
  if (value === null) {
    return "No data";
  }
  return value.toFixed(3);
}

function formatBooleanValue(value: boolean | null): string {
  if (value === null) {
    return "Unknown";
  }
  return value ? "Yes" : "No";
}

function normalizeLooseText(text: string | null | undefined): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function includesLooseNeedle(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(normalizeLooseText(needle)));
}

function inferOnePartyStateFromPoliticalSystem(politicalSystem: PoliticalSystemData | null): boolean | null {
  if (!politicalSystem) {
    return null;
  }

  const governmentType = politicalSystem.governmentType.value;
  const parties = politicalSystem.politicalPartiesAndLeaders.value;
  if (!governmentType && !parties) {
    return null;
  }

  const combined = normalizeLooseText(`${governmentType ?? ""} ${parties ?? ""}`);
  const partiesText = normalizeLooseText(parties ?? "");

  const strongPositiveSignals = [
    "single party",
    "single-party",
    "one party state",
    "one-party state",
    "one party rule",
    "one-party rule",
    "one party system",
    "one-party system",
    "only party",
    "only legal party",
    "sole legal party",
    "the only party recognized by the government",
    "banned other political parties",
    "ban on political parties",
    "communist state",
    "party led state",
    "party-led state",
  ];

  if (includesLooseNeedle(combined, strongPositiveSignals)) {
    return true;
  }

  if (includesLooseNeedle(partiesText, ["communist party"])) {
    return false;
  }

  return false;
}

function getBooleanColor(
  value: boolean | null,
  palette: { true: string; false: string; unknown: string },
): string {
  if (value === true) {
    return palette.true;
  }
  if (value === false) {
    return palette.false;
  }
  return palette.unknown;
}

function getGovernmentFamilyColor(value: string | null): string {
  if (!value) {
    return POLITICAL_SYSTEM_COLORS.noData;
  }
  const key = value as keyof typeof POLITICAL_SYSTEM_COLORS.governmentFamily;
  return POLITICAL_SYSTEM_COLORS.governmentFamily[key] ?? POLITICAL_SYSTEM_COLORS.governmentFamily.other;
}

function getSourceAbbreviation(source: DataSource): string {
  if (source === "World Bank WDI") {
    return "WDI";
  }
  if (source === "World Bank WGI") {
    return "WGI";
  }
  if (source === "World Bank WDI / SIPRI") {
    return "SIPRI";
  }
  if (source === "World Bank WDI / IISS") {
    return "IISS";
  }
  if (source === "IMF WEO / DataMapper") {
    return "IMF";
  }
  if (source === "UN WPP 2024") {
    return "WPP";
  }
  if (source === "Atlas of Economic Complexity") {
    return "ATL";
  }
  if (source === "CIA World Factbook") {
    return "CIA";
  }
  if (typeof source === "string" && source.startsWith("GHSL")) {
    return "GHSL";
  }
  if (typeof source === "string" && source.startsWith("Derived from ")) {
    return "DRV";
  }
  return "-";
}

function formatPoint(point: DataPoint, formatter: (value: number | null) => string): string {
  if (point.value === null) {
    return "No data";
  }
  return `${formatter(point.value)} - ${point.year ?? "n/a"} - ${getSourceAbbreviation(point.source)}`;
}

function formatTextPoint(point: TextDataPoint): string {
  if (point.value === null) {
    return "No data";
  }
  return point.value;
}

function formatBooleanPoint(point: BooleanDataPoint): string {
  return formatBooleanValue(point.value);
}

function getActiveMapValue(
  mode: MapMode,
  countryData: CanonicalCountryData | null,
  provinceData: CanonicalProvinceData | null,
): string {
  if (mode === "countries" || mode === "provinces") {
    return "Political coloring";
  }

  if (mode === "urbanCentrePopulationEstimate") {
    return `Urban-centre population - ${formatPoint(
      provinceData?.settlement.urbanCentrePopulationEstimate ?? EMPTY_POINT,
      formatInteger,
    )}`;
  }
  if (mode === "urbanCentrePopulationDensity") {
    return `Urban-centre density - ${formatPoint(
      provinceData?.settlement.urbanCentrePopulationDensityPerKm2 ?? EMPTY_POINT,
      formatPeoplePerKm2,
    )}`;
  }
  if (mode === "rasterPopulationDensity") {
    return `Raster population density - ${formatPoint(
      provinceData?.settlement.rasterPopulationDensityPerKm2 ?? EMPTY_POINT,
      formatPeoplePerKm2,
    )}`;
  }
  if (mode === "urbanCentreCount") {
    return `Urban-centre count - ${formatPoint(
      provinceData?.settlement.urbanCentreCount ?? EMPTY_POINT,
      formatInteger,
    )}`;
  }
  if (mode === "urbanCentreBuiltUpSharePct") {
    return `Urban-centre built-up share - ${formatPoint(
      provinceData?.settlement.urbanCentreBuiltUpSharePct ?? EMPTY_POINT,
      formatPercent,
    )}`;
  }

  if (!countryData) {
    return "No data";
  }
  if (mode === "population") {
    return `Population - ${formatInteger(countryData.economy.population.value)}`;
  }
  if (mode === "gdp") {
    return `GDP - ${formatUsd(countryData.economy.gdpCurrentUsd.value)}`;
  }
  if (mode === "gdpPerCapita") {
    return `GDP per Capita - ${formatUsdPerCapita(countryData.economy.gdpPerCapitaCurrentUsd.value)}`;
  }
  if (mode === "gdpGrowth") {
    return `GDP Growth - ${formatPercent(countryData.economy.gdpGrowthAnnualPct.value)}`;
  }
  if (mode === "inflation") {
    return `Inflation - ${formatPercent(countryData.economy.inflationAnnualPct.value)}`;
  }
  if (mode === "unemployment") {
    return `Unemployment - ${formatPercent(countryData.economy.unemploymentPct.value)}`;
  }
  if (mode === "lifeExpectancy") {
    return `Life Expectancy - ${formatYears(countryData.economy.lifeExpectancyYears.value)}`;
  }
  if (mode === "governmentDebt") {
    return `Government Debt - ${formatPercent(countryData.fiscal.governmentGrossDebtPctOfGdp.value)} of GDP`;
  }
  if (mode === "fiscalBalance") {
    return `Fiscal Balance - ${formatPercent(countryData.fiscal.governmentNetLendingBorrowingPctOfGdp.value)} of GDP`;
  }
  if (mode === "currentAccount") {
    return `Current Account - ${formatPercent(countryData.fiscal.currentAccountBalancePctOfGdp.value)} of GDP`;
  }
  if (mode === "voiceAndAccountability") {
    return `Voice & Accountability - ${formatGovernanceScore(countryData.governance.voiceAndAccountability.value)}`;
  }
  if (mode === "politicalStability") {
    return `Political Stability - ${formatGovernanceScore(countryData.governance.politicalStability.value)}`;
  }
  if (mode === "governmentEffectiveness") {
    return `Government Effectiveness - ${formatGovernanceScore(countryData.governance.governmentEffectiveness.value)}`;
  }
  if (mode === "regulatoryQuality") {
    return `Regulatory Quality - ${formatGovernanceScore(countryData.governance.regulatoryQuality.value)}`;
  }
  if (mode === "ruleOfLaw") {
    return `Rule of Law - ${formatGovernanceScore(countryData.governance.ruleOfLaw.value)}`;
  }
  if (mode === "controlOfCorruption") {
    return `Control of Corruption - ${formatGovernanceScore(countryData.governance.controlOfCorruption.value)}`;
  }
  if (mode === "medianAge") {
    return `Median Age - ${formatYears(countryData.demographics.medianAgeYears.value)}`;
  }
  if (mode === "fertilityRate") {
    return `Fertility Rate - ${formatFertilityRate(countryData.demographics.fertilityRateBirthsPerWoman.value)}`;
  }
  if (mode === "populationGrowth") {
    return `Population Growth - ${formatPercent(countryData.demographics.populationGrowthRatePct.value)}`;
  }
  if (mode === "netMigration") {
    return `Net Migration - ${formatInteger(countryData.demographics.netMigration.value)}`;
  }
  if (mode === "youthShare") {
    return `Youth Share - ${formatPercent(countryData.demographics.youthSharePct.value)}`;
  }
  if (mode === "workingAgeShare") {
    return `Working-Age Share - ${formatPercent(countryData.demographics.workingAgeSharePct.value)}`;
  }
  if (mode === "elderlyShare") {
    return `Elderly Share - ${formatPercent(countryData.demographics.elderlySharePct.value)}`;
  }
  if (mode === "totalDependency") {
    return `Dependency Ratio - ${formatDependencyRatio(countryData.demographics.totalDependencyRatio.value)}`;
  }
  if (mode === "totalExports") {
    return `Exports - ${formatUsd(countryData.tradeStructure.totalExportsUsd.value)}`;
  }
  if (mode === "totalImports") {
    return `Imports - ${formatUsd(countryData.tradeStructure.totalImportsUsd.value)}`;
  }
  if (mode === "tradeBalance") {
    return `Trade Balance - ${formatSignedUsd(countryData.tradeStructure.tradeBalanceUsd.value)}`;
  }
  if (mode === "exportDiversity") {
    return `Export Diversity - ${formatInteger(countryData.tradeStructure.exportDiversityProductCount.value)} products`;
  }
  if (mode === "exportConcentration") {
    return `Export Concentration - ${formatHhi(countryData.tradeStructure.exportConcentrationHhi.value)}`;
  }
  if (mode === "economicComplexity") {
    return `Economic Complexity - ${formatGovernanceScore(countryData.tradeStructure.economicComplexityIndex.value)}`;
  }
  if (mode === "militaryExpenditure") {
    return `Military Expenditure - ${formatUsd(countryData.security.militaryExpenditureUsd.value)}`;
  }
  if (mode === "militaryExpenditurePctOfGdp") {
    return `Military Spending - ${formatPercent(countryData.security.militaryExpenditurePctOfGdp.value)} of GDP`;
  }
  if (mode === "armedForcesPersonnel") {
    return `Armed Forces - ${formatInteger(countryData.security.armedForcesPersonnel.value)}`;
  }
  if (mode === "militarySpendPerCapita") {
    return `Military Spend per Capita - ${formatUsdPerCapita(countryData.security.militarySpendPerCapitaUsd.value)}`;
  }
  if (mode === "governmentFamily") {
    return `Government Type - ${countryData.politicalSystem.governmentFamily.value ?? "Unknown"}`;
  }
  if (mode === "monarchy") {
    return `Monarchy - ${formatBooleanValue(countryData.politicalSystem.hasMonarchy.value)}`;
  }
  if (mode === "parliament") {
    return `Parliament - ${formatBooleanValue(countryData.politicalSystem.hasParliament.value)}`;
  }
  if (mode === "elections") {
    return `Elections - ${formatBooleanValue(countryData.politicalSystem.hasElections.value)}`;
  }
  if (mode === "federalism") {
    return `Federalism - ${formatBooleanValue(countryData.politicalSystem.isFederal.value)}`;
  }
  return `One-Party State - ${formatBooleanValue(inferOnePartyStateFromPoliticalSystem(countryData.politicalSystem))}`;
}

function buildGeoJsonForMode(baseGeoJson: ProvinceFeatureCollection, mode: MapMode): ProvinceFeatureCollection {
  const colorProperty = MAP_MODE_COLOR_PROPERTY[mode];
  return {
    ...baseGeoJson,
    features: baseGeoJson.features.map((feature) => {
      const props = isRecord(feature.properties) ? feature.properties : {};
      const activeColor = typeof props[colorProperty] === "string" ? props[colorProperty] : NO_DATA_COLOR;
      return {
        ...feature,
        properties: {
          ...props,
          __activeFillColor: activeColor,
        },
      };
    }),
  };
}

const baseStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#0f172a",
      },
    },
  ],
};

export function GameCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const baseProcessedGeoJsonRef = useRef<ProvinceFeatureCollection | null>(null);
  const hoveredProvinceIdRef = useRef<string | null>(null);
  const selectedProvinceIdRef = useRef<string | null>(null);
  const hasLoggedCountryBorderErrorRef = useRef(false);

  const [mapMode, setMapMode] = useState<MapMode>("countries");
  const [selectedProvince, setSelectedProvince] = useState<SelectedProvince | null>(null);
  const [overlaySummary, setOverlaySummary] = useState<CanonicalOverlaySummary>({
    countriesWithData: 0,
    provinceMatchRate: 0,
    wppCountriesWithData: 0,
    wppProvinceMatchRate: 0,
    atlasCountriesWithData: 0,
    atlasProvinceMatchRate: 0,
    securityCountriesWithData: 0,
    securityProvinceMatchRate: 0,
    factbookCountriesMatched: 0,
    politicalProvinceMatchRate: 0,
  });

  const selectedPropertyPreview = useMemo(() => {
    if (!selectedProvince) {
      return [];
    }
    return Object.entries(selectedProvince.rawProperties).slice(0, 10);
  }, [selectedProvince]);

  const selectedTopExports = useMemo(
    () => (selectedProvince?.countryCanonicalData?.tradeStructure.topExports ?? []).slice(0, 5),
    [selectedProvince],
  );
  const selectedTopImports = useMemo(
    () => (selectedProvince?.countryCanonicalData?.tradeStructure.topImports ?? []).slice(0, 5),
    [selectedProvince],
  );

  useEffect(() => {
    if (mapRef.current || !containerRef.current) {
      return;
    }

    let isUnmounted = false;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: baseStyle,
      center: [0, 20],
      zoom: 1.1,
      dragRotate: false,
      pitchWithRotate: false,
    });

    map.touchZoomRotate.disableRotation();

    map.on("load", () => {
      const loadProvinceData = async () => {
        try {
          const [provinceResponse, canonicalResponse, canonicalProvinceResponse] = await Promise.all([
            fetch("/data/provinces.geojson"),
            fetch("/data/canonical-country-data.json").catch(() => null),
            fetch("/data/canonical-province-data.json").catch(() => null),
          ]);

          if (!provinceResponse.ok) {
            throw new Error(`HTTP ${provinceResponse.status} while loading /data/provinces.geojson`);
          }

          const rawGeoJson: unknown = await provinceResponse.json();
          if (!isProvinceFeatureCollection(rawGeoJson)) {
            throw new Error("Invalid provinces GeoJSON: expected FeatureCollection.");
          }

          let canonicalByIso3: Record<string, CanonicalCountryData> = {};
          if (canonicalResponse && canonicalResponse.ok) {
            const canonicalJson: unknown = await canonicalResponse.json();
            if (isCanonicalCountryDataFile(canonicalJson)) {
              canonicalByIso3 = canonicalJson.countriesByIso3;
            } else {
              console.warn("canonical-country-data.json is not in expected shape; continuing without country stats.");
            }
          } else {
            console.warn("Could not load /data/canonical-country-data.json; continuing without canonical country stats.");
          }

          let canonicalProvinceById: CanonicalProvinceDataFile = {};
          if (canonicalProvinceResponse && canonicalProvinceResponse.ok) {
            const canonicalProvinceJson: unknown = await canonicalProvinceResponse.json();
            if (isCanonicalProvinceDataFile(canonicalProvinceJson)) {
              canonicalProvinceById = normalizeCanonicalProvinceDataFile(canonicalProvinceJson);
            } else {
              console.warn("canonical-province-data.json is not in expected shape; continuing without province settlement stats.");
            }
          } else {
            console.warn("Could not load /data/canonical-province-data.json; continuing without province settlement stats.");
          }

          const countryNameToIso3 = new Map<string, string>();
          for (const [iso3, country] of Object.entries(canonicalByIso3)) {
            countryNameToIso3.set(normalizeName(country.name), iso3);
          }

          const countriesWithData = Object.keys(canonicalByIso3).length;
          let matchedProvinceCount = 0;
          const countryValues = Object.values(canonicalByIso3);
          const wppCountriesWithData = countryValues.filter((country) =>
            Object.values(country.demographics).some((point) => point.value !== null),
          ).length;
          const atlasCountriesWithData = countryValues.filter((country) =>
            [
              country.tradeStructure.totalExportsUsd,
              country.tradeStructure.totalImportsUsd,
              country.tradeStructure.tradeBalanceUsd,
              country.tradeStructure.exportDiversityProductCount,
              country.tradeStructure.importDiversityProductCount,
              country.tradeStructure.exportConcentrationHhi,
              country.tradeStructure.importConcentrationHhi,
              country.tradeStructure.economicComplexityIndex,
            ].some((point) => point.value !== null),
          ).length;
          const factbookCountriesMatched = countryValues.filter(
            (country) => country.politicalSystem.source === "CIA World Factbook",
          ).length;
          const securityCountriesWithData = countryValues.filter((country) =>
            Object.values(country.security).some((point) => point.value !== null),
          ).length;
          const provinceValues = Object.values(canonicalProvinceById);
          const populationRange = getIndicatorRange(countryValues.map((country) => country.economy.population.value));
          const provincePopulationEstimateRange = getIndicatorRange(
            provinceValues.map((province) => province.settlement.urbanCentrePopulationEstimate.value),
          );
          const provincePopulationDensityRange = getIndicatorRange(
            provinceValues.map((province) => province.settlement.urbanCentrePopulationDensityPerKm2.value),
          );
          const provinceRasterPopulationDensityRange = getIndicatorRange(
            provinceValues.map((province) => province.settlement.rasterPopulationDensityPerKm2.value),
          );
          const urbanCentreCountRange = getIndicatorRange(
            provinceValues.map((province) => province.settlement.urbanCentreCount.value),
          );
          const builtUpSharePctRange = getIndicatorRange(
            provinceValues.map((province) => province.settlement.urbanCentreBuiltUpSharePct.value),
          );
          const gdpRange = getIndicatorRange(countryValues.map((country) => country.economy.gdpCurrentUsd.value));
          const gdpPerCapitaRange = getIndicatorRange(
            countryValues.map((country) => country.economy.gdpPerCapitaCurrentUsd.value),
          );
          const inflationRange = getIndicatorRange(countryValues.map((country) => country.economy.inflationAnnualPct.value));
          const unemploymentRange = getIndicatorRange(countryValues.map((country) => country.economy.unemploymentPct.value));
          const lifeExpectancyRange = getIndicatorRange(
            countryValues.map((country) => country.economy.lifeExpectancyYears.value),
          );
          const debtRange = getIndicatorRange(
            countryValues.map((country) => country.fiscal.governmentGrossDebtPctOfGdp.value),
          );
          const gdpGrowthMaxAbs = getMaxAbs(countryValues.map((country) => country.economy.gdpGrowthAnnualPct.value));
          const fiscalBalanceMaxAbs = getMaxAbs(
            countryValues.map((country) => country.fiscal.governmentNetLendingBorrowingPctOfGdp.value),
          );
          const currentAccountMaxAbs = getMaxAbs(
            countryValues.map((country) => country.fiscal.currentAccountBalancePctOfGdp.value),
          );
          const medianAgeRange = getIndicatorRange(countryValues.map((country) => country.demographics.medianAgeYears.value));
          const fertilityRateRange = getIndicatorRange(
            countryValues.map((country) => country.demographics.fertilityRateBirthsPerWoman.value),
          );
          const youthShareRange = getIndicatorRange(countryValues.map((country) => country.demographics.youthSharePct.value));
          const workingAgeShareRange = getIndicatorRange(
            countryValues.map((country) => country.demographics.workingAgeSharePct.value),
          );
          const elderlyShareRange = getIndicatorRange(
            countryValues.map((country) => country.demographics.elderlySharePct.value),
          );
          const totalDependencyRange = getIndicatorRange(
            countryValues.map((country) => country.demographics.totalDependencyRatio.value),
          );
          const populationGrowthMaxAbs = getMaxAbs(
            countryValues.map((country) => country.demographics.populationGrowthRatePct.value),
          );
          const netMigrationMaxAbs = getMaxAbs(countryValues.map((country) => country.demographics.netMigration.value));
          const totalExportsRange = getIndicatorRange(
            countryValues.map((country) => country.tradeStructure.totalExportsUsd.value),
          );
          const totalImportsRange = getIndicatorRange(
            countryValues.map((country) => country.tradeStructure.totalImportsUsd.value),
          );
          const exportDiversityRange = getIndicatorRange(
            countryValues.map((country) => country.tradeStructure.exportDiversityProductCount.value),
          );
          const exportConcentrationRange = getIndicatorRange(
            countryValues.map((country) => country.tradeStructure.exportConcentrationHhi.value),
          );
          const tradeBalanceMaxAbs = getMaxAbs(
            countryValues.map((country) => country.tradeStructure.tradeBalanceUsd.value),
          );
          const economicComplexityMaxAbs = getMaxAbs(
            countryValues.map((country) => country.tradeStructure.economicComplexityIndex.value),
          );
          const militaryExpenditureRange = getIndicatorRange(
            countryValues.map((country) => country.security.militaryExpenditureUsd.value),
          );
          const militaryExpenditurePctOfGdpRange = getIndicatorRange(
            countryValues.map((country) => country.security.militaryExpenditurePctOfGdp.value),
          );
          const armedForcesPersonnelRange = getIndicatorRange(
            countryValues.map((country) => country.security.armedForcesPersonnel.value),
          );
          const militarySpendPerCapitaRange = getIndicatorRange(
            countryValues.map((country) => country.security.militarySpendPerCapitaUsd.value),
          );
          let wppMatchedProvinceCount = 0;
          let atlasMatchedProvinceCount = 0;
          let securityMatchedProvinceCount = 0;
          let politicalMatchedProvinceCount = 0;

          const processedFeatures = rawGeoJson.features.map((feature, index) => {
            const baseProperties = isRecord(feature.properties) ? feature.properties : {};
            const countryKey = getCountryKey(baseProperties);
            const provinceName = getProvinceName(baseProperties);
            const provinceId = getProvinceStableId(baseProperties, index);

            const provinceIso3 = getProvinceIso3(baseProperties);
            const fallbackIso3 = countryNameToIso3.get(normalizeName(countryKey)) ?? null;
            const countryIso3 = (provinceIso3 && canonicalByIso3[provinceIso3] ? provinceIso3 : null) ?? fallbackIso3;
            const countryCanonicalData = countryIso3 ? canonicalByIso3[countryIso3] ?? null : null;
            const provinceCanonicalData = canonicalProvinceById[provinceId] ?? null;

            if (countryCanonicalData) {
              matchedProvinceCount += 1;
            }
            if (
              countryCanonicalData &&
              Object.values(countryCanonicalData.demographics).some((point) => point.value !== null)
            ) {
              wppMatchedProvinceCount += 1;
            }
            if (
              countryCanonicalData &&
              [
                countryCanonicalData.tradeStructure.totalExportsUsd,
                countryCanonicalData.tradeStructure.totalImportsUsd,
                countryCanonicalData.tradeStructure.tradeBalanceUsd,
                countryCanonicalData.tradeStructure.exportDiversityProductCount,
                countryCanonicalData.tradeStructure.importDiversityProductCount,
                countryCanonicalData.tradeStructure.exportConcentrationHhi,
                countryCanonicalData.tradeStructure.importConcentrationHhi,
                countryCanonicalData.tradeStructure.economicComplexityIndex,
              ].some((point) => point.value !== null)
            ) {
              atlasMatchedProvinceCount += 1;
            }
            if (
              countryCanonicalData &&
              Object.values(countryCanonicalData.security).some((point) => point.value !== null)
            ) {
              securityMatchedProvinceCount += 1;
            }
            if (countryCanonicalData && countryCanonicalData.politicalSystem.source === "CIA World Factbook") {
              politicalMatchedProvinceCount += 1;
            }

            const populationT =
              countryCanonicalData && populationRange
                ? normalizeValue(
                    countryCanonicalData.economy.population.value,
                    populationRange.min,
                    populationRange.max,
                  )
                : null;
            const gdpT =
              countryCanonicalData && gdpRange
                ? normalizeValue(countryCanonicalData.economy.gdpCurrentUsd.value, gdpRange.min, gdpRange.max)
                : null;
            const gdpPerCapitaT =
              countryCanonicalData && gdpPerCapitaRange
                ? normalizeValue(
                    countryCanonicalData.economy.gdpPerCapitaCurrentUsd.value,
                    gdpPerCapitaRange.min,
                    gdpPerCapitaRange.max,
                  )
                : null;
            const inflationT =
              countryCanonicalData && inflationRange
                ? normalizeValue(
                    countryCanonicalData.economy.inflationAnnualPct.value,
                    inflationRange.min,
                    inflationRange.max,
                  )
                : null;
            const unemploymentT =
              countryCanonicalData && unemploymentRange
                ? normalizeValue(
                    countryCanonicalData.economy.unemploymentPct.value,
                    unemploymentRange.min,
                    unemploymentRange.max,
                  )
                : null;
            const lifeExpectancyT =
              countryCanonicalData && lifeExpectancyRange
                ? normalizeValue(
                    countryCanonicalData.economy.lifeExpectancyYears.value,
                    lifeExpectancyRange.min,
                    lifeExpectancyRange.max,
                  )
                : null;
            const medianAgeT =
              countryCanonicalData && medianAgeRange
                ? normalizeValue(
                    countryCanonicalData.demographics.medianAgeYears.value,
                    medianAgeRange.min,
                    medianAgeRange.max,
                  )
                : null;
            const fertilityRateT =
              countryCanonicalData && fertilityRateRange
                ? normalizeValue(
                    countryCanonicalData.demographics.fertilityRateBirthsPerWoman.value,
                    fertilityRateRange.min,
                    fertilityRateRange.max,
                  )
                : null;
            const youthShareT =
              countryCanonicalData && youthShareRange
                ? normalizeValue(
                    countryCanonicalData.demographics.youthSharePct.value,
                    youthShareRange.min,
                    youthShareRange.max,
                  )
                : null;
            const workingAgeShareT =
              countryCanonicalData && workingAgeShareRange
                ? normalizeValue(
                    countryCanonicalData.demographics.workingAgeSharePct.value,
                    workingAgeShareRange.min,
                    workingAgeShareRange.max,
                  )
                : null;
            const elderlyShareT =
              countryCanonicalData && elderlyShareRange
                ? normalizeValue(
                    countryCanonicalData.demographics.elderlySharePct.value,
                    elderlyShareRange.min,
                    elderlyShareRange.max,
                  )
                : null;
            const totalDependencyT =
              countryCanonicalData && totalDependencyRange
                ? normalizeValue(
                    countryCanonicalData.demographics.totalDependencyRatio.value,
                    totalDependencyRange.min,
                    totalDependencyRange.max,
                  )
                : null;
            const totalExportsT =
              countryCanonicalData && totalExportsRange
                ? normalizeValue(
                    countryCanonicalData.tradeStructure.totalExportsUsd.value,
                    totalExportsRange.min,
                    totalExportsRange.max,
                  )
                : null;
            const totalImportsT =
              countryCanonicalData && totalImportsRange
                ? normalizeValue(
                    countryCanonicalData.tradeStructure.totalImportsUsd.value,
                    totalImportsRange.min,
                    totalImportsRange.max,
                  )
                : null;
            const exportDiversityT =
              countryCanonicalData && exportDiversityRange
                ? normalizeValue(
                    countryCanonicalData.tradeStructure.exportDiversityProductCount.value,
                    exportDiversityRange.min,
                    exportDiversityRange.max,
                  )
                : null;
            const exportConcentrationT =
              countryCanonicalData && exportConcentrationRange
                ? normalizeValue(
                    countryCanonicalData.tradeStructure.exportConcentrationHhi.value,
                    exportConcentrationRange.min,
                    exportConcentrationRange.max,
                  )
                : null;
            const militaryExpenditureT =
              countryCanonicalData && militaryExpenditureRange
                ? normalizeValue(
                    countryCanonicalData.security.militaryExpenditureUsd.value,
                    militaryExpenditureRange.min,
                    militaryExpenditureRange.max,
                  )
                : null;
            const militaryExpenditurePctOfGdpT =
              countryCanonicalData && militaryExpenditurePctOfGdpRange
                ? normalizeValue(
                    countryCanonicalData.security.militaryExpenditurePctOfGdp.value,
                    militaryExpenditurePctOfGdpRange.min,
                    militaryExpenditurePctOfGdpRange.max,
                  )
                : null;
            const armedForcesPersonnelT =
              countryCanonicalData && armedForcesPersonnelRange
                ? normalizeValue(
                    countryCanonicalData.security.armedForcesPersonnel.value,
                    armedForcesPersonnelRange.min,
                    armedForcesPersonnelRange.max,
                  )
                : null;
            const militarySpendPerCapitaT =
              countryCanonicalData && militarySpendPerCapitaRange
                ? normalizeValue(
                    countryCanonicalData.security.militarySpendPerCapitaUsd.value,
                    militarySpendPerCapitaRange.min,
                    militarySpendPerCapitaRange.max,
                  )
                : null;
            const provincePopulationEstimateT =
              provinceCanonicalData && provincePopulationEstimateRange
                ? normalizeValue(
                    provinceCanonicalData.settlement.urbanCentrePopulationEstimate.value,
                    provincePopulationEstimateRange.min,
                    provincePopulationEstimateRange.max,
                  )
                : null;
            const provincePopulationDensityT =
              provinceCanonicalData && provincePopulationDensityRange
                ? normalizeValue(
                    provinceCanonicalData.settlement.urbanCentrePopulationDensityPerKm2.value,
                    provincePopulationDensityRange.min,
                    provincePopulationDensityRange.max,
                  )
                : null;
            const provinceRasterPopulationDensityT =
              provinceCanonicalData && provinceRasterPopulationDensityRange
                ? normalizeValue(
                    provinceCanonicalData.settlement.rasterPopulationDensityPerKm2.value,
                    provinceRasterPopulationDensityRange.min,
                    provinceRasterPopulationDensityRange.max,
                  )
                : null;
            const urbanCentreCountT =
              provinceCanonicalData && urbanCentreCountRange
                ? normalizeValue(
                    provinceCanonicalData.settlement.urbanCentreCount.value,
                    urbanCentreCountRange.min,
                    urbanCentreCountRange.max,
                  )
                : null;
            const builtUpSharePctT =
              provinceCanonicalData && builtUpSharePctRange
                ? normalizeValue(
                    provinceCanonicalData.settlement.urbanCentreBuiltUpSharePct.value,
                    builtUpSharePctRange.min,
                    builtUpSharePctRange.max,
                  )
                : null;

            return {
              ...feature,
              id: provinceId,
              properties: {
                ...baseProperties,
                __provinceId: provinceId,
                __provinceName: provinceName,
                __countryKey: countryKey,
                __countryName: countryCanonicalData?.name ?? countryKey,
                __countryDataIso3: countryIso3,
                __hasCountryData: Boolean(countryCanonicalData),
                __hasProvinceData: Boolean(provinceCanonicalData),
                __countryFillColor: getCountryColor(countryKey),
                __provinceFillColor: getProvinceColor(provinceId),
                __urbanCentrePopulationEstimateColor:
                  provincePopulationEstimateT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(
                        COLOR_RAMPS.urbanCentrePopulationEstimate.low,
                        COLOR_RAMPS.urbanCentrePopulationEstimate.high,
                        provincePopulationEstimateT,
                      ),
                __urbanCentrePopulationDensityColor:
                  provincePopulationDensityT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(
                        COLOR_RAMPS.urbanCentrePopulationDensity.low,
                        COLOR_RAMPS.urbanCentrePopulationDensity.high,
                        provincePopulationDensityT,
                      ),
                __rasterPopulationDensityColor:
                  provinceRasterPopulationDensityT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(
                        COLOR_RAMPS.rasterPopulationDensity.low,
                        COLOR_RAMPS.rasterPopulationDensity.high,
                        provinceRasterPopulationDensityT,
                      ),
                __urbanCentreCountColor:
                  urbanCentreCountT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(COLOR_RAMPS.urbanCentreCount.low, COLOR_RAMPS.urbanCentreCount.high, urbanCentreCountT),
                __urbanCentreBuiltUpSharePctColor:
                  builtUpSharePctT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(
                        COLOR_RAMPS.urbanCentreBuiltUpSharePct.low,
                        COLOR_RAMPS.urbanCentreBuiltUpSharePct.high,
                        builtUpSharePctT,
                      ),
                __populationColor:
                  populationT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(COLOR_RAMPS.population.low, COLOR_RAMPS.population.high, populationT),
                __gdpColor:
                  gdpT === null ? NO_DATA_COLOR : interpolateColor(COLOR_RAMPS.gdp.low, COLOR_RAMPS.gdp.high, gdpT),
                __gdpPerCapitaColor:
                  gdpPerCapitaT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(COLOR_RAMPS.gdpPerCapita.low, COLOR_RAMPS.gdpPerCapita.high, gdpPerCapitaT),
                __gdpGrowthColor: interpolateDivergingColor(
                  countryCanonicalData?.economy.gdpGrowthAnnualPct.value ?? null,
                  gdpGrowthMaxAbs,
                  COLOR_RAMPS.gdpGrowth,
                ),
                __inflationColor:
                  inflationT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(COLOR_RAMPS.inflation.low, COLOR_RAMPS.inflation.high, inflationT),
                __unemploymentColor:
                  unemploymentT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(COLOR_RAMPS.unemployment.low, COLOR_RAMPS.unemployment.high, unemploymentT),
                __lifeExpectancyColor:
                  lifeExpectancyT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(
                        COLOR_RAMPS.lifeExpectancy.low,
                        COLOR_RAMPS.lifeExpectancy.high,
                        lifeExpectancyT,
                      ),
                __governmentDebtColor:
                  countryCanonicalData && debtRange
                    ? interpolateColor(
                        COLOR_RAMPS.governmentDebt.low,
                        COLOR_RAMPS.governmentDebt.high,
                        normalizeValue(
                          countryCanonicalData.fiscal.governmentGrossDebtPctOfGdp.value,
                          debtRange.min,
                          debtRange.max,
                        ) ?? 0,
                      )
                    : NO_DATA_COLOR,
                __fiscalBalanceColor: interpolateDivergingColor(
                  countryCanonicalData?.fiscal.governmentNetLendingBorrowingPctOfGdp.value ?? null,
                  fiscalBalanceMaxAbs,
                  COLOR_RAMPS.fiscalBalance,
                ),
                __currentAccountColor: interpolateDivergingColor(
                  countryCanonicalData?.fiscal.currentAccountBalancePctOfGdp.value ?? null,
                  currentAccountMaxAbs,
                  COLOR_RAMPS.currentAccount,
                ),
                __voiceAndAccountabilityColor: interpolateGovernanceColor(
                  countryCanonicalData?.governance.voiceAndAccountability.value ?? null,
                ),
                __politicalStabilityColor: interpolateGovernanceColor(
                  countryCanonicalData?.governance.politicalStability.value ?? null,
                ),
                __governmentEffectivenessColor: interpolateGovernanceColor(
                  countryCanonicalData?.governance.governmentEffectiveness.value ?? null,
                ),
                __regulatoryQualityColor: interpolateGovernanceColor(
                  countryCanonicalData?.governance.regulatoryQuality.value ?? null,
                ),
                __ruleOfLawColor: interpolateGovernanceColor(countryCanonicalData?.governance.ruleOfLaw.value ?? null),
                __controlOfCorruptionColor: interpolateGovernanceColor(
                  countryCanonicalData?.governance.controlOfCorruption.value ?? null,
                ),
                __medianAgeColor:
                  medianAgeT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(COLOR_RAMPS.medianAge.low, COLOR_RAMPS.medianAge.high, medianAgeT),
                __fertilityRateColor:
                  fertilityRateT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(COLOR_RAMPS.fertilityRate.low, COLOR_RAMPS.fertilityRate.high, fertilityRateT),
                __populationGrowthColor: interpolateDivergingColor(
                  countryCanonicalData?.demographics.populationGrowthRatePct.value ?? null,
                  populationGrowthMaxAbs,
                  COLOR_RAMPS.populationGrowth,
                ),
                __netMigrationColor: interpolateDivergingColor(
                  countryCanonicalData?.demographics.netMigration.value ?? null,
                  netMigrationMaxAbs,
                  COLOR_RAMPS.netMigration,
                ),
                __youthShareColor:
                  youthShareT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(COLOR_RAMPS.youthShare.low, COLOR_RAMPS.youthShare.high, youthShareT),
                __workingAgeShareColor:
                  workingAgeShareT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(
                        COLOR_RAMPS.workingAgeShare.low,
                        COLOR_RAMPS.workingAgeShare.high,
                        workingAgeShareT,
                      ),
                __elderlyShareColor:
                  elderlyShareT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(COLOR_RAMPS.elderlyShare.low, COLOR_RAMPS.elderlyShare.high, elderlyShareT),
                __totalDependencyColor:
                  totalDependencyT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(
                        COLOR_RAMPS.totalDependency.low,
                        COLOR_RAMPS.totalDependency.high,
                        totalDependencyT,
                      ),
                __totalExportsColor:
                  totalExportsT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(COLOR_RAMPS.totalExports.low, COLOR_RAMPS.totalExports.high, totalExportsT),
                __totalImportsColor:
                  totalImportsT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(COLOR_RAMPS.totalImports.low, COLOR_RAMPS.totalImports.high, totalImportsT),
                __tradeBalanceColor: interpolateDivergingColor(
                  countryCanonicalData?.tradeStructure.tradeBalanceUsd.value ?? null,
                  tradeBalanceMaxAbs,
                  COLOR_RAMPS.tradeBalance,
                ),
                __exportDiversityColor:
                  exportDiversityT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(
                        COLOR_RAMPS.exportDiversity.low,
                        COLOR_RAMPS.exportDiversity.high,
                        exportDiversityT,
                      ),
                __exportConcentrationColor:
                  exportConcentrationT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(
                        COLOR_RAMPS.exportConcentration.low,
                        COLOR_RAMPS.exportConcentration.high,
                        exportConcentrationT,
                      ),
                __economicComplexityColor: interpolateDivergingColor(
                  countryCanonicalData?.tradeStructure.economicComplexityIndex.value ?? null,
                  economicComplexityMaxAbs,
                  COLOR_RAMPS.economicComplexity,
                ),
                __militaryExpenditureColor:
                  militaryExpenditureT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(
                        COLOR_RAMPS.militaryExpenditure.low,
                        COLOR_RAMPS.militaryExpenditure.high,
                        militaryExpenditureT,
                      ),
                __militaryExpenditurePctOfGdpColor:
                  militaryExpenditurePctOfGdpT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(
                        COLOR_RAMPS.militaryExpenditurePctOfGdp.low,
                        COLOR_RAMPS.militaryExpenditurePctOfGdp.high,
                        militaryExpenditurePctOfGdpT,
                      ),
                __armedForcesPersonnelColor:
                  armedForcesPersonnelT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(
                        COLOR_RAMPS.armedForcesPersonnel.low,
                        COLOR_RAMPS.armedForcesPersonnel.high,
                        armedForcesPersonnelT,
                      ),
                __militarySpendPerCapitaColor:
                  militarySpendPerCapitaT === null
                    ? NO_DATA_COLOR
                    : interpolateColor(
                        COLOR_RAMPS.militarySpendPerCapita.low,
                        COLOR_RAMPS.militarySpendPerCapita.high,
                        militarySpendPerCapitaT,
                      ),
                __governmentFamilyColor: getGovernmentFamilyColor(
                  countryCanonicalData?.politicalSystem.governmentFamily.value ?? null,
                ),
                __monarchyColor: getBooleanColor(
                  countryCanonicalData?.politicalSystem.hasMonarchy.value ?? null,
                  POLITICAL_SYSTEM_COLORS.monarchyBoolean,
                ),
                __parliamentColor: getBooleanColor(
                  countryCanonicalData?.politicalSystem.hasParliament.value ?? null,
                  POLITICAL_SYSTEM_COLORS.boolean,
                ),
                __electionsColor: getBooleanColor(
                  countryCanonicalData?.politicalSystem.hasElections.value ?? null,
                  POLITICAL_SYSTEM_COLORS.warningBoolean,
                ),
                __federalismColor: getBooleanColor(
                  countryCanonicalData?.politicalSystem.isFederal.value ?? null,
                  POLITICAL_SYSTEM_COLORS.federalismBoolean,
                ),
                __onePartyStateColor: getBooleanColor(
                  inferOnePartyStateFromPoliticalSystem(countryCanonicalData?.politicalSystem ?? null),
                  POLITICAL_SYSTEM_COLORS.warningBoolean,
                ),
              },
            };
          });

          const uniqueCountryKeys = Array.from(
            new Set(
              processedFeatures.map((feature) => {
                const props = feature.properties as Record<string, unknown> | null;
                const key = props?.__countryKey;
                return typeof key === "string" ? key : "Unknown";
              }),
            ),
          );

          console.info("Loaded provinces:", processedFeatures.length);
          console.info("Detected countries:", uniqueCountryKeys.length);
          console.info("Country key examples:", uniqueCountryKeys.slice(0, 10));

          const provinceMatchRate =
            processedFeatures.length > 0 ? (matchedProvinceCount / processedFeatures.length) * 100 : 0;
          const wppProvinceMatchRate =
            processedFeatures.length > 0 ? (wppMatchedProvinceCount / processedFeatures.length) * 100 : 0;
          const atlasProvinceMatchRate =
            processedFeatures.length > 0 ? (atlasMatchedProvinceCount / processedFeatures.length) * 100 : 0;
          const securityProvinceMatchRate =
            processedFeatures.length > 0 ? (securityMatchedProvinceCount / processedFeatures.length) * 100 : 0;
          const politicalProvinceMatchRate =
            processedFeatures.length > 0 ? (politicalMatchedProvinceCount / processedFeatures.length) * 100 : 0;

          if (!isUnmounted) {
            setOverlaySummary({
              countriesWithData,
              provinceMatchRate,
              wppCountriesWithData,
              wppProvinceMatchRate,
              atlasCountriesWithData,
              atlasProvinceMatchRate,
              securityCountriesWithData,
              securityProvinceMatchRate,
              factbookCountriesMatched,
              politicalProvinceMatchRate,
            });
          }

          if (isUnmounted || mapRef.current !== map) {
            return;
          }

          const baseProcessedGeoJson: ProvinceFeatureCollection = {
            ...rawGeoJson,
            features: processedFeatures,
          };
          baseProcessedGeoJsonRef.current = baseProcessedGeoJson;

          // Provinces are the primary map geometry.
          // Countries are represented as groups of provinces via country metadata,
          // not as a separate country geometry layer.
          map.addSource("provinces", {
            type: "geojson",
            data: buildGeoJsonForMode(baseProcessedGeoJson, "countries"),
            promoteId: "__provinceId",
          });

          map.addLayer({
            id: "province-fill",
            type: "fill",
            source: "provinces",
            paint: {
              "fill-color": ["get", "__activeFillColor"],
              "fill-opacity": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                1,
                ["boolean", ["feature-state", "hover"], false],
                0.95,
                0.82,
              ],
            },
          });

          map.addLayer({
            id: "province-borders",
            type: "line",
            source: "provinces",
            paint: {
              "line-color": "#0f172a",
              "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0, 3, 0.25, 5, 0.45, 7, 0.75],
              "line-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0, 2.5, 0, 3.5, 0.25, 5, 0.55, 7, 0.8],
            },
          });

          // Country borders are derived from provinces.geojson so they align with province borders.
          // Do not use a separate simplified countries.geojson layer for borders.
          map.addSource("country-borders", {
            type: "geojson",
            data: "/data/country-borders.geojson",
          });

          map.addLayer({
            id: "country-borders",
            type: "line",
            source: "country-borders",
            paint: {
              "line-color": "#020617",
              "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 2, 0.9, 4, 1.2, 6, 1.6],
              "line-opacity": 0.9,
            },
          });

          map.addLayer({
            id: "selected-province-outline",
            type: "line",
            source: "provinces",
            paint: {
              "line-color": "#f8fafc",
              "line-width": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                2,
                ["boolean", ["feature-state", "hover"], false],
                1.2,
                0,
              ],
              "line-opacity": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                1,
                ["boolean", ["feature-state", "hover"], false],
                0.8,
                0,
              ],
            },
          });

          const clearHoveredFeatureState = () => {
            if (hoveredProvinceIdRef.current !== null) {
              map.setFeatureState({ source: "provinces", id: hoveredProvinceIdRef.current }, { hover: false });
              hoveredProvinceIdRef.current = null;
            }
          };

          const clearSelectedFeatureState = () => {
            if (selectedProvinceIdRef.current !== null) {
              map.setFeatureState({ source: "provinces", id: selectedProvinceIdRef.current }, { selected: false });
              selectedProvinceIdRef.current = null;
            }
          };

          const getProvinceFeatureAtEvent = (event: MapLayerMouseEvent | MapMouseEvent) => {
            const directFeature = "features" in event ? event.features?.[0] : undefined;
            if (directFeature) {
              return directFeature;
            }
            const rendered = map.queryRenderedFeatures(event.point, { layers: ["province-fill"] });
            return rendered[0];
          };

          const handleProvinceMouseMove = (event: MapLayerMouseEvent) => {
            const feature = getProvinceFeatureAtEvent(event);
            if (!feature) {
              return;
            }
            const nextHoveredId = getFeatureId(feature);
            if (!nextHoveredId || hoveredProvinceIdRef.current === nextHoveredId) {
              return;
            }
            clearHoveredFeatureState();
            hoveredProvinceIdRef.current = nextHoveredId;
            map.setFeatureState({ source: "provinces", id: nextHoveredId }, { hover: true });
            map.getCanvas().style.cursor = "pointer";
          };

          const handleProvinceMouseLeave = () => {
            clearHoveredFeatureState();
            map.getCanvas().style.cursor = "";
          };

          const handleProvinceClick = (event: MapLayerMouseEvent) => {
            const feature = getProvinceFeatureAtEvent(event);
            if (!feature) {
              return;
            }
            const featureId = getFeatureId(feature);
            if (!featureId) {
              return;
            }

            const properties = getFeatureProperties(feature);
            const provinceName =
              typeof properties.__provinceName === "string" ? properties.__provinceName : getProvinceName(properties);
            const countryKey =
              typeof properties.__countryKey === "string" ? properties.__countryKey : getCountryKey(properties);
            const countryName =
              typeof properties.__countryName === "string" ? properties.__countryName : countryKey;
            const countryDataIso3 =
              typeof properties.__countryDataIso3 === "string" ? properties.__countryDataIso3 : null;
            const matchedCountryData = countryDataIso3 ? canonicalByIso3[countryDataIso3] ?? null : null;
            const matchedProvinceData =
              typeof properties.__provinceId === "string" ? canonicalProvinceById[properties.__provinceId] ?? null : null;
            const resolvedIso3 = countryDataIso3 ?? getProvinceIso3(properties) ?? null;

            clearSelectedFeatureState();
            selectedProvinceIdRef.current = featureId;
            map.setFeatureState({ source: "provinces", id: featureId }, { selected: true });

            setSelectedProvince({
              id: featureId,
              provinceName,
              countryName,
              countryKey,
              iso3: resolvedIso3,
              canonicalData: matchedCountryData,
              countryCanonicalData: matchedCountryData,
              provinceCanonicalData: matchedProvinceData,
              rawProperties: properties,
            });
          };

          const handleMapClick = (event: MapMouseEvent) => {
            const feature = getProvinceFeatureAtEvent(event);
            if (feature) {
              return;
            }
            clearSelectedFeatureState();
            setSelectedProvince(null);
          };

          map.on("mousemove", "province-fill", handleProvinceMouseMove);
          map.on("mouseleave", "province-fill", handleProvinceMouseLeave);
          map.on("click", "province-fill", handleProvinceClick);
          map.on("click", handleMapClick);

          map.on("remove", () => {
            map.off("mousemove", "province-fill", handleProvinceMouseMove);
            map.off("mouseleave", "province-fill", handleProvinceMouseLeave);
            map.off("click", "province-fill", handleProvinceClick);
            map.off("click", handleMapClick);
          });
        } catch (error) {
          console.error(
            "Failed to load or process province/canonical data. Ensure provinces.geojson and canonical-country-data.json are present and valid.",
            error,
          );
        }
      };

      void loadProvinceData();
    });

    map.on("error", (event: ErrorEvent) => {
      const message = event.error?.message ?? "";
      if (!hasLoggedCountryBorderErrorRef.current && message.includes("country-borders.geojson")) {
        hasLoggedCountryBorderErrorRef.current = true;
        console.warn(
          "Could not load /data/country-borders.geojson. Run npm run generate:country-borders to rebuild aligned country borders from provinces.",
        );
      }
      console.error("MapLibre error:", event.error);
    });

    mapRef.current = map;

    return () => {
      isUnmounted = true;
      mapRef.current?.remove();
      mapRef.current = null;
      hoveredProvinceIdRef.current = null;
      selectedProvinceIdRef.current = null;
      baseProcessedGeoJsonRef.current = null;
      hasLoggedCountryBorderErrorRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const baseGeoJson = baseProcessedGeoJsonRef.current;
    if (!map || !baseGeoJson) {
      return;
    }
    const source = map.getSource("provinces") as { setData: (data: ProvinceFeatureCollection) => void } | undefined;
    if (!source) {
      return;
    }
    source.setData(buildGeoJsonForMode(baseGeoJson, mapMode));
    if (hoveredProvinceIdRef.current !== null) {
      map.setFeatureState({ source: "provinces", id: hoveredProvinceIdRef.current }, { hover: true });
    }
    if (selectedProvinceIdRef.current !== null) {
      map.setFeatureState({ source: "provinces", id: selectedProvinceIdRef.current }, { selected: true });
    }
  }, [mapMode]);

  const activeMapLegend = useMemo(() => {
    if (mapMode === "countries" || mapMode === "provinces") {
      return { title: "Political coloring", detail: "Political coloring" };
    }
    if (
      [
        "governmentFamily",
        "monarchy",
        "parliament",
        "elections",
        "federalism",
        "onePartyState",
      ].includes(mapMode)
    ) {
      return { title: MAP_MODE_LABEL[mapMode], detail: "Categorical political-system coloring" };
    }
    return { title: MAP_MODE_LABEL[mapMode], detail: "Dark = lower | Bright = higher | Gray = no data" };
  }, [mapMode]);
  const activeColorLegend = useMemo(() => getMapColorLegend(mapMode), [mapMode]);

  return (
    <main className="game-canvas" aria-label="Province-only map canvas">
      <div className="game-canvas__map-stage">
        <div ref={containerRef} className="game-canvas__map" />

        <div className="game-canvas__overlay" aria-label="Map debug overlay">
          <div>Milestone 14: Security dataset overlay</div>
          <div>Mode: {MAP_MODE_LABEL[mapMode]}</div>
          <div>Countries with canonical data: {overlaySummary.countriesWithData}</div>
          <div>Province stat match rate: {overlaySummary.provinceMatchRate.toFixed(1)}%</div>
          <div>WPP countries with demographics: {overlaySummary.wppCountriesWithData}</div>
          <div>WPP province match rate: {overlaySummary.wppProvinceMatchRate.toFixed(1)}%</div>
          <div>Atlas countries with trade profiles: {overlaySummary.atlasCountriesWithData}</div>
          <div>Atlas province match rate: {overlaySummary.atlasProvinceMatchRate.toFixed(1)}%</div>
          <div>Security countries with data: {overlaySummary.securityCountriesWithData}</div>
          <div>Security province match rate: {overlaySummary.securityProvinceMatchRate.toFixed(1)}%</div>
          <div>Factbook countries matched: {overlaySummary.factbookCountriesMatched}</div>
          <div>Political province match rate: {overlaySummary.politicalProvinceMatchRate.toFixed(1)}%</div>
        </div>

        <section className="game-canvas__color-key" aria-label="Map color key">
          <h3 className="game-canvas__color-key-title">{activeColorLegend.title}</h3>
          <p className="game-canvas__color-key-detail">{activeColorLegend.detail}</p>
          {activeColorLegend.gradientStops ? (
            <div className="game-canvas__color-key-gradient-wrap">
              <div
                className="game-canvas__color-key-gradient"
                style={{ background: `linear-gradient(90deg, ${activeColorLegend.gradientStops.join(", ")})` }}
              />
              <div className="game-canvas__color-key-gradient-labels">
                <span>{activeColorLegend.gradientLabels?.left}</span>
                {activeColorLegend.gradientLabels?.center ? <span>{activeColorLegend.gradientLabels.center}</span> : null}
                <span>{activeColorLegend.gradientLabels?.right}</span>
              </div>
            </div>
          ) : null}
          <div className="game-canvas__color-key-list">
            {activeColorLegend.entries.map((entry) => (
              <div key={`${activeColorLegend.title}-${entry.label}`} className="game-canvas__color-key-item">
                <span className="game-canvas__color-key-swatch" style={{ backgroundColor: entry.color }} />
                <span>{entry.label}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="game-canvas__panel" aria-label="Province information panel">
        <div className="game-canvas__panel-content">
          {selectedProvince ? (
            <div className="info-panel">
              <h2 className="info-panel__title">Selected Province</h2>
              <div className="info-panel__row"><span>Province:</span><strong>{selectedProvince.provinceName}</strong></div>
              <div className="info-panel__row"><span>Country:</span><strong>{selectedProvince.countryName}</strong></div>
              <div className="info-panel__row"><span>ISO3:</span><strong>{selectedProvince.iso3 ?? "unknown"}</strong></div>
              <div className="info-panel__row"><span>Province ID:</span><strong>{selectedProvince.id}</strong></div>
              <div className="info-panel__row"><span>Country Key:</span><strong>{selectedProvince.countryKey}</strong></div>
              <div className="info-panel__row"><span>Active map value:</span><strong>{getActiveMapValue(mapMode, selectedProvince.countryCanonicalData, selectedProvince.provinceCanonicalData)}</strong></div>

              <h3 className="info-panel__subtitle">Settlement - GHSL</h3>
              <div className="info-panel__row"><span>Area:</span><strong>{formatPoint(selectedProvince.provinceCanonicalData?.areaKm2 ?? EMPTY_POINT, formatInteger)}</strong></div>
              <div className="info-panel__row"><span>Raster population:</span><strong>{formatPoint(selectedProvince.provinceCanonicalData?.settlement.rasterPopulationEstimate ?? EMPTY_POINT, formatInteger)}</strong></div>
              <div className="info-panel__row"><span>Raster population density:</span><strong>{formatPoint(selectedProvince.provinceCanonicalData?.settlement.rasterPopulationDensityPerKm2 ?? EMPTY_POINT, formatPeoplePerKm2)}</strong></div>
              <div className="info-panel__row"><span>Raster built-up surface:</span><strong>{formatPoint(selectedProvince.provinceCanonicalData?.settlement.rasterBuiltUpSurfaceKm2 ?? EMPTY_POINT, formatInteger)}</strong></div>
              <div className="info-panel__row"><span>Raster built-up share:</span><strong>{formatPoint(selectedProvince.provinceCanonicalData?.settlement.rasterBuiltUpSurfaceSharePct ?? EMPTY_POINT, formatPercent)}</strong></div>
              <div className="info-panel__row"><span>Population per built-up km²:</span><strong>{formatPoint(selectedProvince.provinceCanonicalData?.settlement.rasterPopulationPerBuiltUpKm2 ?? EMPTY_POINT, formatPeoplePerKm2)}</strong></div>
              <div className="info-panel__row"><span>Urban-centre population:</span><strong>{formatPoint(selectedProvince.provinceCanonicalData?.settlement.urbanCentrePopulationEstimate ?? EMPTY_POINT, formatInteger)}</strong></div>
              <div className="info-panel__row"><span>Urban-centre density:</span><strong>{formatPoint(selectedProvince.provinceCanonicalData?.settlement.urbanCentrePopulationDensityPerKm2 ?? EMPTY_POINT, formatPeoplePerKm2)}</strong></div>
              <div className="info-panel__row"><span>Urban-centre built-up area:</span><strong>{formatPoint(selectedProvince.provinceCanonicalData?.settlement.urbanCentreBuiltUpAreaKm2 ?? EMPTY_POINT, formatInteger)}</strong></div>
              <div className="info-panel__row"><span>Urban-centre built-up share:</span><strong>{formatPoint(selectedProvince.provinceCanonicalData?.settlement.urbanCentreBuiltUpSharePct ?? EMPTY_POINT, formatPercent)}</strong></div>
              <div className="info-panel__row"><span>Urban-centre count:</span><strong>{formatPoint(selectedProvince.provinceCanonicalData?.settlement.urbanCentreCount ?? EMPTY_POINT, formatInteger)}</strong></div>
              <div className="info-panel__row"><span>Non-urban-centre population:</span><strong>{formatPoint(selectedProvince.provinceCanonicalData?.settlement.nonUrbanCentrePopulationEstimate ?? EMPTY_POINT, formatInteger)}</strong></div>
              <div className="info-panel__row"><span>Urban-centre population share:</span><strong>{formatPoint(selectedProvince.provinceCanonicalData?.settlement.urbanCentrePopulationSharePct ?? EMPTY_POINT, formatPercent)}</strong></div>
              <div className="info-panel__row"><span>Largest urban centre:</span><strong>{selectedProvince.provinceCanonicalData?.settlement.largestUrbanCentreName ?? "No data"}</strong></div>
              <div className="info-panel__row"><span>Largest urban-centre population:</span><strong>{formatPoint(selectedProvince.provinceCanonicalData?.settlement.largestUrbanCentrePopulationEstimate ?? EMPTY_POINT, formatInteger)}</strong></div>
              <div className="info-panel__row"><span>Population concentration:</span><strong>{formatPoint(selectedProvince.provinceCanonicalData?.settlement.populationConcentrationHhi ?? EMPTY_POINT, formatHhi)}</strong></div>
              <div className="info-panel__row"><span>Settlement completeness:</span><strong>{formatTextPoint(selectedProvince.provinceCanonicalData?.settlement.settlementDataCompleteness ?? { value: null, year: null, source: null })}</strong></div>
              <div className="info-panel__row"><span>Raster completeness:</span><strong>{formatTextPoint(selectedProvince.provinceCanonicalData?.settlement.rasterSettlementDataCompleteness ?? { value: null, year: null, source: null })}</strong></div>

              <h3 className="info-panel__subtitle">Economy</h3>
              <div className="info-panel__row"><span>Population:</span><strong>{formatPoint(selectedProvince.canonicalData?.economy.population ?? EMPTY_POINT, formatInteger)}</strong></div>
              <div className="info-panel__row"><span>GDP:</span><strong>{formatPoint(selectedProvince.canonicalData?.economy.gdpCurrentUsd ?? EMPTY_POINT, formatUsd)}</strong></div>
              <div className="info-panel__row"><span>GDP per Capita:</span><strong>{formatPoint(selectedProvince.canonicalData?.economy.gdpPerCapitaCurrentUsd ?? EMPTY_POINT, formatUsdPerCapita)}</strong></div>
              <div className="info-panel__row"><span>GDP Growth:</span><strong>{formatPoint(selectedProvince.canonicalData?.economy.gdpGrowthAnnualPct ?? EMPTY_POINT, formatPercent)}</strong></div>
              <div className="info-panel__row"><span>Inflation:</span><strong>{formatPoint(selectedProvince.canonicalData?.economy.inflationAnnualPct ?? EMPTY_POINT, formatPercent)}</strong></div>
              <div className="info-panel__row"><span>Unemployment:</span><strong>{formatPoint(selectedProvince.canonicalData?.economy.unemploymentPct ?? EMPTY_POINT, formatPercent)}</strong></div>
              <div className="info-panel__row"><span>Urban Population:</span><strong>{formatPoint(selectedProvince.canonicalData?.economy.urbanPopulationPct ?? EMPTY_POINT, formatPercent)}</strong></div>
              <div className="info-panel__row"><span>Life Expectancy:</span><strong>{formatPoint(selectedProvince.canonicalData?.economy.lifeExpectancyYears ?? EMPTY_POINT, formatYears)}</strong></div>
              <div className="info-panel__row"><span>Trade:</span><strong>{formatPoint(selectedProvince.canonicalData?.economy.tradePctOfGdp ?? EMPTY_POINT, formatPercent)}</strong></div>

              <h3 className="info-panel__subtitle">Demographics - UN WPP 2024</h3>
              <div className="info-panel__row"><span>Median Age:</span><strong>{formatPoint(selectedProvince.canonicalData?.demographics.medianAgeYears ?? EMPTY_POINT, formatYears)}</strong></div>
              <div className="info-panel__row"><span>Fertility Rate:</span><strong>{formatPoint(selectedProvince.canonicalData?.demographics.fertilityRateBirthsPerWoman ?? EMPTY_POINT, formatFertilityRate)}</strong></div>
              <div className="info-panel__row"><span>Population Growth:</span><strong>{formatPoint(selectedProvince.canonicalData?.demographics.populationGrowthRatePct ?? EMPTY_POINT, formatPercent)}</strong></div>
              <div className="info-panel__row"><span>Net Migration:</span><strong>{formatPoint(selectedProvince.canonicalData?.demographics.netMigration ?? EMPTY_POINT, formatInteger)}</strong></div>
              <div className="info-panel__row"><span>Youth Share:</span><strong>{formatPoint(selectedProvince.canonicalData?.demographics.youthSharePct ?? EMPTY_POINT, formatPercent)}</strong></div>
              <div className="info-panel__row"><span>Working-Age Share:</span><strong>{formatPoint(selectedProvince.canonicalData?.demographics.workingAgeSharePct ?? EMPTY_POINT, formatPercent)}</strong></div>
              <div className="info-panel__row"><span>Elderly Share:</span><strong>{formatPoint(selectedProvince.canonicalData?.demographics.elderlySharePct ?? EMPTY_POINT, formatPercent)}</strong></div>
              <div className="info-panel__row"><span>Child Dependency:</span><strong>{formatPoint(selectedProvince.canonicalData?.demographics.childDependencyRatio ?? EMPTY_POINT, formatDependencyRatio)}</strong></div>
              <div className="info-panel__row"><span>Old-Age Dependency:</span><strong>{formatPoint(selectedProvince.canonicalData?.demographics.oldAgeDependencyRatio ?? EMPTY_POINT, formatDependencyRatio)}</strong></div>
              <div className="info-panel__row"><span>Total Dependency:</span><strong>{formatPoint(selectedProvince.canonicalData?.demographics.totalDependencyRatio ?? EMPTY_POINT, formatDependencyRatio)}</strong></div>

              <h3 className="info-panel__subtitle">Fiscal / External</h3>
              <div className="info-panel__row"><span>Current Account Balance:</span><strong>{formatPoint(selectedProvince.canonicalData?.fiscal.currentAccountBalancePctOfGdp ?? EMPTY_POINT, formatPercent)}</strong></div>
              <div className="info-panel__row"><span>Gov Net Lending/Borrowing:</span><strong>{formatPoint(selectedProvince.canonicalData?.fiscal.governmentNetLendingBorrowingPctOfGdp ?? EMPTY_POINT, formatPercent)}</strong></div>
              <div className="info-panel__row"><span>Government Gross Debt:</span><strong>{formatPoint(selectedProvince.canonicalData?.fiscal.governmentGrossDebtPctOfGdp ?? EMPTY_POINT, formatPercent)}</strong></div>

              <h3 className="info-panel__subtitle">Governance</h3>
              <div className="info-panel__row"><span>Voice & Accountability:</span><strong>{formatPoint(selectedProvince.canonicalData?.governance.voiceAndAccountability ?? EMPTY_POINT, formatGovernanceScore)}</strong></div>
              <div className="info-panel__row"><span>Political Stability:</span><strong>{formatPoint(selectedProvince.canonicalData?.governance.politicalStability ?? EMPTY_POINT, formatGovernanceScore)}</strong></div>
              <div className="info-panel__row"><span>Government Effectiveness:</span><strong>{formatPoint(selectedProvince.canonicalData?.governance.governmentEffectiveness ?? EMPTY_POINT, formatGovernanceScore)}</strong></div>
              <div className="info-panel__row"><span>Regulatory Quality:</span><strong>{formatPoint(selectedProvince.canonicalData?.governance.regulatoryQuality ?? EMPTY_POINT, formatGovernanceScore)}</strong></div>
              <div className="info-panel__row"><span>Rule of Law:</span><strong>{formatPoint(selectedProvince.canonicalData?.governance.ruleOfLaw ?? EMPTY_POINT, formatGovernanceScore)}</strong></div>
              <div className="info-panel__row"><span>Control of Corruption:</span><strong>{formatPoint(selectedProvince.canonicalData?.governance.controlOfCorruption ?? EMPTY_POINT, formatGovernanceScore)}</strong></div>

              <h3 className="info-panel__subtitle">Political System - CIA World Factbook</h3>
              <div className="info-panel__row"><span>Government Type:</span><strong>{formatTextPoint(selectedProvince.canonicalData?.politicalSystem.governmentType ?? { value: null, source: null })}</strong></div>
              <div className="info-panel__row"><span>Normalized Type:</span><strong>{formatTextPoint(selectedProvince.canonicalData?.politicalSystem.governmentFamily ?? { value: null, source: null })}</strong></div>
              <div className="info-panel__row"><span>Capital:</span><strong>{formatTextPoint(selectedProvince.canonicalData?.politicalSystem.capital ?? { value: null, source: null })}</strong></div>
              <div className="info-panel__row"><span>Head of State:</span><strong>{formatTextPoint(selectedProvince.canonicalData?.politicalSystem.headOfStateTitle ?? { value: null, source: null })}</strong></div>
              <div className="info-panel__row"><span>Head of Government:</span><strong>{formatTextPoint(selectedProvince.canonicalData?.politicalSystem.headOfGovernmentTitle ?? { value: null, source: null })}</strong></div>
              <div className="info-panel__row"><span>Monarchy:</span><strong>{formatBooleanPoint(selectedProvince.canonicalData?.politicalSystem.hasMonarchy ?? { value: null, source: null })}</strong></div>
              <div className="info-panel__row"><span>Parliament:</span><strong>{formatBooleanPoint(selectedProvince.canonicalData?.politicalSystem.hasParliament ?? { value: null, source: null })}</strong></div>
              <div className="info-panel__row"><span>Legislature:</span><strong>{formatTextPoint(selectedProvince.canonicalData?.politicalSystem.legislatureType ?? { value: null, source: null })}</strong></div>
              <div className="info-panel__row"><span>Elections:</span><strong>{formatBooleanPoint(selectedProvince.canonicalData?.politicalSystem.hasElections ?? { value: null, source: null })}</strong></div>
              <div className="info-panel__row"><span>Universal Suffrage:</span><strong>{formatBooleanPoint(selectedProvince.canonicalData?.politicalSystem.hasUniversalSuffrage ?? { value: null, source: null })}</strong></div>
              <div className="info-panel__row"><span>Federal:</span><strong>{formatBooleanPoint(selectedProvince.canonicalData?.politicalSystem.isFederal ?? { value: null, source: null })}</strong></div>
              <div className="info-panel__row"><span>Republic:</span><strong>{formatBooleanPoint(selectedProvince.canonicalData?.politicalSystem.isRepublic ?? { value: null, source: null })}</strong></div>
              <div className="info-panel__row"><span>One-Party State:</span><strong>{formatBooleanValue(inferOnePartyStateFromPoliticalSystem(selectedProvince.canonicalData?.politicalSystem ?? null))}</strong></div>
              <div className="info-panel__row"><span>Military Regime:</span><strong>{formatBooleanPoint(selectedProvince.canonicalData?.politicalSystem.isMilitaryRegime ?? { value: null, source: null })}</strong></div>
              <div className="info-panel__row"><span>Legal System:</span><strong>{formatTextPoint(selectedProvince.canonicalData?.politicalSystem.legalSystem ?? { value: null, source: null })}</strong></div>
              <div className="info-panel__row"><span>Constitution:</span><strong>{formatTextPoint(selectedProvince.canonicalData?.politicalSystem.constitution ?? { value: null, source: null })}</strong></div>

              <details className="info-panel__details">
                <summary>Executive Branch</summary>
                <p className="info-panel__hint">{formatTextPoint(selectedProvince.canonicalData?.politicalSystem.executiveBranch ?? { value: null, source: null })}</p>
              </details>
              <details className="info-panel__details">
                <summary>Legislative Branch</summary>
                <p className="info-panel__hint">{formatTextPoint(selectedProvince.canonicalData?.politicalSystem.legislativeBranch ?? { value: null, source: null })}</p>
              </details>
              <details className="info-panel__details">
                <summary>Judicial Branch</summary>
                <p className="info-panel__hint">{formatTextPoint(selectedProvince.canonicalData?.politicalSystem.judicialBranch ?? { value: null, source: null })}</p>
              </details>
              <details className="info-panel__details">
                <summary>Political Parties</summary>
                <p className="info-panel__hint">{formatTextPoint(selectedProvince.canonicalData?.politicalSystem.politicalPartiesAndLeaders ?? { value: null, source: null })}</p>
              </details>
              <details className="info-panel__details">
                <summary>Elections / Appointments</summary>
                <p className="info-panel__hint">{formatTextPoint(selectedProvince.canonicalData?.politicalSystem.electionsAppointments ?? { value: null, source: null })}</p>
              </details>
              <details className="info-panel__details">
                <summary>Constitution</summary>
                <p className="info-panel__hint">{formatTextPoint(selectedProvince.canonicalData?.politicalSystem.constitution ?? { value: null, source: null })}</p>
              </details>
              <details className="info-panel__details">
                <summary>Legal System</summary>
                <p className="info-panel__hint">{formatTextPoint(selectedProvince.canonicalData?.politicalSystem.legalSystem ?? { value: null, source: null })}</p>
              </details>

              <h3 className="info-panel__subtitle">Trade / Productive Structure - Atlas</h3>
              <div className="info-panel__row"><span>Exports:</span><strong>{formatPoint(selectedProvince.canonicalData?.tradeStructure.totalExportsUsd ?? EMPTY_POINT, formatUsd)}</strong></div>
              <div className="info-panel__row"><span>Imports:</span><strong>{formatPoint(selectedProvince.canonicalData?.tradeStructure.totalImportsUsd ?? EMPTY_POINT, formatUsd)}</strong></div>
              <div className="info-panel__row"><span>Trade Balance:</span><strong>{formatPoint(selectedProvince.canonicalData?.tradeStructure.tradeBalanceUsd ?? EMPTY_POINT, formatSignedUsd)}</strong></div>
              <div className="info-panel__row"><span>Export Diversity:</span><strong>{formatPoint(selectedProvince.canonicalData?.tradeStructure.exportDiversityProductCount ?? EMPTY_POINT, formatInteger)}</strong></div>
              <div className="info-panel__row"><span>Import Diversity:</span><strong>{formatPoint(selectedProvince.canonicalData?.tradeStructure.importDiversityProductCount ?? EMPTY_POINT, formatInteger)}</strong></div>
              <div className="info-panel__row"><span>Export Concentration:</span><strong>{formatPoint(selectedProvince.canonicalData?.tradeStructure.exportConcentrationHhi ?? EMPTY_POINT, formatHhi)}</strong></div>
              <div className="info-panel__row"><span>Import Concentration:</span><strong>{formatPoint(selectedProvince.canonicalData?.tradeStructure.importConcentrationHhi ?? EMPTY_POINT, formatHhi)}</strong></div>
              <div className="info-panel__row"><span>Economic Complexity:</span><strong>{formatPoint(selectedProvince.canonicalData?.tradeStructure.economicComplexityIndex ?? EMPTY_POINT, formatGovernanceScore)}</strong></div>

              <h3 className="info-panel__subtitle">Security - World Bank WDI</h3>
              <div className="info-panel__row"><span>Military Expenditure:</span><strong>{formatPoint(selectedProvince.canonicalData?.security.militaryExpenditureUsd ?? EMPTY_POINT, formatUsd)}</strong></div>
              <div className="info-panel__row"><span>Military Spending (% GDP):</span><strong>{formatPoint(selectedProvince.canonicalData?.security.militaryExpenditurePctOfGdp ?? EMPTY_POINT, formatPercent)}</strong></div>
              <div className="info-panel__row"><span>Military Spending (% Govt):</span><strong>{formatPoint(selectedProvince.canonicalData?.security.militaryExpenditurePctOfGovtExpenditure ?? EMPTY_POINT, formatPercent)}</strong></div>
              <div className="info-panel__row"><span>Armed Forces Personnel:</span><strong>{formatPoint(selectedProvince.canonicalData?.security.armedForcesPersonnel ?? EMPTY_POINT, formatInteger)}</strong></div>
              <div className="info-panel__row"><span>Armed Forces (% Labor Force):</span><strong>{formatPoint(selectedProvince.canonicalData?.security.armedForcesPctOfLaborForce ?? EMPTY_POINT, formatPercent)}</strong></div>
              <div className="info-panel__row"><span>Arms Imports (SIPRI TIV):</span><strong>{formatPoint(selectedProvince.canonicalData?.security.armsImportsSipriTiv ?? EMPTY_POINT, formatInteger)}</strong></div>
              <div className="info-panel__row"><span>Arms Exports (SIPRI TIV):</span><strong>{formatPoint(selectedProvince.canonicalData?.security.armsExportsSipriTiv ?? EMPTY_POINT, formatInteger)}</strong></div>
              <div className="info-panel__row"><span>Military Spend per Capita:</span><strong>{formatPoint(selectedProvince.canonicalData?.security.militarySpendPerCapitaUsd ?? EMPTY_POINT, formatUsdPerCapita)}</strong></div>
              <div className="info-panel__row"><span>Military Spend per Soldier:</span><strong>{formatPoint(selectedProvince.canonicalData?.security.militarySpendPerSoldierUsd ?? EMPTY_POINT, formatUsdPerCapita)}</strong></div>
              <div className="info-panel__row"><span>Mobilization Base:</span><strong>{formatPoint(selectedProvince.canonicalData?.security.mobilizationBasePct ?? EMPTY_POINT, formatPercent)}</strong></div>

              <details className="info-panel__details">
                <summary>Top Exports</summary>
                {selectedTopExports.length > 0 ? (
                  <ul className="info-panel__list">
                    {selectedTopExports.map((entry) => (
                      <li key={`exp-${entry.productCode}`}>
                        <strong>{entry.productName ?? entry.productCode}</strong> ({entry.productCode}) -{" "}
                        {formatUsd(entry.exportValueUsd ?? null)} -{" "}
                        {typeof entry.shareOfExportsPct === "number" ? `${entry.shareOfExportsPct.toFixed(1)}%` : "No data"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="info-panel__hint">No export product data.</p>
                )}
              </details>

              <details className="info-panel__details">
                <summary>Top Imports</summary>
                {selectedTopImports.length > 0 ? (
                  <ul className="info-panel__list">
                    {selectedTopImports.map((entry) => (
                      <li key={`imp-${entry.productCode}`}>
                        <strong>{entry.productName ?? entry.productCode}</strong> ({entry.productCode}) -{" "}
                        {formatUsd(entry.importValueUsd ?? null)} -{" "}
                        {typeof entry.shareOfImportsPct === "number" ? `${entry.shareOfImportsPct.toFixed(1)}%` : "No data"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="info-panel__hint">No import product data.</p>
                )}
              </details>

              <details className="info-panel__details">
                <summary>Raw properties (preview)</summary>
                <ul className="info-panel__list">
                  {selectedPropertyPreview.map(([key, value]) => (
                    <li key={key}>
                      <strong>{key}:</strong> {typeof value === "string" ? value : JSON.stringify(value)}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ) : (
            <div className="info-panel">
              <h2 className="info-panel__title">No province selected.</h2>
              <p className="info-panel__hint">Click a province on the map.</p>
              <p className="info-panel__hint">Active map value: Political coloring</p>
            </div>
          )}
        </div>

        <div className="map-mode">
          <h3 className="map-mode__title">Map Mode</h3>
          <p className="map-mode__legend-title">{activeMapLegend.title}</p>
          <p className="map-mode__legend">{activeMapLegend.detail}</p>

          <p className="map-mode__section-title">Political</p>
          <div className="map-mode__buttons">
            {MAP_MODES.filter((mode) => mode.key === "countries" || mode.key === "provinces").map((mode) => (
              <button
                key={mode.key}
                type="button"
                className={`map-mode__button${mapMode === mode.key ? " map-mode__button--active" : ""}`}
                onClick={() => setMapMode(mode.key)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <p className="map-mode__section-title">Settlement</p>
          <div className="map-mode__buttons">
            {MAP_MODES.filter((mode) =>
              ["urbanCentrePopulationEstimate", "urbanCentrePopulationDensity", "rasterPopulationDensity", "urbanCentreCount", "urbanCentreBuiltUpSharePct"].includes(
                mode.key,
              ),
            ).map((mode) => (
              <button
                key={mode.key}
                type="button"
                className={`map-mode__button${mapMode === mode.key ? " map-mode__button--active" : ""}`}
                onClick={() => setMapMode(mode.key)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <p className="map-mode__section-title">Economy</p>
          <div className="map-mode__buttons">
            {MAP_MODES.filter((mode) =>
              [
                "population",
                "gdp",
                "gdpPerCapita",
                "gdpGrowth",
                "inflation",
                "unemployment",
                "lifeExpectancy",
              ].includes(mode.key),
            ).map((mode) => (
              <button
                key={mode.key}
                type="button"
                className={`map-mode__button${mapMode === mode.key ? " map-mode__button--active" : ""}`}
                onClick={() => setMapMode(mode.key)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <p className="map-mode__section-title">Fiscal / External</p>
          <div className="map-mode__buttons">
            {MAP_MODES.filter((mode) => ["governmentDebt", "fiscalBalance", "currentAccount"].includes(mode.key)).map((mode) => (
              <button
                key={mode.key}
                type="button"
                className={`map-mode__button${mapMode === mode.key ? " map-mode__button--active" : ""}`}
                onClick={() => setMapMode(mode.key)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <p className="map-mode__section-title">Governance</p>
          <div className="map-mode__buttons">
            {MAP_MODES.filter((mode) =>
              [
                "voiceAndAccountability",
                "politicalStability",
                "governmentEffectiveness",
                "regulatoryQuality",
                "ruleOfLaw",
                "controlOfCorruption",
              ].includes(mode.key),
            ).map((mode) => (
              <button
                key={mode.key}
                type="button"
                className={`map-mode__button${mapMode === mode.key ? " map-mode__button--active" : ""}`}
                onClick={() => setMapMode(mode.key)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <p className="map-mode__section-title">Demographics</p>
          <div className="map-mode__buttons">
            {MAP_MODES.filter((mode) =>
              [
                "medianAge",
                "fertilityRate",
                "populationGrowth",
                "netMigration",
                "youthShare",
                "workingAgeShare",
                "elderlyShare",
                "totalDependency",
              ].includes(mode.key),
            ).map((mode) => (
              <button
                key={mode.key}
                type="button"
                className={`map-mode__button${mapMode === mode.key ? " map-mode__button--active" : ""}`}
                onClick={() => setMapMode(mode.key)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <p className="map-mode__section-title">Trade / Industry</p>
          <div className="map-mode__buttons">
            {MAP_MODES.filter((mode) =>
              [
                "totalExports",
                "totalImports",
                "tradeBalance",
                "exportDiversity",
                "exportConcentration",
                "economicComplexity",
              ].includes(mode.key),
            ).map((mode) => (
              <button
                key={mode.key}
                type="button"
                className={`map-mode__button${mapMode === mode.key ? " map-mode__button--active" : ""}`}
                onClick={() => setMapMode(mode.key)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <p className="map-mode__section-title">Security</p>
          <div className="map-mode__buttons">
            {MAP_MODES.filter((mode) =>
              [
                "militaryExpenditure",
                "militaryExpenditurePctOfGdp",
                "armedForcesPersonnel",
                "militarySpendPerCapita",
              ].includes(mode.key),
            ).map((mode) => (
              <button
                key={mode.key}
                type="button"
                className={`map-mode__button${mapMode === mode.key ? " map-mode__button--active" : ""}`}
                onClick={() => setMapMode(mode.key)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <p className="map-mode__section-title">Political System</p>
          <div className="map-mode__buttons">
            {MAP_MODES.filter((mode) =>
              ["governmentFamily", "monarchy", "parliament", "elections", "federalism", "onePartyState"].includes(
                mode.key,
              ),
            ).map((mode) => (
              <button
                key={mode.key}
                type="button"
                className={`map-mode__button${mapMode === mode.key ? " map-mode__button--active" : ""}`}
                onClick={() => setMapMode(mode.key)}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
      </aside>
    </main>
  );
}
