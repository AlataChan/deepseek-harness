/**
 * Merge the name inventory with our own explanations into data/glossary.json.
 * Authoring source of truth for the explanation text: data/plains.json
 * (id -> one-line plain explanation, written by us). Maintenance-only.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");

const inventory = JSON.parse(readFileSync(path.join(DATA, "inventory.json"), "utf8"));
const plains = JSON.parse(readFileSync(path.join(DATA, "plains.json"), "utf8"));

const ids = new Set(inventory.entries.map((entry) => entry.id));
const unknown = Object.keys(plains).filter((id) => !ids.has(id));
if (unknown.length) {
  console.error(`unknown ids (not in inventory): ${unknown.join(", ")}`);
  process.exit(1);
}

const missing = inventory.entries.filter((entry) => !plains[entry.id]).map((entry) => entry.id);
if (missing.length) {
  const sample = missing.slice(0, 20).join(", ");
  console.error(`missing explanations for ${missing.length} entries: ${sample}${missing.length > 20 ? ", ..." : ""}`);
  process.exit(1);
}

const entries = inventory.entries.map((entry) => ({ ...entry, plain: plains[entry.id] }));
writeFileSync(
  path.join(DATA, "glossary.json"),
  `${JSON.stringify({
    source: inventory.site,
    revision: inventory.revision,
    note: "词条名称、分类与链接来自 VibeHub 公开接口的清单；每条白话解释为本项目自写。",
    count: entries.length,
    entries,
  }, null, 2)}\n`,
);
console.log(`glossary: ${entries.length}/${inventory.entries.length} entries`);
