# Cocos 与 Node 安装验收

> 当前 macOS 第一次执行；Windows 接手时重复同一套版本和验收。作者只做 GUI 安装与首次打开，代码和仓库整合由 Codex 完成。

## 1. 安装 Node.js 24 LTS

1. 打开 Node.js 官方 `24.16.0 LTS` 发布页。
2. 下载并运行 **macOS 64-bit Installer (.pkg)**。
3. 安装结束后关闭并重新打开终端/Codex，使环境变量刷新。
4. 让 Codex 验证：

```bash
node --version
npm --version
```

验收：Node 输出 `v24.16.0`；npm 能正常输出版本。Windows 后续使用同版本 x64 `.msi`。

## 2. 安装 Cocos Dashboard 与 Creator

1. 打开 Cocos Creator 官方下载页，下载 macOS 版 Cocos Dashboard。
2. 打开 `.dmg`，将 Dashboard 拖入 Applications 并启动。
3. 如 macOS 拦截，右键应用选择“打开”，不要关闭系统安全保护。
4. 登录 Cocos 账号。
5. 进入 **Editor**，下载并安装 **Cocos Creator 3.8.8**；不要选择“最新版本”代替。

验收：Dashboard 的 Editor 列表明确显示 `3.8.8` 已安装，能够启动。

## 3. 创建临时空白项目

1. 在 Dashboard 的 **Projects** 页面选择新建项目。
2. 优先选择 **Empty (2D)**；如果只有 **Empty**，先选 Empty，具体 2D 场景由 Codex 后续配置。
3. 项目名：`WeaponForgerBlank388`。
4. 父目录：`/Users/yzx/Documents/Codex/2026-07-20/start-here-agent-md-progress-md/work`。
5. 确认编辑器版本是 `3.8.8`，选择“创建并打开”。
6. 等待首次资源导入完成；不要把旧仓库文件手工拖进项目。
7. 将空场景保存为 `Blank`，点击编辑器顶部运行/预览，确认没有红色报错。
8. 关闭 Cocos Creator，再让 Codex 检查临时项目并整合到正式仓库。

临时项目只是可靠来源，不进入 Git。Codex 会选择性合并 `package.json`、`assets`、全部 `.meta` 和 `settings`，并排除 `library`、`temp`、`local`、`profiles`、`build`。

## 4. 本轮通过后会发生什么

Codex 将建立锁定依赖、`doctor`、类型检查、单元测试、数据校验、纯逻辑 GitHub Actions，以及 macOS/Windows 共用的 Web Desktop 构建包装。随后作者只需打开正式仓库并点击运行、构建 H5 做行为验收。

## 官方入口

- Node.js 24.16.0 LTS：https://nodejs.org/en/blog/release/v24.16.0
- Cocos Creator 下载：https://www.cocos.com/en/creator-download
- Cocos 安装说明：https://docs.cocos.com/creator/3.8/manual/en/getting-started/install/index.html
