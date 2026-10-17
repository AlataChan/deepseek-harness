// One runnable check for the term-glossary skill: data integrity plus real CLI
// lookups for colloquial phrases. Run: node scripts/self-check.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "scripts", "lookup.mjs");

const glossary = JSON.parse(readFileSync(path.join(ROOT, "data", "glossary.json"), "utf8"));
assert.ok(glossary.count >= 300, `expected a full glossary, got ${glossary.count}`);
assert.equal(glossary.count, glossary.entries.length, "count must match entries");
const ids = new Set();
for (const entry of glossary.entries) {
  assert.ok(!ids.has(entry.id), `duplicate id ${entry.id}`);
  ids.add(entry.id);
  assert.ok(entry.plain?.trim(), `empty plain for ${entry.id}`);
  assert.ok(entry.term && entry.url, `missing name/url for ${entry.id}`);
}

const inventory = JSON.parse(readFileSync(path.join(ROOT, "data", "inventory.json"), "utf8"));
assert.equal(glossary.entries.length, inventory.entries.length, "glossary must cover every inventory entry");
for (const entry of inventory.entries) {
  assert.ok(ids.has(entry.id), `missing glossary entry for ${entry.id}`);
}

function lookup(...args) {
  return JSON.parse(execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: "/" }));
}

const exact = lookup("--query", "Tooltip");
assert.equal(exact.matches[0]?.id, "tooltip", "english name should hit tooltip first");

const colloquial = lookup("--query", "鼠标放上去");
const colloquialIds = colloquial.matches.map((match) => match.id);
assert.ok(colloquialIds.includes("hover"), `鼠标放上去 should hit hover, got ${colloquialIds}`);
assert.ok(colloquialIds.includes("tooltip"), `鼠标放上去 should hit tooltip, got ${colloquialIds}`);

const spinner = lookup("--query", "一直在转圈");
assert.equal(spinner.matches[0]?.id, "spinner", "一直在转圈 should hit spinner first");

const batch = lookup("--query", "转圈", "--query", "回滚");
assert.equal(batch.queries?.length, 2, "two queries should return two result groups");

const absent = lookup("--query", "红烧肉怎么做");
assert.equal(absent.ok, true, "absent query still succeeds");
assert.ok(
  absent.matches.every((match) => match.score < 40),
  `absent query should not produce strong matches: ${JSON.stringify(absent.matches)}`,
);

let rejected = false;
try {
  execFileSync(process.execPath, [CLI, "--query", "a", "--query", "b", "--query", "c", "--query", "d"], {
    encoding: "utf8",
    cwd: "/",
    stdio: ["ignore", "pipe", "ignore"],
  });
} catch (error) {
  rejected = JSON.parse(error.stdout).ok === false;
}
assert.ok(rejected, "more than three queries must be rejected");

process.stdout.write(`term-glossary self-check passed: ${glossary.count} entries, CLI lookups verified.\n`);
