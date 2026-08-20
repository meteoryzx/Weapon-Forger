# Weapon Forger / 打了个铁

一款以自由锻造和可解释故事后果为核心的 2.5D 系统策划作品集。项目使用 TypeScript、Three.js 和 Vite，同一套游戏逻辑与程序化场景同时服务浏览器 H5 和微信小游戏。

## 当前状态

- 当前分支：`feat/R1i-furnace-heating`，HEAD `c2cad52`，属于未完成的 WIP，不是已验收版本。
- 当前已验证：锻造核心的确定性状态、局部锤击形变、转面、送料、基础加热、可扩展派生接口和第一人称热锻工作站原型。
- 当前未验收：第一人称工作站的作者体验、八个工艺的独立可玩操作、完整 R1 工艺链和统一物理模型。
- 当前工作重点：先建立统一的热-力-几何-界面状态，再以第一人称工作站验证锤击、切割、焊合、加热、淬火、回火和研磨。
- 六维评估、冒险故事和动作游戏属性属于下游 profile，不属于 forge 核心；它们尚未在当前仓库实现。

项目决策与实时交接以 [`PROJECT_PLAN.md`](PROJECT_PLAN.md) 为准；AI 和工程协作规则以 [`AGENTS.md`](AGENTS.md) 为准；代码边界见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

新接手者阅读顺序：`AGENTS.md` -> `PROJECT_PLAN.md` -> `docs/ARCHITECTURE.md` -> `docs/FORGE_CORE_API.md` -> `docs/FORGE_UNIFIED_PHYSICS.md` -> Git 状态和历史。

## 本地运行

需要 Node.js 24。

```powershell
npm ci
npx playwright install chromium
npm run check
npm run dev -- --host 127.0.0.1 --port 4177
```

浏览器入口为 `http://127.0.0.1:4177`。微信产物由 `npm run build:wechat` 生成到 `dist/wxgame`，登录、导入、扫码和真机验收由作者完成。

## 仓库结构

```text
src/
  app/       组装依赖与控制流程
  entry/     浏览器和微信运行入口
  platform/  输入与平台能力适配
  forge/     可迁移的确定性锻造状态、操作、回放与派生接口
  render/    Three.js 程序化场景与状态可视化
tests/       按源码边界组织的逻辑、平台和端到端测试
scripts/     可重复的开发与验证脚本
wechat/      微信小游戏宿主配置
.github/     CI、PR 和 Issue 协作模板
```

`dist/`、`node_modules/`、`test-results/` 和 Playwright 报告均为本地产物，不进入 Git。旧 Cocos 路线仅保留在 Git 历史中，不是现行工程的一部分。

## 协作与交付

- 新工作从短期功能分支开始，不直接修改 `main`。
- 提交前必须说明范围、验证命令和未验证边界；提交信息使用 `[阶段/模块] 可读动作`。
- 业务代码、公共接口、依赖、目录所有权和许可证变更必须在计划或 PR 中明确说明。
- `npm run check`、作者体验验收和完整差异检查都通过后，才可合并到 `main`。
- 当前仓库没有 `LICENSE`；许可证和公开范围不是默认决定，需由作者单独确认。
