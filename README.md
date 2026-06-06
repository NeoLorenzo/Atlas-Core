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
- GHSL urban-centre, province-settlement, and province-raster-settlement rollups in `public/data/urban-centres.json`, `public/data/province-settlement-stats.json`, and `public/data/province-raster-settlement-stats.json`
- Natural Earth 1:10m strategic infrastructure stats, province-to-province connection graph, and frontend-ready visualization layers

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

The source-specific dataset files remain in `public/data/` for inspection, coverage auditing, and rebuilds. The map UI reads from the canonical country file for country statistics and political-system metadata, from the canonical province file for settlement and province-level infrastructure overlays, and lazily loads the frontend-ready infrastructure GeoJSON files when the infrastructure layer toggles are enabled.

Current health-system frontend usage:

- The inspector reads `country.healthSystem` from `public/data/canonical-country-data.json`
- Country map modes currently expose:
  `Health Capacity`, `Hospital Beds / 1,000`, `Physicians / 1,000`, `Nurses & Midwives / 1,000`, `Health Spend per Capita`, and `Health Spend (% GDP)`
- Health confidence remains in canonical data for simulation/data-quality use, but is not currently shown as a dedicated frontend map layer

## Canonical Data Model

Each country in `public/data/canonical-country-data.json` can contain:

- `economy`
- `demographics`
- `fiscal`
- `governance`
- `tradeStructure`
- `security`
- `healthSystem`
- `politicalSystem`
- `settlement`

Each province in `public/data/canonical-province-data.json` currently contains:

- `provinceId`
- `provinceName`
- `countryIso3`
- `countryName`
- `areaKm2`
- `settlement`
- `infrastructure`

The `infrastructure` object currently includes:

- strategic airport, port, rail, and highway stats
- a province-level strategic `connectivityScore`
- province-to-province transport connection summaries under `infrastructure.connections`
- an abstract `connectionScore` derived from the strategic road and rail connection graph

## Strategic Infrastructure Files

The Natural Earth strategic-infrastructure pipeline now produces three different kinds of outputs:

- `public/data/infrastructure-stats.json`
  Province-level strategic infrastructure stats and the data that roll into canonical province and country infrastructure sections.
- `public/data/infrastructure-connections.json`
  An abstract province-to-province strategic connection graph derived from Natural Earth 1:10m roads and railroads.
- `public/data/infrastructure-airports.geojson`
- `public/data/infrastructure-ports.geojson`
- `public/data/infrastructure-railroads.geojson`
- `public/data/infrastructure-highways.geojson`
  Frontend-ready visualization layers for actual map rendering.
- `public/data/infrastructure-visual-layers-coverage.json`
  Coverage and export summary for the frontend visualization layers.

The app uses these in two separate ways:

- Province thematic overlays:
  `connectivityScore`, `connectionScore`, airport/port counts, highway-connected province count, rail-connected province count, connected-country count, and density views.
- Actual infrastructure visual layers:
  airports, major airports, ports, major ports, railroads, and highways rendered directly on the map as points and lines.

Important scope note:

- These visual layers show generalized Natural Earth 1:10m strategic infrastructure.
- They are not OpenStreetMap-derived.
- They are not a routing network.
- They do not represent local or rural roads.
- They are intended for map visualization and high-level gameplay context, not turn-by-turn travel modeling.
- Point features are matched to provinces for metadata only.

Each numeric field is stored as:

- `value`
- `year`
- `source`

Political-system text and booleans are stored as Factbook-derived fields with a `source`.

Settlement caveat:

- Current GHSL-derived `urbanCentre*` province and country settlement fields are UCDB urban-centre aggregates, while `raster*` fields are full-province or full-country GHSL raster totals.
- `settlementDataCompleteness` and `rasterSettlementDataCompleteness` are intentionally separate.
- `settlementDataCompleteness.value = "urban-centres-only"` refers to the UCDB-only urban-centre rollup.
- `rasterSettlementDataCompleteness.value` reports whether province-wide GHSL raster aggregation was available for population and built-up surface.

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

### 8. World Bank Health System Stats

Script:

- `scripts/importWorldBankHealthStats.mjs`

Generated files:

- `public/data/health-stats.json`
- `public/data/health-stats-coverage.json`

Source behavior:

- Uses the World Bank API, source `2`
- Prefers year `2024`
- Falls back to year `2023`
- If neither is available for a field, uses the latest available non-null year
- Filters out aggregate/non-country rows
- Matches on ISO3 and preserves the selected year per field
- Country-level only; intended for strategic simulation mechanics rather than local hospital routing

Imported indicators:

- `hospitalBedsPer1000`
- `physiciansPer1000`
- `nursesMidwivesPer1000`
- `currentHealthExpenditurePerCapitaUsd`
- `currentHealthExpenditurePctOfGdp`

Canonical fields:

- raw imported fields:
  `hospitalBedsPer1000`, `physiciansPer1000`, `nursesMidwivesPer1000`, `currentHealthExpenditurePerCapitaUsd`, `currentHealthExpenditurePctOfGdp`
- derived scores:
  `healthCapacityScore`, `medicalWorkforceScore`, `hospitalSurgeCapacityScore`, `outbreakTreatmentScore`
- derived data-quality / confidence signals:
  `healthDataFreshnessScore`, `healthFieldCoverageScore`, `healthCapacityScoreConfidence`

How it is used in canonical data:

- Populates the `healthSystem` section
- Leaves imported fields as `{ value, year, source }`
- Derives health capacity scores in the canonical builder with weighted averages over available components
- Uses the latest available non-null year when 2024/2023 are unavailable because health indicators often lag
- Separates estimated health capacity from confidence in that estimate
- Derives confidence from raw health-field coverage plus selected-year freshness
- Treats confidence as a gameplay/data-quality signal rather than a direct measure of real-world accuracy

Coverage diagnostics:

- `health-stats-coverage.json` includes per-field selected-year distributions
- It also includes compact per-field year-age buckets:
  `>= 2023`, `2020-2022`, `2015-2019`, `2010-2014`, and `< 2010`
- This is intended to help audit stale-but-usable health fields without inflating the main dataset

### 9. GHSL Urban Centres And Province Settlement

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

### 10. GHSL Raster Province Settlement

Scripts:

- `scripts/importGhslRasterSettlementData.mjs`
- `scripts/lib/ghslRaster.mjs`
- `scripts/buildCanonicalProvinceData.mjs`
- `scripts/buildCanonicalCountryData.mjs`

Generated files:

- `public/data/province-raster-settlement-stats.json`
- `public/data/province-raster-settlement-stats-coverage.json`
- `public/data/raw/ghsl-raster/province-index-4326-30ss.geojson`
- `public/data/raw/ghsl-raster/province-id-mask-population-4326-30ss.tif`
- `public/data/raw/ghsl-raster/province-id-mask-built-4326-30ss.tif`

Temporary checkpoint files during processing:

- `public/data/province-raster-settlement-stats.partial.json`
- `public/data/province-raster-settlement-stats-progress.json`

Source behavior:

- Uses GHSL 2025 30-arcsecond global rasters for population and built-up surface.
- Resolves rasters in this order: explicit local override path, cached file in `public/data/raw/ghsl-raster/`, then download URL.
- Accepts either ZIP archives or extracted GeoTIFFs for the population and built-up inputs.
- Uses GDAL by default for the fast path.
- Rasterizes province numeric ids onto each raster's native grid, then scans rows to aggregate province totals without point-in-polygon checks.
- Creates separate province-id masks for the population and built rasters so slightly different GHSL grids do not need to be force-aligned.
- Preserves a slower polygon fallback behind `GHSL_RASTER_USE_SLOW_POLYGON_MODE=1`.

Raster fields emitted:

- `rasterPopulationEstimate`
- `rasterPopulationDensityPerKm2`
- `rasterBuiltUpSurfaceKm2`
- `rasterBuiltUpSurfaceSharePct`
- `rasterPopulationPerBuiltUpKm2`
- `rasterSettlementDataCompleteness`

Derived canonical settlement fields that depend on raster population:

- `nonUrbanCentrePopulationEstimate`
- `urbanCentrePopulationSharePct`

Runtime requirements and controls:

- GDAL is required for the fast importer path. If it is missing, the importer fails clearly unless `GHSL_RASTER_USE_SLOW_POLYGON_MODE=1` is set.
- `GHSL_POP_RASTER_PATH`
- `GHSL_BUILT_RASTER_PATH`
- `GHSL_POP_RASTER_URL`
- `GHSL_BUILT_RASTER_URL`
- `GHSL_RASTER_MAX_PROVINCES`
- `GHSL_RASTER_MAX_ROWS`
- `GHSL_RASTER_RESUME=1`
- `GHSL_RASTER_USE_SLOW_POLYGON_MODE=1`

How it is used in canonical data:

- `canonical-province-data.json` merges UCDB `urbanCentre*` fields with province-wide GHSL `raster*` fields.
- Province `nonUrbanCentrePopulationEstimate` and `urbanCentrePopulationSharePct` are derived from raster population, treating missing UCDB urban-centre population as `0` when raster population exists.
- `canonical-country-data.json` rolls province raster totals up to country-level `raster*` settlement fields and applies the same UCDB-as-zero rule for raster-derived non-urban and share metrics.

### 11. Natural Earth Strategic Infrastructure

Script:

- `scripts/importNaturalEarthInfrastructure.mjs`

Generated files:

- `public/data/infrastructure-stats.json`
- `public/data/infrastructure-stats-coverage.json`
- `public/data/infrastructure-connections.json`
- `public/data/infrastructure-connections-coverage.json`
- `public/data/infrastructure-airports.geojson`
- `public/data/infrastructure-ports.geojson`
- `public/data/infrastructure-railroads.geojson`
- `public/data/infrastructure-highways.geojson`
- `public/data/infrastructure-visual-layers-coverage.json`
- cached archives in `public/data/raw/natural-earth-infrastructure/`

Source behavior:

- Downloads Natural Earth 1:10m cultural transport layers for roads, railroads, airports, and ports
- Caches the raw ZIP archives locally
- Matches airports and ports to province polygons, with a small nearest-province fallback for near-boundary points
- Splits roads and railroads into coordinate-to-coordinate segments and assigns segment length by midpoint province
- Densifies kept roads and railroads at a coarse interval to derive a province-to-province strategic connection graph
- Uses the Natural Earth roads layer as high-level strategic transport only and defensively filters obviously minor classes only when usable hierarchy signals exist
- Exports frontend-ready GeoJSON layers so the map UI does not need to parse shapefiles or raw archives

Province infrastructure fields emitted:

- `airports.count`
- `airports.majorCount`
- `airports.hasAirport`
- `ports.count`
- `ports.majorCount`
- `ports.hasPort`
- `rail.lengthKm`
- `rail.densityKmPer1000Km2`
- `rail.hasRail`
- `roads.highwayLengthKm`
- `roads.densityKmPer1000Km2`
- `roads.hasHighway`
- `connectivityScore`
- `connections.highwayConnectedProvinceCount`
- `connections.railConnectedProvinceCount`
- `connections.connectedProvinceCount`
- `connections.connectedCountryCount`
- `connections.hasInternationalHighwayConnection`
- `connections.hasInternationalRailConnection`
- `connectionScore`

Country infrastructure rollups emitted:

- airport and port totals plus province counts
- rail and highway totals plus country-level densities
- province-weighted strategic `connectivityScore`
- `connections.domesticHighwayEdgeCount`
- `connections.domesticRailEdgeCount`
- `connections.internationalHighwayEdgeCount`
- `connections.internationalRailEdgeCount`
- `connections.connectedCountryCount`
- `connections.internationallyConnectedCountryIso3s`

How it is used in canonical data:

- `canonical-province-data.json` carries the province-level strategic infrastructure bundle under `province.infrastructure`
- `canonical-country-data.json` rolls province infrastructure up to country-level counts, lengths, densities, and connectivity
- `infrastructure-connections.json` is the abstract province-to-province strategic road and rail graph
- `infrastructure-*.geojson` files are used by the frontend to render actual airports, ports, railroads, and highways as map layers
- The infrastructure layer is intentionally strategic and generalized, not a street-level routing or rural-access dataset

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
- `public/data/health-stats.json`
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

`healthSystem`

- imported health capacity fields: World Bank WDI / WHO
- `medicalWorkforceScore`: `0.55 * norm(physiciansPer1000) + 0.45 * norm(nursesMidwivesPer1000)`
- `hospitalSurgeCapacityScore`: `norm(hospitalBedsPer1000)`
- `healthCapacityScore`: `0.30 * norm(hospitalBedsPer1000) + 0.25 * norm(physiciansPer1000) + 0.20 * norm(nursesMidwivesPer1000) + 0.15 * norm(currentHealthExpenditurePerCapitaUsd) + 0.10 * norm(currentHealthExpenditurePctOfGdp)`
- `outbreakTreatmentScore`: `0.60 * healthCapacityScore + 0.20 * norm(governance.governmentEffectiveness) + 0.10 * norm(governance.ruleOfLaw) + 0.10 * norm(infrastructure.connectivityScore)`
- `healthDataFreshnessScore`: weighted average of year freshness factors across available raw health fields, multiplied by `100`
- `healthFieldCoverageScore`: `available raw health field count / 5 * 100`
- `healthCapacityScoreConfidence`: `0.65 * healthFieldCoverageScore + 0.35 * healthDataFreshnessScore`
- score normalization uses winsorized percentile bounds with clamped `0..100` output
- missing score components are reweighted over available inputs instead of forcing null
- confidence does not directly modify `healthCapacityScore`; downstream simulation systems can decide whether to apply confidence adjustments
- the frontend currently emphasizes the raw health-capacity factors plus `healthCapacityScore`; confidence remains available in canonical data but is not surfaced as a dedicated map layer

`politicalSystem`

- all text, boolean, and normalized political-system fields: CIA World Factbook

`settlement`

- province-derived urban-centre rollups: GHSL UCDB + Natural Earth province geometry
- largest urban-centre lists: GHSL UCDB
- province-derived raster population and built-up rollups: GHSL GHS-POP R2023A + GHSL GHS-BUILT-S R2023A
- derived non-urban and urban-share metrics: canonical province rollups built from raster population plus UCDB urban-centre population

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
- `health-stats-coverage.json`
- `urban-centres-coverage.json`
- `province-settlement-stats-coverage.json`
- `province-raster-settlement-stats-coverage.json`
- `infrastructure-stats-coverage.json`
- `infrastructure-connections-coverage.json`
- `infrastructure-visual-layers-coverage.json`
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
npm run import:health
npm run build:urban-centres
npm run import:ghsl
npm run import:ghsl-raster
npm run import:infrastructure
npm run build:province-data
npm run build:country-data
npm run generate:country-borders
npm run build
```

Optional audit:

```bash
npm run audit:stats
```

For GHSL raster imports, the importer first checks local override paths, then cached files under `public/data/raw/ghsl-raster/`, then download URLs. Supported overrides:

- `GHSL_POP_RASTER_PATH`
- `GHSL_BUILT_RASTER_PATH`
- `GHSL_POP_RASTER_URL`
- `GHSL_BUILT_RASTER_URL`

The fast raster importer also supports:

- `GHSL_RASTER_MAX_PROVINCES`: limit province output for debug runs
- `GHSL_RASTER_MAX_ROWS`: limit raster row scanning for debug runs
- `GHSL_RASTER_RESUME=1`: resume from the checkpoint files if they exist
- `GHSL_RASTER_USE_SLOW_POLYGON_MODE=1`: bypass GDAL and use the slower polygon-based fallback

While `npm run import:ghsl-raster` is running, it logs source resolution, ZIP extraction, raster metadata, and aggregation progress. It also writes checkpoint files so long runs can be resumed or inspected mid-run.

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
- `import:health`: import World Bank health-system indicators
- `build:urban-centres`: build GHSL urban-centre records and coverage
- `import:ghsl`: build province settlement rollups from matched GHSL urban centres
- `import:ghsl-raster`: build province-wide GHSL raster population and built-up settlement rollups with GDAL mask aggregation and checkpoint files
- `import:infrastructure`: build strategic infrastructure stats, connection graph, and frontend-ready Natural Earth visualization layers
- `build:province-data`: build canonical province settlement and infrastructure data
- `build:country-data`: build canonical merged country data, including rolled-up infrastructure
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
  health-stats.json
  urban-centres.json
  province-settlement-stats.json
  province-raster-settlement-stats.json
  infrastructure-stats.json
  infrastructure-connections.json
  infrastructure-airports.geojson
  infrastructure-ports.geojson
  infrastructure-railroads.geojson
  infrastructure-highways.geojson
  canonical-province-data.json
  canonical-country-data.json
  *-coverage.json
  raw/natural-earth-infrastructure/
  raw/ghsl-raster/
    province-index-4326-30ss.geojson
    province-id-mask-population-4326-30ss.tif
    province-id-mask-built-4326-30ss.tif

scripts/
  importWorldBankCountryStats.mjs
  importWorldBankGovernanceStats.mjs
  importImfWeoStats.mjs
  importUnWppDemographics.mjs
  importAtlasTradeProfiles.mjs
  importFactbookPoliticalProfiles.mjs
  importWorldBankSecurityStats.mjs
  importWorldBankHealthStats.mjs
  buildUrbanCentres.mjs
  importGhslSettlementData.mjs
  importGhslRasterSettlementData.mjs
  importNaturalEarthInfrastructure.mjs
  buildCanonicalProvinceData.mjs
  buildCanonicalCountryData.mjs
  generateCountryBorders.mjs
  auditCountryStatsOverlap.mjs
  lib/infrastructureConnections.mjs
  lib/ghslRaster.mjs

src/map/
  GameCanvas.tsx
  GameCanvas.css
```

## Important Caveats

- The in-game start date is fixed to `2025-01-01`, but source datasets have real-world publication lags.
- WDI, WGI, IMF, and WPP all prefer `2024` with `2023` fallback where needed.
- Security stats prefer `2024`, then `2023`, then the latest non-null year available per field.
- Health-system stats prefer `2024`, then `2023`, then the latest non-null year available per field because publication lags are common.
- Atlas currently resolves to `2016` because the selected official file does not expose `2024` or `2023`.
- Factbook matching is incomplete for some territories, oceans, and supranational entities.
- Province geometry is checked in directly and treated as ground truth by the current frontend.
- GHSL settlement coverage now separates UCDB urban-centre aggregates (`urbanCentre*`) from full raster province and country totals (`raster*`).
- The health-system dataset is intentionally country-level only and should not be treated as local hospital routing or province-scale capacity data.
- `settlementDataCompleteness` describes the UCDB urban-centre subset, while `rasterSettlementDataCompleteness` describes province-wide GHSL raster coverage.
- The fast GHSL raster importer depends on GDAL unless `GHSL_RASTER_USE_SLOW_POLYGON_MODE=1` is used.
- Natural Earth infrastructure is generalized 1:10m data intended for strategic map context.
- The visual infrastructure layers are not a detailed routing network and do not model local or rural accessibility.
- The province-to-province connection graph is an abstract transport graph derived from generalized Natural Earth roads and railroads.

## Recommended Extension Pattern

- Keep `public/data/canonical-country-data.json` as the single country-state input for gameplay systems.
- Keep `public/data/canonical-province-data.json` as the province settlement input for province-level overlays and inspectors.
- Keep `public/data/infrastructure-*.geojson` as the frontend visualization inputs for actual strategic infrastructure layers.
- Add new datasets through importer scripts rather than frontend-specific data patches.
- Extend `scripts/buildCanonicalCountryData.mjs` when adding new canonical fields.
- Extend `scripts/buildCanonicalProvinceData.mjs`, `scripts/lib/ghslSettlement.mjs`, and `scripts/lib/ghslRaster.mjs` when adding better province settlement coverage.
- Extend `scripts/importNaturalEarthInfrastructure.mjs` and `scripts/lib/infrastructureConnections.mjs` when adding or refining strategic infrastructure layers.
- Preserve the province-first geometry model and treat country-level values as overlays.
