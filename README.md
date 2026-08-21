# Weapon Forger / 打了个铁

一个以“自由锻造”和“可解释的下游消费”为核心的游戏系统作品集项目。

玩家通过选料、加热、锤击、切割、焊合、淬火、回火和研磨改变同一份工件状态；未来不同类型的游戏可以用自己的规则 profile 消费这份原始状态，例如动作游戏的攻击/破甲属性、冒险游戏的六维与故事条件、奇幻游戏的魔法承载能力。

项目使用 TypeScript、Three.js、Vite、Vitest 和 Playwright。锻造核心与运行平台分离，浏览器用于开发和体验验收，微信小游戏是目标运行平台。

## 当前状态

当前分支为 `feat/R1i-furnace-heating`，处于作者体验验收阶段，尚未合并到 `main`。

### 已实现并自动验证

- `src/forge` 中的确定性锻造状态、操作意图、操作记录、回放和快照。
- 基于 `physics-2` 的降阶材料响应：几何节点、热状态、塑性、应力、机械功、损伤和裂纹。
- 八个浏览器锻造工位：选料、切割、焊合、加热、锤击、淬火、回火、研磨。
- 总览到工位近景的相机切换，以及连续点击、按住、拖动和调整输入。
- 可扩展的 `ForgeFacts` / `ForgeDerivationProfile` 派生接口和一组基础现实锻造 profile 公式。
- 42 个逻辑测试、浏览器端到端测试、浏览器构建和微信构建。

### 已实现但仍待作者体验验收

- 浏览器 MVP 的锻造感、镜头距离、模型构图、操作反馈和状态可读性。
- 统一物理模型是否已经达到项目所需的“真实模拟”程度。

### 明确未实现

- 微信端与浏览器等价的八工位玩法。目前微信入口主要验证火炉触摸、热状态和构建链路；微信开发者工具与真机验收由作者完成。
- 正式高清像素美术、最终镜头、动画、音效、火花和蒸汽反馈。
- `src/evaluate` 六维评估模块、`src/story` 冒险故事模块和动作游戏/魔法游戏的具体消费 profile。
- 订单、仓库行走、完整工坊流程、存档、分享和商业化功能。

当前版本不是完整商业游戏，也不宣称是工业级材料仿真；它是一个可运行的锻造核心与浏览器 MVP。

## 快速开始

环境要求：Node.js 24。

```powershell
npm ci
npx playwright install chromium
npm run check
npm run dev -- --host 127.0.0.1 --port 4177
```

浏览器入口：[http://127.0.0.1:4177/](http://127.0.0.1:4177/)

常用命令：

```powershell
npm run typecheck     # TypeScript 类型检查
npm run test          # 逻辑测试
npm run test:e2e      # 浏览器玩家路径测试
npm run build:web     # 浏览器构建
npm run build:wechat  # 微信小游戏构建
npm run check         # 以上检查的完整组合
```

作者体验步骤见 [`PROJECT_PLAN.md`](PROJECT_PLAN.md) 的“作者体验验收清单”。

## 架构概览

```text
平台输入 -> ForgeIntent -> ForgeOperation -> ForgeState
                                           |-> ForgeSnapshot -> render
                                           `-> ForgeFacts -> downstream profile
```

- `src/forge`：可迁移的确定性锻造核心，不依赖 Three.js、DOM 或微信 API。
- `src/app`：组装核心、入口和运行流程。
- `src/entry`：浏览器与微信运行入口。
- `src/platform`：平台输入和平台能力适配。
- `src/render`：只读锻造快照并生成 Three.js 场景。
- `tests`：按代码边界组织的逻辑、平台、渲染和端到端测试。

核心公共入口是 [`src/forge/index.ts`](src/forge/index.ts)。核心状态不保存攻击力、六维或故事文本；这些属于未来宿主定义的下游 profile。

## 文档入口

文档地图和推荐阅读顺序见 [`docs/README.md`](docs/README.md)。

- [`AGENTS.md`](AGENTS.md)：AI 协作、审查、验收和 Git 纪律。
- [`PROJECT_PLAN.md`](PROJECT_PLAN.md)：当前状态、阶段计划、范围边界和作者验收清单。
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)：模块职责、数据流和仓库边界。
- [`docs/FORGE_CORE_API.md`](docs/FORGE_CORE_API.md)：可迁移核心的公共契约与版本规则。
- [`docs/FORGE_SYSTEM_SPEC.md`](docs/FORGE_SYSTEM_SPEC.md)：八个动词与状态的产品规格草案，包含尚未实现的 R2/R3 设计。
- [`docs/FORGE_UNIFIED_PHYSICS.md`](docs/FORGE_UNIFIED_PHYSICS.md)：统一物理模型研究基线，部分内容仍是后续目标。
- [`CONTRIBUTING.md`](CONTRIBUTING.md)：开发、PR 和作者体验验收提交要求。

## 仓库与版本管理

- `main`：只接受自动检查通过并完成作者体验验收的版本。
- `feat/*`：短期开发分支，保存当前阶段的本地提交。
- `docs/`：长期设计、契约和交接文档，不存临时流水账。
- `dist/`、`node_modules/`、`test-results/`：本地产物，不是源码交付物。

本项目当前没有 `LICENSE`。公开范围、许可证和对外授权需要作者单独决定，不由代码仓库默认授予。
