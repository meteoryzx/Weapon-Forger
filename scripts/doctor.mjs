import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];
const notes = [];
const requireCocos = process.argv.includes("--require-cocos");
const requireLfs = process.argv.includes("--require-lfs");

function check(condition, message) {
  if (condition) notes.push(`OK  ${message}`);
  else failures.push(`ERR ${message}`);
}

function json(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function walk(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? [child, ...walk(child)] : [child];
  });
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
check(nodeMajor === 24, `Node 24（当前 ${process.versions.node}）`);

const pkg = json("package.json");
check(pkg.creator?.version === "3.8.8", "Cocos 项目版本锁定为 3.8.8");
check(existsSync(join(root, "package-lock.json")), "存在 npm 锁文件");
check(existsSync(join(root, "settings/v2/packages/project.json")), "存在 Cocos 项目设置");

const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n");
const forbidden = ["library/", "temp/", "local/", "profiles/", "build/", "node_modules/"];
check(!tracked.some((path) => forbidden.some((prefix) => path.startsWith(prefix))), "生成目录未被 Git 跟踪");

const assetEntries = walk(join(root, "assets"));
const missingMetas = assetEntries
  .filter((path) => !path.endsWith(".meta"))
  .filter((path) => !existsSync(`${path}.meta`))
  .map((path) => relative(root, path));
check(missingMetas.length === 0, missingMetas.length ? `资源缺少 .meta：${missingMetas.join(", ")}` : "所有现有资源均有 .meta");

const runtimeScripts = assetEntries.filter((path) => /\.(?:[cm]?js|ts)$/.test(path));
const nodeImports = runtimeScripts.filter((path) => /(?:from\s+|import\s*\()["']node:/.test(readFileSync(path, "utf8")));
check(nodeImports.length === 0, nodeImports.length ? `游戏资源引用 Node 内置模块：${nodeImports.map((path) => relative(root, path)).join(", ")}` : "游戏资源未引用 Node 内置模块");

const cocosCandidates = [
  process.env.COCOS_CREATOR,
  "/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator",
  process.env.PROGRAMDATA && join(process.env.PROGRAMDATA, "cocos/editors/Creator/3.8.8/CocosCreator.exe"),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs/CocosCreator/Creator/3.8.8/CocosCreator.exe"),
  process.env.ProgramFiles && join(process.env.ProgramFiles, "Cocos/Creator/3.8.8/CocosCreator.exe"),
].filter(Boolean);
const cocos = cocosCandidates.find((path) => existsSync(path));
if (requireCocos) check(Boolean(cocos), "找到 Cocos Creator 3.8.8 命令行程序");
else notes.push(cocos ? `OK  找到 Cocos Creator：${cocos}` : "INFO 未找到 Cocos；CI 允许，本地构建前需安装或设置 COCOS_CREATOR");

let lfsVersion = "";
try {
  lfsVersion = execFileSync("git", ["lfs", "version"], { cwd: root, encoding: "utf8" }).trim();
} catch {}
if (requireLfs) check(Boolean(lfsVersion), "找到 Git LFS");
else notes.push(lfsVersion ? `OK  ${lfsVersion}` : "INFO 未找到 Git LFS；CI 允许，设备交接前必须安装");

console.log(notes.join("\n"));
if (failures.length) {
  console.error(`\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("\nDoctor 通过。");
}
