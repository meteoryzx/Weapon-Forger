import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const candidates = [
  process.env.COCOS_CREATOR,
  "/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator",
  "C:\\Program Files\\Cocos\\Creator\\3.8.8\\CocosCreator.exe",
].filter(Boolean);
const executable = candidates.find((path) => existsSync(path));

if (!executable) {
  console.error("未找到 Cocos Creator 3.8.8。请安装或设置 COCOS_CREATOR。 ");
  process.exit(1);
}

const buildOptions = "platform=web-desktop;debug=true;buildPath=project://build;outputName=web-desktop";
const result = spawnSync(executable, ["--project", root, "--build", buildOptions], { stdio: "inherit" });

// Cocos Creator 官方约定：36 表示构建成功。
if (result.status !== 36) {
  console.error(`Cocos Web Desktop 构建失败，退出码：${result.status ?? "unknown"}`);
  process.exit(result.status ?? 1);
}
console.log("Cocos Web Desktop 构建成功：build/web-desktop");
