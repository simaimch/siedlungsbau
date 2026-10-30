// Schreibt Version und Download-Links in dist/module.json (wird vom Release-Workflow aufgerufen).
// Aufruf: node scripts/stamp-manifest.mjs <version> <owner/repo>
import { readFileSync, writeFileSync } from "node:fs";

const [version, repo] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "")) throw new Error(`Ungültige Version: ${version}`);
if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) throw new Error(`Ungültiges Repository: ${repo}`);

const file = "dist/module.json";
const manifest = JSON.parse(readFileSync(file, "utf8"));
manifest.version = version;
manifest.url = `https://github.com/${repo}`;
manifest.bugs = `https://github.com/${repo}/issues`;
manifest.manifest = `https://github.com/${repo}/releases/latest/download/module.json`;
manifest.download = `https://github.com/${repo}/releases/download/v${version}/module.zip`;
writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
console.log(`module.json: Version ${version}, ${repo}`);
