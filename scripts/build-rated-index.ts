import { promises as fs } from "fs";
import path from "path";

const VAULT_WINE_DIR = "/Users/markfok/Documents/Obsidian Vault/Knowledge/Wine";
const OUTPUT_PATH = path.join(__dirname, "..", "lib", "rated-wines.json");

type RatedWine = {
  filename: string;
  winery: string;
  wine_name: string;
  vintage: number | null;
  region: string | null;
  country: string | null;
  grapes: string[];
  user_rating: number | null;
  rated_at: string | null;
  vivino_url: string | null;
  community_rating: number | null;
  // Normalized fields for fuzzy matching
  norm_full: string;
  norm_winery: string;
  norm_wine: string;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(
      /\b(château|chateau|domaine|estate|winery|bodega|tenuta|azienda|maison|weingut|cantina|cave|clos)\b/gi,
      ""
    )
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFrontmatter(content: string): Record<string, string> {
  const fm: Record<string, string> = {};
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return fm;
  for (const line of match[1].split("\n")) {
    const m = line.match(/^([a-zA-Z_]+):\s*"?([^"]*)"?\s*$/);
    if (m) fm[m[1].trim()] = m[2].trim();
  }
  return fm;
}

function extractTableValue(content: string, field: string): string | null {
  const re = new RegExp(`\\|\\s*${field}\\s*\\|\\s*([^|\\n]+?)\\s*\\|`, "i");
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

function extractRating(content: string): number | null {
  // Format: "**Rating:** ★★★★☆ (3.8/5)" — stars can be filled (★) or empty (☆)
  const m = content.match(/Rating:\*?\*?\s*[★⭐☆\s]+\(([\d.]+)\s*\/\s*5\)/);
  if (m) return parseFloat(m[1]);
  const m2 = content.match(/Rating:\*?\*?\s*([\d.]+)\s*\/\s*5/);
  if (m2) return parseFloat(m2[1]);
  return null;
}

function extractTastedDate(content: string): string | null {
  const m = content.match(/Tasted:\*?\*?\s*(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function extractVintage(filename: string, wineName: string): number | null {
  const fromFile = filename.match(/\b(19|20)\d{2}\b/);
  if (fromFile) return parseInt(fromFile[0]);
  const fromName = wineName.match(/\b(19|20)\d{2}\b/);
  if (fromName) return parseInt(fromName[0]);
  return null;
}

function extractCommunityRating(content: string): number | null {
  const m = content.match(/Community Rating\s*\|\s*([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

function parseFile(filename: string, content: string): RatedWine | null {
  const fm = extractFrontmatter(content);
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const fullTitle = titleMatch ? titleMatch[1].trim() : filename.replace(/\.md$/, "");

  const winery = extractTableValue(content, "Winery") ?? "";
  const grapesStr = extractTableValue(content, "Grapes") ?? "";
  const grapes = grapesStr
    .split(/,/)
    .map((g) => g.trim())
    .filter(Boolean);

  // Wine name = title minus winery prefix, minus vintage year suffix
  let wineName = fullTitle;
  if (winery && fullTitle.toLowerCase().startsWith(winery.toLowerCase())) {
    wineName = fullTitle.slice(winery.length).trim();
  }
  wineName = wineName.replace(/\s*\b(19|20)\d{2}\b\s*$/, "").trim();

  const vintage = extractVintage(filename, fullTitle);
  const userRating = extractRating(content);
  if (userRating == null) return null;

  return {
    filename,
    winery,
    wine_name: wineName,
    vintage,
    region: fm.region || extractTableValue(content, "Region") || null,
    country: fm.country || extractTableValue(content, "Country") || null,
    grapes,
    user_rating: userRating,
    rated_at: extractTastedDate(content),
    vivino_url: fm.vivino_url || null,
    community_rating: extractCommunityRating(content),
    norm_full: normalize(fullTitle),
    norm_winery: normalize(winery),
    norm_wine: normalize(wineName),
  };
}

async function main() {
  const files = await fs.readdir(VAULT_WINE_DIR);
  const mdFiles = files.filter((f) => f.endsWith(".md") && !f.startsWith("."));

  const wines: RatedWine[] = [];
  let skipped = 0;
  for (const file of mdFiles) {
    try {
      const content = await fs.readFile(path.join(VAULT_WINE_DIR, file), "utf-8");
      const parsed = parseFile(file, content);
      if (parsed) wines.push(parsed);
      else skipped++;
    } catch (err) {
      console.warn(`Failed to parse ${file}:`, err);
      skipped++;
    }
  }

  wines.sort((a, b) => (b.user_rating ?? 0) - (a.user_rating ?? 0));

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(wines, null, 2));
  console.log(`Wrote ${wines.length} rated wines to ${OUTPUT_PATH}`);
  console.log(`Skipped ${skipped} files (no rating found)`);
  console.log(`Top 3 by rating: ${wines.slice(0, 3).map((w) => `${w.winery} ${w.wine_name} (${w.user_rating})`).join(" / ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
