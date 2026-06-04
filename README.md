# Atlas Core: January 2025

This repository is a reusable world-state baseline for map-first games and simulations.

The project is anchored to a fixed in-game start date:

- `gameStartDate`: `2025-01-01`

The current app renders a province-based world map and loads canonical country data plus canonical province settlement data that future mechanics can build on.

## Purpose

Use this repository as a base for:

- grand strategy prototypes
- geopolitical and economic simulations
- scenario testing
- world-state tooling

The project is intentionally data-first right now. It is not yet a full game or simulation engine.

## Current Scope

Implemented:

- Province-only world geometry rendering from `public/data/provinces.geojson`
- Derived country borders from province geometry in `public/data/country-borders.geojson`
- Country/province selection and inspection UI
- Multiple thematic map views
- Canonical merged country dataset in `public/data/canonical-country-data.json`
- Canonical province settlement dataset in `public/data/canonical-province-data.json`
- GHSL urban-centre and province-settlement rollups in `public/data/urban-centres.json` and `public/data/province-settlement-stats.json`

Not implemented yet:

- simulation loop
- time progression
- diplomacy or AI systems
- save/load
- backend persistence

## Stack

- React
- TypeScript
- Vite
- MapLibre GL JS
- Node.js data import/build scripts

## Quick Start

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## What The Frontend Actually Loads

The frontend primarily uses:

- `public/data/provinces.geojson`
- `public/data/country-borders.geojson`
- `public/data/canonical-country-data.json`
- `public/data/canonical-province-data.json`

The source-specific dataset files remain in `public/data/` for inspection, coverage auditing, and rebuilds, but the map UI reads from the canonical country file for country statistics and political-system metadata and from the canonical province file for GHSL settlement overlays.

## Canonical Data Model

Each country in `public/data/canonical-country-data.json` can contain:

- `economy`
- `demographics`
- `fiscal`
- `governance`
- `tradeStructure`
- `security`
- `politicalSystem`
- `settlement`

Each province in `public/data/canonical-province-data.json` currently contains:

- `id`
- `name`
- `countryIso3`
- `countryName`
- `areaKm2`
- `settlement`

Each numeric field is stored as:

- `value`
- `year`
- `source`

Political-system text and booleans are stored as Factbook-derived fields with a `source`.

Settlement caveat:

- Current GHSL-derived province and country settlement fields intentionally use `urbanCentre*` names because they are UCDB urban-centre aggregates, not full province or country raster totals.
- `settlementDataCompleteness.value = "urban-centres-only"` means no full GHS-POP or GHS-BUILT zonal aggregation has been run yet.

## Geometry Files

### `public/data/provinces.geojson`

This is the primary map geometry used by the frontend.

- The checked-in file currently appears to be Natural Earth Admin-1 style province/state geometry.
- The file name inside the GeoJSON is `ne_10m_admin_1_states_provinces`.
- Country membership is inferred from province properties such as `admin`, `adm0_a3`, `sov_a3`, and the derived `__countryKey`.

### `public/data/country-borders.geojson`

This file is generated from provinces by `scripts/generateCountryBorders.mjs`.

- Provinces are grouped by country key.
- Country polygons are dissolved with Turf `union`.
- If dissolve fails, the script falls back to combined geometry.
- The output is used for country border rendering overlays.

## Dataset Inventory

These are the datasets currently used by the project, the files they generate, and exactly how they feed the canonical build.

### 1. World Bank WDI

Script:

- `scripts/importWorldBankCountryStats.mjs`

Generated files:

- `public/data/country-stats.json`
- `public/data/country-stats-coverage.json`

Source behavior:

- Uses the World Bank API, source `2`
- Prefers year `2024`
- Falls back to year `2023`
- Filters out aggregate/non-country rows

Imported indicators:

- `population`
- `gdpCurrentUsd`
- `gdpPerCapitaCurrentUsd`
- `gdpGrowthAnnualPct`
- `inflationConsumerAnnualPct`
- `unemploymentPct`
- `urbanPopulationPct`
- `lifeExpectancyYears`
- `tradePctOfGdp`

How it is used in canonical data:

- Always supplies `population`
- Always supplies `unemploymentPct`
- Always supplies `urbanPopulationPct`
- Always supplies `lifeExpectancyYears`
- Always supplies `tradePctOfGdp`
- Competes with IMF for `gdpCurrentUsd`
- Competes with IMF for `gdpPerCapitaCurrentUsd`
- Competes with IMF for `gdpGrowthAnnualPct`
- Competes with IMF for `inflationAnnualPct`

### 2. World Bank WGI

Script:

- `scripts/importWorldBankGovernanceStats.mjs`

Generated files:

- `public/data/governance-stats.json`
- `public/data/governance-stats-coverage.json`

Source behavior:

- Uses the World Bank API, source `75`
- Prefers year `2024`
- Falls back to year `2023`
- Filters out aggregate/non-country rows

Imported indicators:

- `voiceAndAccountability`
- `politicalStability`
- `governmentEffectiveness`
- `regulatoryQuality`
- `ruleOfLaw`
- `controlOfCorruption`

How it is used in canonical data:

- Fully populates the `governance` section

### 3. IMF WEO / DataMapper

Script:

- `scripts/importImfWeoStats.mjs`

Generated files:

- `public/data/imf-weo-stats.json`
- `public/data/imf-weo-stats-coverage.json`

Source behavior:

- Uses the IMF DataMapper API
- Prefers year `2024`
- Falls back to year `2023`
- Filters out aggregate/group rows
- Downloads indicator data in country chunks

Imported indicators:

- `realGdpGrowthPct`
- `gdpCurrentUsdBillions`
- `gdpPerCapitaCurrentUsd`
- `inflationAverageConsumerPricesPct`
- `currentAccountBalancePctOfGdp`
- `governmentNetLendingBorrowingPctOfGdp`
- `governmentGrossDebtPctOfGdp`

How it is used in canonical data:

- Fully populates the `fiscal` section
- Supplies `currentAccountBalancePctOfGdp`
- Supplies `governmentNetLendingBorrowingPctOfGdp`
- Supplies `governmentGrossDebtPctOfGdp`
- Competes with WDI for `gdpCurrentUsd`
- Competes with WDI for `gdpPerCapitaCurrentUsd`
- Competes with WDI for `gdpGrowthAnnualPct`
- Competes with WDI for `inflationAnnualPct`

### 4. UN World Population Prospects 2024

Script:

- `scripts/importUnWppDemographics.mjs`

Generated files:

- `public/data/un-wpp-demographics.json`
- `public/data/un-wpp-demographics-coverage.json`

Source behavior:

- Probes the UN Data Portal API
- If API data endpoints are restricted, falls back to official WPP 2024 bulk files
- Discovers bulk-file URLs from the official downloads manifest
- Prefers year `2024`
- Falls back to year `2023`
- Uses the `Medium` variant

Source files used by the importer:

- `WPP2024_Locations_notes.csv`
- `WPP2024_Demographic_Indicators_Medium.csv.gz`
- `WPP2024_PopulationByAge5GroupSex_Percentage_Medium.csv.gz`

Directly imported indicators:

- `medianAgeYears`
- `fertilityRateBirthsPerWoman`
- `populationGrowthRatePct`
- `netMigration`

Computed from age-structure percentages:

- `youthSharePct`
- `workingAgeSharePct`
- `elderlySharePct`
- `childDependencyRatio`
- `oldAgeDependencyRatio`
- `totalDependencyRatio`

How it is used in canonical data:

- Fully populates the `demographics` section

### 5. Atlas of Economic Complexity

Script:

- `scripts/importAtlasTradeProfiles.mjs`

Generated files:

- `public/data/atlas-trade-profiles.json`
- `public/data/atlas-trade-profiles-coverage.json`

Source behavior:

- Scans the official Atlas S3 bucket index
- Picks the best unilateral country-product dataset automatically
- Downloads the selected bulk file
- Detects the schema dynamically
- Prefers year `2024`
- Falls back to year `2023`
- If neither is present, uses the latest available year in the file

Current dataset note:

- The current import resolved to `country_hsproduct4digit_year.csv.zip`
- The current selected year is `2016`

Imported and derived indicators:

- `totalExportsUsd`
- `totalImportsUsd`
- `tradeBalanceUsd`
- `exportDiversityProductCount`
- `importDiversityProductCount`
- `exportConcentrationHhi`
- `importConcentrationHhi`
- `economicComplexityIndex`

Additional derived arrays:

- `topExports`
- `topImports`

How it is used in canonical data:

- Fully populates the `tradeStructure` section
- `topExports` and `topImports` are capped to the top 10 products per flow

### 6. CIA World Factbook

Script:

- `scripts/importFactbookPoliticalProfiles.mjs`

Generated files:

- `public/data/factbook-political-profiles.json`
- `public/data/factbook-political-profiles-coverage.json`
- cached archive in `public/data/raw/factbook/factbook-source.zip`

Source behavior:

- Downloads a GitHub-hosted Factbook JSON archive
- Tries `factbook/cache.factbook.json` first
- Falls back to `factbook/factbook.json`
- Parses the government section heuristically
- Matches Factbook entities to canonical ISO3 codes using aliases plus normalized country-name matching

Raw text fields imported:

- `governmentType`
- `capital`
- `administrativeDivisions`
- `independence`
- `constitution`
- `legalSystem`
- `suffrage`
- `executiveBranch`
- `legislativeBranch`
- `judicialBranch`
- `politicalPartiesAndLeaders`
- `electionsAppointments`
- `internationalOrganizationParticipation`

Normalized political fields derived from Factbook text:

- `governmentFamily`
- `hasMonarchy`
- `monarchyType`
- `hasParliament`
- `legislatureType`
- `hasElections`
- `hasUniversalSuffrage`
- `isFederal`
- `isRepublic`
- `isOnePartyState`
- `isMilitaryRegime`
- `headOfStateTitle`
- `headOfGovernmentTitle`

How it is used in canonical data:

- Fully populates the `politicalSystem` section whenever a Factbook match exists

### 7. World Bank Security Stats

Script:

- `scripts/importWorldBankSecurityStats.mjs`

Generated files:

- `public/data/security-stats.json`
- `public/data/security-stats-coverage.json`

Source behavior:

- Uses the World Bank API, source `2`
- Prefers year `2024`
- Falls back to year `2023`
- If neither is available for a field, uses the latest available non-null year
- Filters out aggregate/non-country rows
- Labels military spending and arms-transfer indicators as `World Bank WDI / SIPRI`
- Labels armed-forces personnel indicators as `World Bank WDI / IISS`

Imported indicators:

- `militaryExpenditureUsd`
- `militaryExpenditurePctOfGdp`
- `militaryExpenditurePctOfGovtExpenditure`
- `armedForcesPersonnel`
- `armedForcesPctOfLaborForce`
- `armsImportsSipriTiv`
- `armsExportsSipriTiv`

Derived in the canonical builder:

- `militarySpendPerCapitaUsd`
- `militarySpendPerSoldierUsd`
- `mobilizationBasePct`

How it is used in canonical data:

- Populates the `security` section
- Uses canonical WDI `population` plus imported security fields for derived indicators

### 8. GHSL Urban Centres And Province Settlement

Scripts:

- `scripts/buildUrbanCentres.mjs`
- `scripts/importGhslSettlementData.mjs`
- `scripts/buildCanonicalProvinceData.mjs`

Generated files:

- `public/data/urban-centres.json`
- `public/data/urban-centres-coverage.json`
- `public/data/province-settlement-stats.json`
- `public/data/province-settlement-stats-coverage.json`
- `public/data/canonical-province-data.json`
- `public/data/canonical-province-data-coverage.json`

Source behavior:

- Uses the official GHSL UCDB release `GHS_UCDB_GLOBE_R2024A_V1_1.zip`
- Extracts `GHS_UCDB_GLOBE_R2024A.gpkg`
- Reads urban-centre records from the UCDB GeoPackage
- Matches urban-centre centroids to checked-in Natural Earth province polygons
- Builds province rollups from matched urban-centre records only

Urban-centre fields emitted:

- `id`
- `name`
- `countryIso3`
- `provinceId`
- `longitude`
- `latitude`
- `population`
- `builtUpAreaKm2`
- `populationDensityPerKm2`
- `isCapital`

Province settlement fields emitted:

- `urbanCentrePopulationEstimate`
- `urbanCentrePopulationDensityPerKm2`
- `urbanCentreBuiltUpAreaKm2`
- `urbanCentreBuiltUpSharePct`
- `urbanCentreCount`
- `largestUrbanCentreId`
- `largestUrbanCentreName`
- `largestUrbanCentrePopulationEstimate`
- `populationConcentrationHhi`
- `settlementDataCompleteness`

How it is used in canonical data:

- `canonical-province-data.json` is the frontend's province settlement input
- `canonical-country-data.json` rolls up UCDB-only country settlement summaries from canonical province data plus urban-centre records
- Country settlement currently includes `urbanCentreCount`, `largestUrbanCentres`, `urbanCentreBuiltUpAreaKm2`, `urbanCentreBuiltUpSharePct`, `populationConcentrationHhi`, `provincePopulationCoveragePct`, and `settlementDataCompleteness`

Important semantic note:

- These are not whole-province population or built-up totals.
- They are matched urban-centre aggregates only.
- The field names intentionally use `urbanCentre*` wording to avoid implying full raster coverage.

## Canonical Merge Rules

The canonical merge step is implemented in `scripts/buildCanonicalCountryData.mjs`.

Input files:

- `public/data/country-stats.json`
- `public/data/governance-stats.json`
- `public/data/imf-weo-stats.json`
- `public/data/un-wpp-demographics.json`
- `public/data/atlas-trade-profiles.json`
- `public/data/factbook-political-profiles.json`
- `public/data/security-stats.json`
- `public/data/urban-centres.json`
- `public/data/canonical-province-data.json`

Generated files:

- `public/data/canonical-country-data.json`
- `public/data/canonical-country-data-coverage.json`

Country naming precedence in the canonical builder:

- WDI
- IMF
- WGI
- WPP
- Atlas
- Factbook
- fallback to ISO3

### Overlap resolution between WDI and IMF

These four indicators exist in both WDI and IMF:

- `gdpCurrentUsd`
- `gdpPerCapitaCurrentUsd`
- `gdpGrowthAnnualPct`
- `inflationAnnualPct`

The merge rule is:

- choose the newer year if one source is newer
- if years tie, choose the source with broader coverage for that indicator
- if coverage also ties, default to IMF

The canonical builder maps them as follows:

- `gdpCurrentUsd`: WDI `gdpCurrentUsd` vs IMF `gdpCurrentUsdBillions * 1_000_000_000`
- `gdpPerCapitaCurrentUsd`: WDI vs IMF direct overlap
- `gdpGrowthAnnualPct`: WDI `gdpGrowthAnnualPct` vs IMF `realGdpGrowthPct`
- `inflationAnnualPct`: WDI `inflationConsumerAnnualPct` vs IMF `inflationAverageConsumerPricesPct`

### Canonical field-by-field source usage

`economy`

- `population`: WDI
- `gdpCurrentUsd`: WDI or IMF via overlap logic
- `gdpPerCapitaCurrentUsd`: WDI or IMF via overlap logic
- `gdpGrowthAnnualPct`: WDI or IMF via overlap logic
- `inflationAnnualPct`: WDI or IMF via overlap logic
- `unemploymentPct`: WDI
- `urbanPopulationPct`: WDI
- `lifeExpectancyYears`: WDI
- `tradePctOfGdp`: WDI

`demographics`

- all demographic metrics: WPP

`fiscal`

- all fiscal metrics: IMF

`governance`

- all governance metrics: WGI

`tradeStructure`

- all trade-structure metrics and top product arrays: Atlas

`security`

- imported military spending and arms-transfer metrics: World Bank WDI / SIPRI
- imported armed-forces personnel metrics: World Bank WDI / IISS
- derived per-capita / per-soldier / mobilization metrics: canonical builder

`politicalSystem`

- all text, boolean, and normalized political-system fields: CIA World Factbook

`settlement`

- province-derived urban-centre rollups: GHSL UCDB + Natural Earth province geometry
- largest urban-centre lists: GHSL UCDB

## Coverage And Audit Files

Every import stage writes a coverage file to `public/data/`.

Current coverage outputs:

- `country-stats-coverage.json`
- `governance-stats-coverage.json`
- `imf-weo-stats-coverage.json`
- `un-wpp-demographics-coverage.json`
- `atlas-trade-profiles-coverage.json`
- `factbook-political-profiles-coverage.json`
- `security-stats-coverage.json`
- `urban-centres-coverage.json`
- `province-settlement-stats-coverage.json`
- `canonical-province-data-coverage.json`
- `canonical-country-data-coverage.json`

There is also an overlap audit script:

- `scripts/auditCountryStatsOverlap.mjs`

It compares duplicated macro indicators across WDI and IMF to help validate merge decisions.

## Data Refresh Workflow

Run the full pipeline in this order:

```bash
npm run import:wdi
npm run import:wgi
npm run import:weo
npm run import:wpp
npm run import:atlas
npm run import:factbook
npm run import:security
npm run build:urban-centres
npm run import:ghsl
npm run build:province-data
npm run build:country-data
npm run generate:country-borders
```

Optional audit:

```bash
npm run audit:stats
```

## NPM Scripts

- `dev`: start Vite dev server
- `build`: run TypeScript build and Vite production build
- `preview`: preview the production build
- `import:wdi`: import World Bank WDI country indicators
- `import:wgi`: import World Bank WGI governance indicators
- `import:weo`: import IMF WEO / DataMapper indicators
- `import:wpp`: import UN WPP demographics
- `import:atlas`: import Atlas trade structure data
- `import:factbook`: import CIA Factbook political-system data
- `import:security`: import World Bank security indicators
- `build:urban-centres`: build GHSL urban-centre records and coverage
- `import:ghsl`: build province settlement rollups from matched GHSL urban centres
- `build:province-data`: build canonical province settlement data
- `build:country-data`: build canonical merged country data
- `generate:country-borders`: derive country borders from provinces
- `audit:stats`: audit overlapping WDI/IMF macro indicators

## Key Paths

```txt
public/data/
  provinces.geojson
  country-borders.geojson
  country-stats.json
  governance-stats.json
  imf-weo-stats.json
  un-wpp-demographics.json
  atlas-trade-profiles.json
  factbook-political-profiles.json
  security-stats.json
  urban-centres.json
  province-settlement-stats.json
  canonical-province-data.json
  canonical-country-data.json
  *-coverage.json

scripts/
  importWorldBankCountryStats.mjs
  importWorldBankGovernanceStats.mjs
  importImfWeoStats.mjs
  importUnWppDemographics.mjs
  importAtlasTradeProfiles.mjs
  importFactbookPoliticalProfiles.mjs
  importWorldBankSecurityStats.mjs
  buildUrbanCentres.mjs
  importGhslSettlementData.mjs
  buildCanonicalProvinceData.mjs
  buildCanonicalCountryData.mjs
  generateCountryBorders.mjs
  auditCountryStatsOverlap.mjs

src/map/
  GameCanvas.tsx
  GameCanvas.css
```

## Important Caveats

- The in-game start date is fixed to `2025-01-01`, but source datasets have real-world publication lags.
- WDI, WGI, IMF, and WPP all prefer `2024` with `2023` fallback where needed.
- Security stats prefer `2024`, then `2023`, then the latest non-null year available per field.
- Atlas currently resolves to `2016` because the selected official file does not expose `2024` or `2023`.
- Factbook matching is incomplete for some territories, oceans, and supranational entities.
- Province geometry is checked in directly and treated as ground truth by the current frontend.
- GHSL settlement coverage is currently UCDB-only. Province and country `urbanCentre*` metrics do not represent full-raster province totals.
- `settlementDataCompleteness` is the canonical signal for this limitation in generated settlement outputs.

## Recommended Extension Pattern

- Keep `public/data/canonical-country-data.json` as the single country-state input for gameplay systems.
- Keep `public/data/canonical-province-data.json` as the province settlement input for province-level overlays and inspectors.
- Add new datasets through importer scripts rather than frontend-specific data patches.
- Extend `scripts/buildCanonicalCountryData.mjs` when adding new canonical fields.
- Extend `scripts/buildCanonicalProvinceData.mjs` and `scripts/lib/ghslSettlement.mjs` when adding better province settlement coverage.
- Preserve the province-first geometry model and treat country-level values as overlays.
