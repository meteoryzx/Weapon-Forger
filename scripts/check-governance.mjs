import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function fail(message) {
  process.stderr.write(`Governance check failed: ${message}\n`);
  process.exitCode = 1;
}

const tracked = git("ls-files").split(/\r?\n/u).filter(Boolean);
const instructionNames = new Set([
  "agents.md",
  "claude.md",
  "codex.md",
  ".cursorrules",
  "copilot-instructions.md",
]);
const instructionFiles = tracked.filter((path) => instructionNames.has(path.split("/").at(-1)?.toLowerCase()));

if (instructionFiles.length !== 1 || instructionFiles[0] !== "AGENTS.md") {
  fail(`the only tracked AI instruction file must be root AGENTS.md; found: ${instructionFiles.join(", ") || "none"}`);
}

const plan = readFileSync("PROJECT_PLAN.md", "utf8");
const checkpointHeadings = plan.match(/^## 0\. 唯一当前检查点$/gmu) ?? [];
if (checkpointHeadings.length !== 1) {
  fail("PROJECT_PLAN.md must contain exactly one '## 0. 唯一当前检查点' heading");
}

const agents = readFileSync("AGENTS.md", "utf8");
for (const heading of ["## 1. 开发流程", "## 2. 当前工程原则", "## 3. 核心边界", "## 4. Git 与协作"]) {
  if (!agents.includes(heading)) fail(`AGENTS.md is missing ${heading}`);
}

if (!process.exitCode) {
  process.stdout.write("Governance check passed: one instruction file, one current checkpoint, development contract present.\n");
}
