import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirs = new Set([".git", "node_modules", "dist", "build", ".vercel"]);
const ignoredFiles = new Set(["package-lock.json"]);
const googleMapsKeyPattern = /AIza[0-9A-Za-z_-]{30,}/g;

/** @type {string[]} */
const findings = [];

function scanDir(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const relPath = relative(root, fullPath);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (!ignoredDirs.has(entry)) scanDir(fullPath);
      continue;
    }

    if (!stat.isFile() || ignoredFiles.has(entry)) continue;

    const text = readFileSync(fullPath, "utf8");
    googleMapsKeyPattern.lastIndex = 0;
    for (const match of text.matchAll(googleMapsKeyPattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      findings.push(`${relPath}:${line}`);
    }
  }
}

scanDir(root);

if (findings.length > 0) {
  console.error("Found Google Maps API keys committed in repository files:");
  for (const finding of findings) console.error(`- ${finding}`);
  console.error("Use empty placeholders in examples and keep real keys in deployment environment variables.");
  process.exit(1);
}

console.log("No committed Google Maps API keys found.");
