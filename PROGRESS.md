# PROGRESS · 打了个铁（当前进度 / 下一步）

> 换电脑/换 AI 接手时，先读这份知道"干到哪了、下一步做什么"。每完成一步就更新本文件并 commit。

## 当前阶段：S1 已完成 ✅，下一步 S3（锻造系统，需 Cocos）

> ⚠️ **施工顺序已调整（2026-07-17）**：原"S2 数值→故事"后置为 S2′（放到锻造之后）。原因：卖点二定为"轻跑团"，强依赖真实武器数值，提前设计=空想。现在的下一步是**S3 锻造系统**。

### S0 项目初始化 ✅（AI 侧完成）
- [x] 目录骨架 + docs 两份文档 + 探路原型归档
- [x] PROJECT_RULES / DECISION_LOG / PROGRESS / .gitignore
- [x] 本地 git 仓库 + 轻量分支流(方案A)规范确立
- [x] 仓库 git 身份已配（dalegetie / 3094919309@qq.com，可改）

### S0 剩余（需作者本人，**S3 需要 Cocos**）⬜
- [ ] 建 GitHub 私有仓库 + push（本地已多次提交，只差远程；换设备接力必需）
- [ ] 装 Cocos Creator，导出 H5 浏览器跑出空白页（Demo 不碰微信开发者工具，见 DECISION_LOG A2b）—— **S3 锻造涉及 2.5D/网格变形，强依赖 Cocos，须先装**

### S1 数据结构 + 测试料 ✅（在 feat/S1-data 分支完成，已合并 main）
- [x] M2 `assets/scripts/weapon/WeaponData.ts`（WeaponData 结构 + 空白坯料工厂，纯数据无逻辑；shape 已含 baseForm/surface）
- [x] M9 数据表：`assets/data/materials.json`（3种材料）、`adventure_nodes.json`（5个冒险节点）、`story_text.json`（14条节点文案+3种结局）
- [x] 测试入口 `assets/scripts/weapon/s1_check.mjs`（node 跑，验证数据结构与表可读）—— **验收通过**
- 说明：数据表内为 S1 占位测试数据，正式内容由作者后续填。

## 下一步：S3 · 锻造系统（产出真武器）🔴 需 Cocos
做 M1(锻造交互) + M3(数值评估)：点/拖/滑操作改材料状态 → 走完一套操作产出带真实 6 维（含三对取舍）的武器。先粗糙、不追手感（手感是 S5）。**本步强依赖 Cocos 引擎**，须先装好 Cocos（大概率在 Codex 那台机器做）。
> 卖点二（数值→轻跑团故事）已后置为 S2′，等 S3 有真武器后再设计——避免脱离真实数值空想。

## 里程碑总览（详见 docs/项目全案 第四部分）
S0 环境 → **S1 数据+测试料✅** → **S3 锻造产出(下一步,需Cocos)** → S4 画面 → S5 手感(难点) → **S2′ 数值→轻跑团故事(有真武器后)** → S6 社交 → S7 内容+美术。
