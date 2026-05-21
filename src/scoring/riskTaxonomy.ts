import fs from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import type { RiskItem } from "../types.js";

export type RiskTaxonomyLevel = "low" | "medium" | "high";

export interface RiskTaxonomyEntry {
  code: string;
  level: RiskTaxonomyLevel;
  title: string;
  description: string;
  matchHints: string[];
}

export interface RiskTaxonomy {
  version: string;
  entries: RiskTaxonomyEntry[];
}

const ALLOWED_LEVELS: RiskTaxonomyLevel[] = ["low", "medium", "high"];
const ROOT_KEYS = ["version", "entries"];
const ENTRY_KEYS = ["code", "level", "title", "description", "matchHints"];

export function loadRiskTaxonomy(filePath: string): RiskTaxonomy {
  if (!fs.existsSync(filePath)) {
    throw new Error(`risk taxonomy file not found: ${path.resolve(filePath)}`);
  }

  const parsed = load(fs.readFileSync(filePath, "utf-8"));
  const root = expectRecord(parsed, filePath);
  assertSupportedKeys(root, ROOT_KEYS, filePath);

  const entries = Array.isArray(root.entries) ? root.entries : [];
  return {
    version: typeof root.version === "string" ? root.version : "v1",
    entries: entries.flatMap((entry, index) => parseRiskTaxonomyEntry(entry, `${filePath}.entries[${index}]`)),
  };
}

export function findRiskTaxonomyEntry(
  taxonomy: RiskTaxonomy,
  code: string | undefined,
): RiskTaxonomyEntry | undefined {
  if (!code) {
    return undefined;
  }
  return taxonomy.entries.find((entry) => entry.code === code);
}

export function normalizeRiskItem(risk: RiskItem, taxonomy: RiskTaxonomy): RiskItem {
  const entry = findRiskTaxonomyEntry(taxonomy, risk.risk_code);
  if (!entry) {
    return risk;
  }

  return {
    ...risk,
    risk_code: entry.code,
    risk_category: entry.level,
    level: entry.level,
    title: entry.title,
    description: risk.description || entry.description,
  };
}

function parseRiskTaxonomyEntry(value: unknown, location: string): RiskTaxonomyEntry[] {
  const record = expectRecord(value, location);
  assertSupportedKeys(record, ENTRY_KEYS, location);

  const code = expectString(record.code, `${location}.code`);
  const level = expectLevel(record.level, `${location}.level`);
  const title = expectString(record.title, `${location}.title`);
  const description = expectString(record.description, `${location}.description`);

  return [
    {
      code,
      level,
      title,
      description,
      matchHints: record.matchHints === undefined ? [] : expectStringArray(record.matchHints, `${location}.matchHints`),
    },
  ];
}

function expectLevel(value: unknown, location: string): RiskTaxonomyLevel {
  const level = expectString(value, location);
  if (!ALLOWED_LEVELS.includes(level as RiskTaxonomyLevel)) {
    throw new Error(`${location} must be one of ${ALLOWED_LEVELS.join(", ")}`);
  }
  return level as RiskTaxonomyLevel;
}

function expectStringArray(value: unknown, location: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${location} must be an array`);
  }
  const strings = value.filter((item): item is string => typeof item === "string");
  if (strings.length !== value.length) {
    throw new Error(`${location} must only contain strings`);
  }
  return strings;
}

function assertSupportedKeys(
  record: Record<string, unknown>,
  supportedKeys: string[],
  location: string,
): void {
  for (const key of Object.keys(record)) {
    if (!supportedKeys.includes(key)) {
      throw new Error(`Unsupported field at ${location}: ${key}`);
    }
  }
}

function expectRecord(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${location} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, location: string): string {
  if (typeof value !== "string") {
    throw new Error(`${location} must be a string`);
  }
  return value;
}
