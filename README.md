# Atlas Core: January 2025

This project is a reusable **world-state base module** for future games/simulations.

The goal is to maintain a realistic, structured snapshot of the world anchored to:

- **Game start date:** `2025-01-01`

The app includes a province-based world map and a unified country data layer that future systems can build on (economy, governance, demographics, institutions, trade structure, etc.).

## Purpose

Use this repository as a foundation for:

- grand strategy game prototypes
- geopolitical/economic simulations
- scenario testing with country-level baselines
- map-first simulation tooling

It is intentionally **data-first** and **simulation-light** right now.

## Current Scope

Implemented:

- Province-only world geometry rendering (`public/data/provinces.geojson`)
- Country borders derived from provinces (`public/data/country-borders.geojson`)
- Province hover/click selection
- Right-side country/province info panel
- Multiple map modes (political, economy, fiscal, governance, demographics, trade, political system)
- Canonical country dataset merged from multiple sources

Not implemented yet:

- simulation loop
- time progression
- diplomacy/mechanics
- save/load
- backend/database

## Stack

- React + TypeScript + Vite
- MapLibre GL JS
- Node data import/build scripts

## Quick Start

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Data Architecture

Frontend loads **one canonical file**:

- `/data/canonical-country-data.json`

All source datasets are imported and normalized into canonical form via scripts.

### Canonical sections

Each country can include:

- `economy`
- `demographics`
- `fiscal`
- `governance`
- `tradeStructure`
- `politicalSystem`

### Geometry model

- Provinces are the primary map geometry.
- Countries are logical groupings of provinces via metadata/ISO3 matching.

## Data Pipeline

### 1) Import source datasets

```bash
npm run import:wdi
npm run import:wgi
npm run import:weo
npm run import:wpp
npm run import:atlas
npm run import:factbook
```

### 2) Build canonical country data

```bash
npm run build:country-data
```

### 3) Optional utility scripts

```bash
npm run generate:country-borders
npm run audit:stats
```

## NPM Scripts

- `dev`: start Vite dev server
- `build`: TypeScript + production build
- `preview`: preview production build
- `import:wdi`: import World Bank WDI
- `import:wgi`: import World Bank WGI
- `import:weo`: import IMF WEO
- `import:wpp`: import UN WPP demographics
- `import:atlas`: import Atlas trade profiles
- `import:factbook`: import CIA Factbook political profiles
- `build:country-data`: merge all source data into canonical country data
- `generate:country-borders`: derive country borders from province geometry
- `audit:stats`: overlap audit for duplicated macro indicators

## Source Datasets

- **World Bank WDI**: macro/social indicators (2024 preferred, 2023 fallback)
- **World Bank WGI**: governance quality indicators (2024 preferred, 2023 fallback)
- **IMF WEO / DataMapper**: macro-fiscal indicators (2024 preferred, 2023 fallback)
- **UN WPP 2024**: demographic structure metrics (2024 preferred, 2023 fallback)
- **Atlas of Economic Complexity**: trade/productive structure (latest available in source import)
- **CIA World Factbook**: political institutions / government structure

## Important Caveats (Current Snapshot)

- Canonical game date is fixed at `2025-01-01`, but source datasets have different publication lags.
- Atlas import currently resolves to **2016** in available official file (see `atlas-trade-profiles-coverage.json`).
- Factbook political matching currently covers most but not all entities (see `factbook-political-profiles-coverage.json`).
- Coverage and missing fields are tracked in `public/data/*-coverage.json`.

## File Layout (Key Paths)

```txt
public/data/
  provinces.geojson
  country-borders.geojson
  canonical-country-data.json
  canonical-country-data-coverage.json
  ...

scripts/
  importWorldBankCountryStats.mjs
  importWorldBankGovernanceStats.mjs
  importImfWeoStats.mjs
  importUnWppDemographics.mjs
  importAtlasTradeProfiles.mjs
  importFactbookPoliticalProfiles.mjs
  buildCanonicalCountryData.mjs
  generateCountryBorders.mjs
  auditCountryStatsOverlap.mjs

src/map/
  GameCanvas.tsx
  GameCanvas.css
```

## How To Use This As A Base Module

Recommended workflow for new projects:

1. Fork/clone this repository.
2. Keep `public/data/canonical-country-data.json` as the single country-state input.
3. Add new importer scripts for new datasets instead of patching frontend data logic.
4. Extend `buildCanonicalCountryData.mjs` to integrate new fields.
5. Keep geometry province-first; treat country-level concepts as metadata overlays.

## Design Principles

- Single canonical country layer for frontend simplicity
- Province geometry as ground truth
- Deterministic map coloring and matching
- Explicit coverage reporting for every import stage
- Clear separation between **data baseline** and **future simulation logic**

---

If you want, next step can be a `SCHEMA.md` that formally documents the canonical JSON contract for future game modules.
