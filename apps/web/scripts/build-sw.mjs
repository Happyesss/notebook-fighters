// After `next build`: write out/sw.js, the service worker that precaches the whole static export
// (pages, scripts, styles, RSC payloads, sounds, icons) so the game works offline after one visit.
// The cache version is a hash of every file, so any change in the build installs a fresh cache.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const out = join(here, "..", "out");
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(out);

const hash = createHash("sha256");
const urls = [];
const pages = [];
for (const p of files) {
  const rel = relative(out, p).split(sep).join("/");
  if (rel === "sw.js" || rel.endsWith(".map") || rel.startsWith("_not-found") || rel.endsWith("CREDITS.md")) continue;
  hash.update(rel).update(readFileSync(p));
  // pages are served without ".html" (Workers Static Assets html_handling: auto-trailing-slash)
  if (rel.endsWith(".html") && !rel.includes("/")) {
    const page = rel === "index.html" ? "/" : `/${rel.slice(0, -5)}`;
    urls.push(page);
    pages.push(page);
  } else urls.push(`/${rel}`);
}
const version = `${Date.now().toString(36)}-${hash.digest("hex").slice(0, 10)}`;
const src = readFileSync(join(here, "sw-template.js"), "utf8")
  .replace("__VERSION__", version)
  .replace("__PRECACHE__", JSON.stringify(urls))
  .replace("__PAGES__", JSON.stringify(pages))
  .replace("__OPTIONAL__", JSON.stringify(["/404"]));
writeFileSync(join(out, "sw.js"), src);
console.log(`sw.js: ${urls.length} files precached (${pages.join(" ")}), version ${version}`);
