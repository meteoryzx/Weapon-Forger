# 文档地图

这是技术文档入口。接手项目时，先读根目录 `AGENTS.md` 和 `PROJECT_PLAN.md`；本目录只补充产品和代码事实，不覆盖它们。

| 文档 | 用途 |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 模块职责、数据流和可迁移边界 |
| [`FORGE_CORE_API.md`](FORGE_CORE_API.md) | 公共 API、事实出口和版本语义 |
| [`FORGE_SYSTEM_SPEC.md`](FORGE_SYSTEM_SPEC.md) | R1 八类操作及其当前覆盖边界 |
| [`FORGE_UNIFIED_PHYSICS.md`](FORGE_UNIFIED_PHYSICS.md) | 统一物理模型的研究基线和降阶假设 |
| [`HEATING_HANDOFF.md`](HEATING_HANDOFF.md) | 已验收加热工位实现、尺度边界与作者体验清单 |
| [`HAMMERING_HANDOFF.md`](HAMMERING_HANDOFF.md) | 当前锤击共识、旧代码差距、参考图与下一实现边界 |
| [`OPENCODE_HANDOFF.md`](OPENCODE_HANDOFF.md) | OpenCode 接手顺序、已合并代码进度与当前停点 |

文档中的“研究基线”“后续”“候选”表示设计假设，不表示当前代码已经完成。代码事实以 `src/`、`tests/`、当前计划和自动检查结果为准。
