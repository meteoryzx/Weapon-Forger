import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const rootDirectory = dirname(fileURLToPath(import.meta.url));

function copyWechatProjectFiles(): Plugin {
  return {
    name: "copy-wechat-project-files",
    closeBundle() {
      const outputDirectory = resolve(rootDirectory, "dist/wxgame");
      mkdirSync(outputDirectory, { recursive: true });
      cpSync(resolve(rootDirectory, "wechat/game.json"), resolve(outputDirectory, "game.json"));
      cpSync(resolve(rootDirectory, "wechat/project.config.json"), resolve(outputDirectory, "project.config.json"));
    },
  };
}

export default defineConfig({
  plugins: [copyWechatProjectFiles()],
  publicDir: false,
  build: {
    outDir: "dist/wxgame",
    emptyOutDir: true,
    target: "es2020",
    minify: "esbuild",
    lib: {
      entry: resolve(rootDirectory, "src/entry/wechat.ts"),
      formats: ["iife"],
      name: "WeaponForger",
      fileName: () => "game.js",
    },
  },
});
