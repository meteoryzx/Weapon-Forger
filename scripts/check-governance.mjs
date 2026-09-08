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

const branch = process.env.GITHUB_HEAD_REF || git("branch", "--show-current");
const governanceBranch = branch.startsWith("governance/");
const baseRevision = process.env.GOVERNANCE_BASE_SHA || "origin/main";
const governanceFiles = new Set([
  ".github/CODEOWNERS",
  ".github/pull_request_template.md",
  ".github/workflows/ci.yml",
  "AGENTS.md",
  "PROJECT_PLAN.md",
  "README.md",
  "package.json",
  "scripts/check-governance.mjs",
]);

if (governanceBranch) {
  const changedFiles = git("diff", "--name-only", baseRevision).split(/\r?\n/u).filter(Boolean);
  const outOfScope = changedFiles.filter((path) => !governanceFiles.has(path));
  if (outOfScope.length > 0) {
    fail(`governance branch contains non-governance files: ${outOfScope.join(", ")}`);
  }
}

try {
  const baseAgents = git("show", `${baseRevision}:AGENTS.md`);
  const currentAgents = readFileSync("AGENTS.md", "utf8").trim();
  if (!governanceBranch && currentAgents !== baseAgents) {
    fail(`branch '${branch || "detached"}' does not carry the authoritative ${baseRevision}:AGENTS.md`);
  }
} catch (error) {
  if (!governanceBranch) {
    fail(`cannot verify AGENTS.md against ${baseRevision}: ${error.message}`);
  }
}

if (!process.exitCode) {
  process.stdout.write("Governance check passed: one instruction file, one current checkpoint, authoritative rules aligned.\n");
}
