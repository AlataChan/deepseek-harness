/**
 * Local term lookup against data/glossary.json; every query runs offline.
 *
 * Usage: node scripts/lookup.mjs --query '悬停' [--query '鼠标放上去'] [--limit 3]
 */
import { readFileSync } from "node:fs";

let cachedGlossary;

/** Load the glossary once; a load failure surfaces through the caller's error path. */
function glossary() {
  cachedGlossary ??= JSON.parse(readFileSync(new URL("../data/glossary.json", import.meta.url), "utf8"));
  return cachedGlossary;
}

const HELP = `term-glossary lookup

Usage:
  node scripts/lookup.mjs --query "<词或口语>" [--query "..."] [--limit 3]

Options:
  --query <text>  Candidate term or raw colloquial phrase. Repeat up to 3 times.
  --limit <1-5>   Results per query. Defaults to 3.
  --help          Show this help.
`;

function parseArgs(argv) {
  const options = { query: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help") {
      process.stdout.write(HELP);
      process.exit(0);
    }
    if (token === "--query") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--query needs a value");
      options.query.push(value);
      index += 1;
      continue;
    }
    if (token === "--limit") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error("--limit must be 1..5");
      options.limit = value;
      index += 1;
      continue;
    }
    throw new Error(`Unexpected argument: ${token}`);
  }
  if (options.query.length === 0) throw new Error("--query is required");
  if (options.query.length > 3) throw new Error("--query may be repeated at most 3 times");
  return options;
}

const normalize = (value) => String(value).toLowerCase().replace(/\s+/gu, "");
const hasHan = (value) => /[\p{Script=Han}]/u.test(value);

function bigrams(value) {
  const grams = new Set();
  for (const run of value.match(/[\p{Script=Han}]+|[a-z0-9]+/gu) ?? []) {
    if (hasHan(run)) {
      for (let index = 0; index < run.length - 1; index += 1) grams.add(run.slice(index, index + 2));
    } else {
      if (run.length < 3) continue;
      for (let index = 0; index < run.length - 2; index += 1) grams.add(run.slice(index, index + 3));
    }
  }
  return grams;
}

function scoreEntry(entry, query) {
  const fields = [
    [normalize(entry.term), "term", 100, 70],
    [normalize(entry.en ?? ""), "en", 100, 70],
    ...(entry.aliases ?? []).map((alias) => [normalize(alias), "alias", 95, 70]),
    [normalize(entry.plain), "plain", 0, 45],
  ];
  let score = 0;
  const matched = [];
  const queryGrams = bigrams(query);
  for (const [value, name, exact, contains] of fields) {
    if (!value) continue;
    if (value === query) {
      score += exact;
      matched.push(`${name}:exact`);
    } else if (query.length >= 2 && value.includes(query)) {
      score += contains;
      matched.push(`${name}:contains`);
    } else if (query.includes(value) && value.length >= (hasHan(value) ? 2 : 4)) {
      score += exact === 0 ? 0 : 60;
      matched.push(`${name}:inside-query`);
    } else if (queryGrams.size > 0) {
      const overlap = [...bigrams(value)].filter((gram) => queryGrams.has(gram)).length;
      if (overlap > 0) {
        const bonus = name === "plain" ? Math.min(overlap * 5, 25) : Math.min(overlap * 10, 30);
        score += bonus;
        matched.push(`${name}:~${overlap}`);
      }
    }
  }
  return { score, matched };
}

function lookup(query, limit) {
  const normalized = normalize(query);
  const matches = glossary().entries
    .map((entry) => {
      const { score, matched } = scoreEntry(entry, normalized);
      return { entry, score, matched };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id))
    .slice(0, limit)
    .map(({ entry, score, matched }) => ({
      id: entry.id,
      term: entry.term,
      en: entry.en,
      aliases: entry.aliases,
      cat: entry.cat,
      plain: entry.plain,
      url: entry.url,
      score,
      matched,
    }));
  return { query, matches };
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  const limit = options.limit ?? 3;
  const results = options.query.map((query) => lookup(query, limit));
  const response = { ok: true, source: "term-glossary" };
  output(results.length === 1 ? { ...response, ...results[0] } : { ...response, queries: results });
} catch (error) {
  output({ ok: false, error: { code: "lookup_failed", message: error.message } });
  process.exitCode = 1;
}
