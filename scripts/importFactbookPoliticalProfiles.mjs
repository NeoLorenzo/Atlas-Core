import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { Readable } from "node:stream";
import * as unzipper from "unzipper";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GAME_START_DATE = "2025-01-01";

const FACTBOOK_ARCHIVE_SOURCES = [
  {
    name: "factbook/cache.factbook.json",
    url: "https://codeload.github.com/factbook/cache.factbook.json/zip/refs/heads/master",
  },
  {
    name: "factbook/factbook.json",
    url: "https://codeload.github.com/factbook/factbook.json/zip/refs/heads/master",
  },
];

const RAW_DIR = resolve(__dirname, "..", "public", "data", "raw", "factbook");
const RAW_ARCHIVE_PATH = resolve(RAW_DIR, "factbook-source.zip");
const CANONICAL_PATH = resolve(__dirname, "..", "public", "data", "canonical-country-data.json");
const OUTPUT_PATH = resolve(__dirname, "..", "public", "data", "factbook-political-profiles.json");
const COVERAGE_PATH = resolve(__dirname, "..", "public", "data", "factbook-political-profiles-coverage.json");

const FACTBOOK_COUNTRY_ALIASES = {
  "United States": "USA",
  "United States of America": "USA",
  China: "CHN",
  Russia: "RUS",
  "Korea, South": "KOR",
  "South Korea": "KOR",
  "Korea, North": "PRK",
  "North Korea": "PRK",
  Iran: "IRN",
  Syria: "SYR",
  Vietnam: "VNM",
  Laos: "LAO",
  Bolivia: "BOL",
  Venezuela: "VEN",
  Tanzania: "TZA",
  Moldova: "MDA",
  Brunei: "BRN",
  Czechia: "CZE",
  "Czech Republic": "CZE",
  "Congo, Democratic Republic of the": "COD",
  "Democratic Republic of the Congo": "COD",
  "Congo, Republic of the": "COG",
  "Republic of the Congo": "COG",
  "Cote d'Ivoire": "CIV",
  "Ivory Coast": "CIV",
  Eswatini: "SWZ",
  Swaziland: "SWZ",
  Burma: "MMR",
  Myanmar: "MMR",
  "The Bahamas": "BHS",
  "Bahamas, The": "BHS",
  "The Gambia": "GMB",
  "Gambia, The": "GMB",
  Egypt: "EGY",
  Somalia: "SOM",
  Yemen: "YEM",
  Kyrgyzstan: "KGZ",
  Slovakia: "SVK",
  "Turkey (Turkiye)": "TUR",
  "Holy See (Vatican City)": "VAT",
  "Micronesia, Federated States of": "FSM",
  "Saint Kitts and Nevis": "KNA",
  "Saint Lucia": "LCA",
  "Saint Vincent and the Grenadines": "VCT",
  "Virgin Islands": "VIR",
  "Falkland Islands (Islas Malvinas)": "FLK",
  "South Georgia and South Sandwich Islands": "SGS",
  "Puerto Rico": "PRI",
  "Hong Kong": "HKG",
  "Macau": "MAC",
  Taiwan: "TWN",
  "West Bank": "PSE",
  "Gaza Strip": "PSE",
};

const RAW_FIELD_CANDIDATES = {
  governmentType: ["governmenttype", "typeofgovernment"],
  capital: ["capital"],
  administrativeDivisions: ["administrativedivisions", "administrativeareas"],
  independence: ["independence"],
  constitution: ["constitution"],
  legalSystem: ["legalsystem"],
  suffrage: ["suffrage"],
  executiveBranch: ["executivebranch", "executive"],
  legislativeBranch: ["legislativebranch", "legislative", "legislature"],
  judicialBranch: ["judicialbranch", "judicial"],
  politicalPartiesAndLeaders: ["politicalpartiesandleaders", "politicalparties", "partiesandleaders"],
  electionsAppointments: ["electionsappointments", "elections", "appointments"],
  internationalOrganizationParticipation: [
    "internationalorganizationparticipation",
    "internationalorganizationparticipation",
    "internationalorganizationmembership",
  ],
  countryName: ["countryname", "conventionalshortform", "conventionallongform"],
};

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function normalizeText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeKey(key) {
  return String(key ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ; ")
    .replace(/<\/p>/gi, " ; ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*/g, " ; ")
    .trim();
}

function isValidIso3(value) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

function extractText(value, depth = 0) {
  if (typeof value === "string") {
    const trimmed = stripHtml(value);
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const texts = value
      .map((item) => extractText(item, depth + 1))
      .filter((item) => typeof item === "string" && item.length > 0);
    if (texts.length === 0) {
      return null;
    }
    return Array.from(new Set(texts)).join(" ; ");
  }

  if (!isRecord(value) || depth > 8) {
    return null;
  }

  if (typeof value.text === "string" && value.text.trim().length > 0) {
    return value.text.trim();
  }

  const texts = [];
  for (const nested of Object.values(value)) {
    const text = extractText(nested, depth + 1);
    if (text) {
      texts.push(text);
    }
  }

  if (texts.length === 0) {
    return null;
  }

  return Array.from(new Set(texts)).join(" ; ");
}

function getGovernmentCategory(profile) {
  if (!isRecord(profile?.categories)) {
    return null;
  }

  for (const category of Object.values(profile.categories)) {
    if (isRecord(category) && typeof category.title === "string") {
      if (normalizeText(category.title).includes("government")) {
        return category;
      }
    }
  }

  return null;
}

function fieldText(field) {
  if (!isRecord(field)) {
    return null;
  }

  if (typeof field.value === "string" && field.value.trim().length > 0) {
    return stripHtml(field.value);
  }
  if (typeof field.content === "string" && field.content.trim().length > 0) {
    return stripHtml(field.content);
  }
  if (isRecord(field.subfields)) {
    const texts = [];
    for (const sub of Object.values(field.subfields)) {
      const text = fieldText(sub);
      if (text) {
        texts.push(text);
      }
    }
    if (texts.length > 0) {
      return Array.from(new Set(texts)).join(" ; ");
    }
  }

  return null;
}

function getGovernmentFieldsMap(governmentCategory) {
  const map = new Map();
  if (!isRecord(governmentCategory?.fields)) {
    return map;
  }

  for (const field of Object.values(governmentCategory.fields)) {
    if (!isRecord(field) || typeof field.name !== "string") {
      continue;
    }
    const key = normalizeKey(field.name);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(field);
  }

  return map;
}

function findGovernmentField(fieldsMap, candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeKey(candidate);
    if (fieldsMap.has(normalized)) {
      return fieldsMap.get(normalized)[0];
    }
  }

  for (const candidate of candidates) {
    const normalized = normalizeKey(candidate);
    for (const [fieldName, fieldList] of fieldsMap.entries()) {
      if (fieldName.includes(normalized) || normalized.includes(fieldName)) {
        return fieldList[0];
      }
    }
  }

  return null;
}

function fieldSubfieldText(field, subfieldNameCandidates) {
  if (!isRecord(field?.subfields)) {
    return null;
  }
  for (const sub of Object.values(field.subfields)) {
    if (!isRecord(sub) || typeof sub.name !== "string") {
      continue;
    }
    const subName = normalizeKey(sub.name);
    for (const candidate of subfieldNameCandidates) {
      const cand = normalizeKey(candidate);
      if (subName === cand || subName.includes(cand) || cand.includes(subName)) {
        const text = fieldText(sub);
        if (text) {
          return text;
        }
      }
    }
  }
  return null;
}

function collectKeyedValues(root) {
  const entries = [];

  function walk(node, path) {
    if (!isRecord(node)) {
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      const nextPath = [...path, key];
      const text = extractText(value);
      if (text) {
        entries.push({
          key,
          keyNorm: normalizeKey(key),
          path: nextPath,
          pathNorm: nextPath.map((part) => normalizeKey(part)).join("."),
          text,
        });
      }
      if (isRecord(value)) {
        walk(value, nextPath);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (isRecord(item)) {
            walk(item, nextPath);
          }
        }
      }
    }
  }

  walk(root, []);
  return entries;
}

function scoreFieldCandidate(entry, candidates, sectionHints = []) {
  let score = 0;
  for (const candidate of candidates) {
    if (entry.keyNorm === candidate) {
      score = Math.max(score, 100);
    } else if (entry.keyNorm.includes(candidate)) {
      score = Math.max(score, 80);
    } else if (entry.pathNorm.includes(candidate)) {
      score = Math.max(score, 65);
    }
  }

  for (const hint of sectionHints) {
    if (entry.pathNorm.includes(hint)) {
      score += 10;
    }
  }

  if (entry.keyNorm.length <= 5) {
    score -= 15;
  }
  if (entry.text.length > 4000) {
    score -= 20;
  }

  return score;
}

function pickField(entries, candidates, sectionHints = []) {
  let best = null;
  let bestScore = 0;

  for (const entry of entries) {
    const score = scoreFieldCandidate(entry, candidates, sectionHints);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }

  return bestScore >= 65 ? best.text : null;
}

function includesAny(text, needles) {
  if (!text) {
    return false;
  }
  const normalized = normalizeText(text);
  return needles.some((needle) => normalized.includes(normalizeText(needle)));
}

function normalizeGovernmentFamily(governmentTypeText) {
  const text = normalizeText(governmentTypeText);
  if (!text) {
    return null;
  }

  if (text.includes("dependent territory") || text.includes("overseas territory") || text.includes("territory of")) {
    return "dependent_territory";
  }
  if (text.includes("semi presidential") || text.includes("semi-presidential")) {
    return "semi_presidential_republic";
  }
  if (text.includes("parliamentary republic")) {
    return "parliamentary_republic";
  }
  if (text.includes("presidential republic")) {
    return "presidential_republic";
  }
  if (text.includes("federal republic")) {
    return "federal_republic";
  }
  if (text.includes("constitutional monarchy")) {
    return "constitutional_monarchy";
  }
  if (text.includes("absolute monarchy")) {
    return "absolute_monarchy";
  }
  if (text.includes("one party") || text.includes("single party") || text.includes("communist state")) {
    return "one_party_state";
  }
  if (text.includes("military") || text.includes("junta")) {
    return "military_regime";
  }
  if (text.includes("theocracy")) {
    return "theocracy";
  }
  if (text.includes("confederation")) {
    return "confederation";
  }
  if (text.includes("monarchy")) {
    if (text.includes("constitutional") || text.includes("parliamentary") || text.includes("ceremonial")) {
      return "constitutional_monarchy";
    }
    return "other";
  }
  if (text.includes("republic")) {
    return "presidential_republic";
  }

  return "other";
}

function extractTitle(text, candidates) {
  if (!text) {
    return null;
  }
  const normalized = normalizeText(text);
  for (const title of candidates) {
    if (normalized.includes(normalizeText(title))) {
      return title;
    }
  }
  return null;
}

function computeNormalized(raw) {
  const governmentType = raw.governmentType;
  const legislative = raw.legislativeBranch;
  const executive = raw.executiveBranch;
  const suffrage = raw.suffrage;
  const parties = raw.politicalPartiesAndLeaders;
  const elections = raw.electionsAppointments;

  const governmentFamily = normalizeGovernmentFamily(governmentType);

  const hasMonarchy = governmentType
    ? includesAny(governmentType, ["monarchy", "kingdom", "emirate", "sultanate"])
    : null;

  let monarchyType = null;
  if (hasMonarchy === true) {
    if (includesAny(governmentType, ["absolute monarchy"])) {
      monarchyType = "absolute";
    } else if (includesAny(governmentType, ["constitutional monarchy"])) {
      monarchyType = "constitutional";
    } else if (includesAny(governmentType, ["ceremonial"])) {
      monarchyType = "ceremonial";
    } else {
      monarchyType = "other";
    }
  }

  let hasParliament = null;
  if (legislative) {
    const normalizedLegislative = normalizeText(legislative);
    hasParliament = !(
      normalizedLegislative.includes("none") ||
      normalizedLegislative.includes("no legislature")
    );
  }

  let legislatureType = null;
  if (legislative) {
    if (includesAny(legislative, ["bicameral", "upper house", "lower house", "senate", "house of representatives"])) {
      legislatureType = "bicameral";
    } else if (includesAny(legislative, ["unicameral"])) {
      legislatureType = "unicameral";
    } else {
      legislatureType = "other";
    }
  }

  let hasElections = null;
  const electionTexts = [elections, executive, legislative].filter((value) => typeof value === "string");
  if (electionTexts.length > 0) {
    hasElections = electionTexts.some((text) =>
      includesAny(text, ["election", "elected", "vote", "voting", "ballot"]),
    );
  }

  let hasUniversalSuffrage = null;
  if (suffrage) {
    if (includesAny(suffrage, ["universal"])) {
      hasUniversalSuffrage = true;
    } else if (includesAny(suffrage, ["limited", "restricted", "none"])) {
      hasUniversalSuffrage = false;
    } else {
      hasUniversalSuffrage = null;
    }
  }

  const isFederal = governmentType ? includesAny(governmentType, ["federal"]) : null;
  const isRepublic = governmentType ? includesAny(governmentType, ["republic"]) : null;
  const isOnePartyState =
    governmentType || parties
      ? includesAny(`${governmentType ?? ""} ${parties ?? ""}`, [
          "one party",
          "single party",
          "communist party",
          "party dominant",
        ])
      : null;
  const isMilitaryRegime =
    governmentType || executive
      ? includesAny(`${governmentType ?? ""} ${executive ?? ""}`, ["military junta", "military council", "military regime", "junta"])
      : null;

  const headOfStateTitle = extractTitle(executive, [
    "President",
    "Prime Minister",
    "King",
    "Queen",
    "Emperor",
    "Emir",
    "Sultan",
    "Governor General",
    "Chief of State",
    "Head of State",
  ]);

  const headOfGovernmentTitle = extractTitle(executive, [
    "Prime Minister",
    "President",
    "Chancellor",
    "Premier",
    "Chief Minister",
    "Head of Government",
  ]);

  return {
    governmentFamily,
    hasMonarchy,
    monarchyType,
    hasParliament,
    legislatureType,
    hasElections,
    hasUniversalSuffrage,
    isFederal,
    isRepublic,
    isOnePartyState,
    isMilitaryRegime,
    headOfStateTitle,
    headOfGovernmentTitle,
  };
}

function normalizeCountryName(name) {
  return normalizeText(name).replace(/\bthe\b/g, "").replace(/\s+/g, " ").trim();
}

async function fetchToFile(url, outputPath) {
  const response = await fetch(url, {
    headers: {
      Accept: "*/*",
      "Accept-Encoding": "*",
      "User-Agent": "Grand-Strat-Game-Importer",
    },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  const stream = createWriteStream(outputPath);
  Readable.fromWeb(response.body).pipe(stream);
  await once(stream, "finish");
}

async function downloadFactbookArchive() {
  await mkdir(RAW_DIR, { recursive: true });
  for (const source of FACTBOOK_ARCHIVE_SOURCES) {
    try {
      console.info(`Trying Factbook source: ${source.name}`);
      await fetchToFile(source.url, RAW_ARCHIVE_PATH);
      return source;
    } catch (error) {
      console.warn(`Failed source ${source.name}:`, error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error("All Factbook source candidates failed.");
}

function getFileStem(path) {
  const parts = path.split("/");
  const fileName = parts.at(-1) ?? "";
  return fileName.endsWith(".json") ? fileName.slice(0, -5) : fileName;
}

function chooseIso3(entityName, canonicalNamesByIso3) {
  if (!entityName) {
    return null;
  }

  if (isValidIso3(entityName.toUpperCase())) {
    return entityName.toUpperCase();
  }

  const aliasIso3 = FACTBOOK_COUNTRY_ALIASES[entityName];
  if (aliasIso3) {
    return aliasIso3;
  }

  const normalized = normalizeCountryName(entityName);
  return canonicalNamesByIso3.get(normalized) ?? null;
}

function cleanCountryCandidate(value) {
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = stripHtml(value).trim();
  if (!cleaned) {
    return null;
  }
  if (cleaned.toLowerCase() === "none") {
    return null;
  }
  if (cleaned.length > 80 || cleaned.includes(" ; ") || cleaned.includes(":")) {
    return null;
  }
  return cleaned;
}

async function main() {
  const canonicalJson = JSON.parse(await readFile(CANONICAL_PATH, "utf8"));
  if (!isRecord(canonicalJson?.countriesByIso3)) {
    throw new Error("canonical-country-data.json is required and must contain countriesByIso3");
  }

  const canonicalNamesByIso3 = new Map();
  for (const [iso3, country] of Object.entries(canonicalJson.countriesByIso3)) {
    if (isRecord(country) && typeof country.name === "string") {
      canonicalNamesByIso3.set(normalizeCountryName(country.name), iso3);
    }
  }
  for (const [aliasName, iso3] of Object.entries(FACTBOOK_COUNTRY_ALIASES)) {
    canonicalNamesByIso3.set(normalizeCountryName(aliasName), iso3);
  }

  const selectedSource = await downloadFactbookArchive();
  const zip = await unzipper.Open.file(RAW_ARCHIVE_PATH);

  const countryEntries = zip.files.filter((entry) => {
    const path = entry.path.toLowerCase();
    if (!path.endsWith(".json")) {
      return false;
    }
    if (path.includes("readme") || path.includes("license")) {
      return false;
    }
    return path.split("/").length >= 3;
  });

  const countriesByIso3 = {};
  const unmatchedEntityNames = [];
  const missingFieldsByCountry = {};
  const normalizationCounts = {};

  let totalParsed = 0;
  let totalMatched = 0;
  let completeProfileCount = 0;
  let partialProfileCount = 0;
  let monarchyCount = 0;
  let bicameralCount = 0;
  let unicameralCount = 0;
  let electionsDetectedCount = 0;
  let suffrageDetectedCount = 0;

  for (const entry of countryEntries) {
    let parsed;
    try {
      const content = await entry.buffer();
      parsed = JSON.parse(content.toString("utf8"));
    } catch {
      continue;
    }

    if (!isRecord(parsed)) {
      continue;
    }

    totalParsed += 1;
    const entries = collectKeyedValues(parsed);
    const governmentCategory = getGovernmentCategory(parsed);
    const governmentFields = getGovernmentFieldsMap(governmentCategory);

    const countryNameField = findGovernmentField(governmentFields, ["Country name"]);
    const countryNameFromGovernment =
      fieldSubfieldText(countryNameField, ["conventional short form", "conventional long form"]) ??
      fieldText(countryNameField);

    const parsedName = cleanCountryCandidate(typeof parsed.name === "string" ? parsed.name : null);
    const countryNameFromData =
      cleanCountryCandidate(countryNameFromGovernment) ??
      parsedName ??
      cleanCountryCandidate(pickField(entries, RAW_FIELD_CANDIDATES.countryName, ["government"])) ??
      cleanCountryCandidate(pickField(entries, ["name"], ["government"]));

    const pathCode = getFileStem(entry.path);
    const fallbackName = countryNameFromData ?? pathCode.toUpperCase();
    const iso3 =
      chooseIso3(countryNameFromGovernment ?? "", canonicalNamesByIso3) ??
      chooseIso3(parsedName ?? "", canonicalNamesByIso3) ??
      chooseIso3(countryNameFromData ?? "", canonicalNamesByIso3);

    if (!iso3 || !isValidIso3(iso3)) {
      unmatchedEntityNames.push(fallbackName);
      continue;
    }

    totalMatched += 1;

    const structuredGovernmentRaw = {
      governmentType: fieldText(findGovernmentField(governmentFields, ["Government type"])),
      capital: fieldText(findGovernmentField(governmentFields, ["Capital"])),
      administrativeDivisions: fieldText(findGovernmentField(governmentFields, ["Administrative divisions"])),
      independence: fieldText(findGovernmentField(governmentFields, ["Independence"])),
      constitution: fieldText(findGovernmentField(governmentFields, ["Constitution"])),
      legalSystem: fieldText(findGovernmentField(governmentFields, ["Legal system"])),
      suffrage: fieldText(findGovernmentField(governmentFields, ["Suffrage"])),
      executiveBranch: fieldText(findGovernmentField(governmentFields, ["Executive branch"])),
      legislativeBranch: fieldText(findGovernmentField(governmentFields, ["Legislative branch"])),
      judicialBranch: fieldText(findGovernmentField(governmentFields, ["Judicial branch"])),
      politicalPartiesAndLeaders: fieldText(
        findGovernmentField(governmentFields, ["Political parties", "Political parties and leaders"]),
      ),
      electionsAppointments:
        fieldText(findGovernmentField(governmentFields, ["Elections and appointments", "Election results"])) ??
        fieldSubfieldText(findGovernmentField(governmentFields, ["Executive branch"]), [
          "election/appointment process",
        ]),
      internationalOrganizationParticipation: fieldText(
        findGovernmentField(governmentFields, [
          "International organization participation",
          "International law organization participation",
        ]),
      ),
    };

    const raw = {
      governmentType:
        structuredGovernmentRaw.governmentType ?? pickField(entries, RAW_FIELD_CANDIDATES.governmentType, ["government"]),
      capital: structuredGovernmentRaw.capital ?? pickField(entries, RAW_FIELD_CANDIDATES.capital, ["government"]),
      administrativeDivisions:
        structuredGovernmentRaw.administrativeDivisions ??
        pickField(entries, RAW_FIELD_CANDIDATES.administrativeDivisions, ["government"]),
      independence:
        structuredGovernmentRaw.independence ?? pickField(entries, RAW_FIELD_CANDIDATES.independence, ["government"]),
      constitution:
        structuredGovernmentRaw.constitution ?? pickField(entries, RAW_FIELD_CANDIDATES.constitution, ["government"]),
      legalSystem:
        structuredGovernmentRaw.legalSystem ?? pickField(entries, RAW_FIELD_CANDIDATES.legalSystem, ["government"]),
      suffrage: structuredGovernmentRaw.suffrage ?? pickField(entries, RAW_FIELD_CANDIDATES.suffrage, ["government"]),
      executiveBranch:
        structuredGovernmentRaw.executiveBranch ?? pickField(entries, RAW_FIELD_CANDIDATES.executiveBranch, ["government"]),
      legislativeBranch:
        structuredGovernmentRaw.legislativeBranch ??
        pickField(entries, RAW_FIELD_CANDIDATES.legislativeBranch, ["government"]),
      judicialBranch:
        structuredGovernmentRaw.judicialBranch ?? pickField(entries, RAW_FIELD_CANDIDATES.judicialBranch, ["government"]),
      politicalPartiesAndLeaders:
        structuredGovernmentRaw.politicalPartiesAndLeaders ??
        pickField(entries, RAW_FIELD_CANDIDATES.politicalPartiesAndLeaders, ["government"]),
      electionsAppointments:
        structuredGovernmentRaw.electionsAppointments ??
        pickField(entries, RAW_FIELD_CANDIDATES.electionsAppointments, ["government"]),
      internationalOrganizationParticipation:
        structuredGovernmentRaw.internationalOrganizationParticipation ??
        pickField(entries, RAW_FIELD_CANDIDATES.internationalOrganizationParticipation, ["government", "economy"]),
    };

    const normalized = computeNormalized(raw);

    normalizationCounts[normalized.governmentFamily ?? "null"] =
      (normalizationCounts[normalized.governmentFamily ?? "null"] ?? 0) + 1;

    if (normalized.hasMonarchy === true) {
      monarchyCount += 1;
    }
    if (normalized.legislatureType === "bicameral") {
      bicameralCount += 1;
    } else if (normalized.legislatureType === "unicameral") {
      unicameralCount += 1;
    }
    if (normalized.hasElections === true) {
      electionsDetectedCount += 1;
    }
    if (normalized.hasUniversalSuffrage !== null) {
      suffrageDetectedCount += 1;
    }

    const missingFields = Object.entries(raw)
      .filter(([, value]) => value === null)
      .map(([key]) => key);

    if (missingFields.length === 0) {
      completeProfileCount += 1;
    } else {
      partialProfileCount += 1;
      missingFieldsByCountry[iso3] = {
        name: (canonicalJson.countriesByIso3[iso3]?.name ?? countryNameFromData ?? iso3),
        missingFields,
      };
    }

    countriesByIso3[iso3] = {
      iso3,
      name: canonicalJson.countriesByIso3[iso3]?.name ?? countryNameFromData ?? iso3,
      source: "CIA World Factbook",
      gameStartDate: GAME_START_DATE,
      raw,
      normalized,
    };
  }

  const generatedAt = new Date().toISOString();
  const output = {
    source: "CIA World Factbook",
    gameStartDate: GAME_START_DATE,
    generatedAt,
    sourceUsed: selectedSource,
    countriesByIso3,
  };

  const coverage = {
    generatedAt,
    sourceUsed: selectedSource,
    totalFactbookEntitiesParsed: totalParsed,
    totalMatchedToIso3: totalMatched,
    totalUnmatched: unmatchedEntityNames.length,
    unmatchedEntityNames,
    countriesWithCompletePoliticalProfile: completeProfileCount,
    countriesWithPartialPoliticalProfile: partialProfileCount,
    missingFieldsByCountry,
    normalizationCountsByGovernmentFamily: normalizationCounts,
    monarchyCount,
    bicameralCount,
    unicameralCount,
    electionsDetectedCount,
    suffrageDetectedCount,
  };

  await mkdir(resolve(__dirname, "..", "public", "data"), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(COVERAGE_PATH, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");

  console.info("=== Factbook Political Import Summary ===");
  console.info(`Source: ${selectedSource.name}`);
  console.info(`Factbook entities parsed: ${totalParsed}`);
  console.info(`Matched to ISO3: ${totalMatched}`);
  console.info(`Unmatched: ${unmatchedEntityNames.length}`);
  console.info(`Complete profiles: ${completeProfileCount}`);
  console.info(`Partial profiles: ${partialProfileCount}`);
  console.info(`Wrote ${OUTPUT_PATH}`);
  console.info(`Wrote ${COVERAGE_PATH}`);
}

main().catch((error) => {
  console.error("Failed to import Factbook political profiles.", error);
  process.exitCode = 1;
});
