# Weapon Forger / 打了个铁

一款以自由锻造为核心的 TypeScript、Three.js 和 Vite 项目。浏览器用于作者体验和展示，微信入口共享锻造核心；核心本身可作为其他游戏的锻造基础。

## 当前状态

- `main` 是已批准的稳定基线。
- 当前功能分支 `feat/R1-eight-step-acceptance` 正在恢复并等待作者逐项验收八类操作：选料、切割、焊合、加热、锤击、淬火、回火、研磨。
- 八类操作已接入共享状态、操作记录、快照、事实出口和对应自动测试；作者体验尚未替代自动证据，也未宣称 R1 通过。
- 当前计划见 [`PROJECT_PLAN.md`](PROJECT_PLAN.md)；唯一 AI 协作规则见 [`AGENTS.md`](AGENTS.md)。

## 本地运行

需要 Node.js 24。

```powershell
npm ci
npm run check:governance
npm run typecheck
npm run test
npm run build:web
npm run build:wechat
npm run dev -- --host 127.0.0.1 --port 4177
```

当前检查点的自动检查不会打开浏览器或模拟游玩。`npm run test:e2e` 是保留的端到端资产，待作者八项体验完成、另行批准后再运行。

## 仓库结构

```text
src/app/       应用组装
src/entry/     浏览器和微信入口
src/platform/  平台输入适配
src/forge/     确定性锻造状态、操作、规则、保存和事实
src/render/    Three.js 程序化场景和状态表现
tests/         逻辑、平台和端到端测试
scripts/       可重复的检查与样本脚本
docs/          技术说明和研究基线
.github/       CI、PR 和 Issue 模板
```

`dist/`、`node_modules/`、测试报告和其他本地产物不进入 Git。旧实验分支只用于追溯，不能覆盖当前计划和协作规则。
