# 文档地图

这是项目文档的入口。简历评审、合作接手或新 AI 接手时，按以下顺序阅读即可。

## 推荐阅读顺序

1. 根目录 [`README.md`](../README.md)：项目是什么、当前做到什么、如何运行。
2. [`PROJECT_PLAN.md`](../PROJECT_PLAN.md)：当前阶段、范围边界、验收清单和下一步。
3. [`ARCHITECTURE.md`](ARCHITECTURE.md)：代码模块、数据流和目录所有权。
4. [`FORGE_CORE_API.md`](FORGE_CORE_API.md)：锻造核心如何被宿主调用和回放。
5. [`FORGE_SYSTEM_SPEC.md`](FORGE_SYSTEM_SPEC.md)：八个操作动词的产品规格；标注为草案的内容不等于已实现。
6. [`FORGE_UNIFIED_PHYSICS.md`](FORGE_UNIFIED_PHYSICS.md)：统一物理模型的研究基线、假设和后续方向。

## 文档职责

| 文档 | 用途 | 当前性质 |
| --- | --- | --- |
| `README.md` | 对外项目入口和快速运行 | 当前事实摘要 |
| `PROJECT_PLAN.md` | 阶段计划、范围、协作交接、作者验收 | 当前执行依据 |
| `ARCHITECTURE.md` | 模块边界和数据流 | 架构约束 |
| `FORGE_CORE_API.md` | `ForgeState`、`ForgeIntent`、`ForgeSnapshot` 等公共契约 | API 约束 |
| `FORGE_SYSTEM_SPEC.md` | 八动词、状态和未来下游设计 | 产品规格草案 |
| `FORGE_UNIFIED_PHYSICS.md` | 热、力、几何、界面和材料响应模型 | 研究/设计基线 |
| `AGENTS.md` | AI 协作纪律和审查制度 | 仓库工作规范 |
| `CONTRIBUTING.md` | 开发、PR 和验收提交格式 | 贡献指南 |

## 状态判读规则

文档中出现“设计基线”“规格草案”“R2/R3”时，表示设计目标或后续阶段，不表示当前代码已经存在对应模块。当前代码事实以 `src/`、`tests/`、最近通过的 `npm run check` 和 `PROJECT_PLAN.md` 的现状摘要为准。

临时排查截图、Playwright 报告、构建目录和本地依赖不进入文档；Git 提交和 PR 记录阶段历史。
