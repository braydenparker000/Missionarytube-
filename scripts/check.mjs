import { access, readFile } from "node:fs/promises";

const failures = [];
const requiredFiles = [
  "index.html",
  "assets/css/app.css",
  "assets/js/app.js",
  "AGENTS.md",
  "CLAUDE.md",
  "docs/WORKFLOW.md",
  "docs/AI-COLLABORATION.md",
  "docs/EVALUATION.md",
  "docs/AZURE-DEPLOYMENT.md",
  "evals/results/scoreboard.json"
];

for (const path of requiredFiles) {
  try {
    await access(path);
  } catch {
    failures.push(`Missing required file: ${path}`);
  }
}

const html = await readFile("index.html", "utf8");
const checks = [
  [/<!doctype html>/i, "index.html must declare an HTML doctype"],
  [/<html[^>]*lang=/i, "index.html must declare a document language"],
  [/<meta[^>]*name=["']viewport["']/i, "index.html must include a viewport meta tag"],
  [/<title>[^<]+<\/title>/i, "index.html must include a non-empty title"],
  [/<main(?:\s|>)/i, "index.html must include a main landmark"]
];

for (const [pattern, message] of checks) {
  if (!pattern.test(html)) failures.push(message);
}

for (const asset of html.matchAll(/(?:src|href)=["'](assets\/[^"'?#]+)/g)) {
  try {
    await access(asset[1]);
  } catch {
    failures.push(`Referenced asset does not exist: ${asset[1]}`);
  }
}

const scoreboard = JSON.parse(await readFile("evals/results/scoreboard.json", "utf8"));
if (scoreboard.schemaVersion !== 1 || !Array.isArray(scoreboard.results)) {
  failures.push("evals/results/scoreboard.json must use schemaVersion 1 and contain a results array");
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Validation passed (${requiredFiles.length} required files, ${checks.length} HTML checks).`);
