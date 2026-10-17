/**
 * Fetch the VibeHub term-name inventory into data/inventory.json — names,
 * aliases, categories, and links only; no site prose.
 *
 * Maintenance-only: run while refreshing the shipped snapshot, never on user
 * machines (this is the one script in this skill that uses the network).
 *
 * Usage: node scripts/fetch-inventory.mjs [--site-url <origin>]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = "octopus-term-inventory/0.1 (+local course glossary; names-only inventory)";
const args = process.argv.slice(2);
const siteIndex = args.indexOf("--site-url");
const siteArg = siteIndex === -1 ? "https://vibe-hub.org" : args[siteIndex + 1];
if (!siteArg || siteArg.startsWith("--")) throw new Error("--site-url needs a value");
const siteUrl = siteArg.replace(/\/+$/, "");

async function getJson(url, label) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  return response.json();
}

const manifest = (await getJson(`${siteUrl}/.well-known/vibehub.json`, "manifest")).data;
const apiBaseUrl = String(manifest?.apiBaseUrl ?? "").replace(/\/+$/, "");
if (!apiBaseUrl) throw new Error("manifest has no apiBaseUrl");

const sitemapResponse = await fetch(`${siteUrl}/sitemap.xml`, { headers: { "User-Agent": UA } });
if (!sitemapResponse.ok) throw new Error(`sitemap HTTP ${sitemapResponse.status}`);
const sitemap = await sitemapResponse.text();
const slugs = [
  ...new Set(
    [...sitemap.matchAll(/<loc>(https:\/\/[^<]+)<\/loc>/g)]
      .map((match) => new URL(match[1]).pathname.split("/").filter(Boolean))
      .filter((segments) => segments.length === 1 && segments[0] !== "en" && /^[a-z0-9-]+$/.test(segments[0]))
      .map(([slug]) => slug),
  ),
].sort();

const entries = [];
const skipped = [];
const queue = [...slugs];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let slug = queue.shift(); slug; slug = queue.shift()) {
      try {
        const { data } = await getJson(`${apiBaseUrl}/lessons/${encodeURIComponent(slug)}`, `lesson ${slug}`);
        entries.push({
          id: data.id,
          term: data.title,
          en: data.secondaryTitle ?? null,
          aliases: data.aliases ?? [],
          cat: data.macroCategory && data.category ? `${data.macroCategory} · ${data.category}` : (data.macroCategory ?? data.category ?? null),
          url: data.url ?? `${siteUrl}/${data.path ?? slug}`,
        });
      } catch (error) {
        skipped.push(slug);
        console.error(`skip ${slug}: ${error.message}`);
      }
    }
  }),
);

const inventoryPath = path.join(ROOT, "data", "inventory.json");
let previousCount = 0;
try {
  previousCount = JSON.parse(readFileSync(inventoryPath, "utf8"))?.count ?? 0;
} catch {
  // First fetch on a fresh clone; there is no previous snapshot to protect.
}
if (entries.length === 0 || (previousCount > 0 && entries.length < previousCount / 2)) {
  throw new Error(`fetched ${entries.length} entries (previous ${previousCount}); refusing to overwrite inventory.json`);
}

entries.sort((a, b) => (a.cat ?? "").localeCompare(b.cat ?? "", "zh") || a.id.localeCompare(b.id));
mkdirSync(path.dirname(inventoryPath), { recursive: true });
writeFileSync(
  inventoryPath,
  `${JSON.stringify({ site: siteUrl, revision: manifest.revision, fetchedAt: new Date().toISOString().slice(0, 10), count: entries.length, skipped, entries }, null, 2)}\n`,
);
console.log(`inventory: ${entries.length} entries, ${skipped.length} skipped, revision ${manifest.revision}`);
