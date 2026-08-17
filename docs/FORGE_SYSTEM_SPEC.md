# 锻造系统规格草案：操作动词 × 状态 × 数值

> 状态：草案，待作者审「动词集」。
> 定位：这不是新的事实源，是 `PROJECT_PLAN.md` §4 的展开。它只回答一件事——**提供哪几个操作动词，玩家自由排列后能涌现足够多锻造方案，且数值从状态由公式算出**。
> 范围：自由锻造，形状无关（剑/斧/匕首/罐子/任意块），不预设「刀/剑/斧」造型。

---

## 1. 四类状态（唯一真相源）

玩家操作只改这四类状态；数值只从这四类状态算；形变和数值是**同一份状态**的两种读法。

| 状态 | 字段 | 说明 |
| --- | --- | --- |
| **材料** | `carbon` 0–1、`density`、`hardenability` 0–1、`toughnessBase` 0–1、`layerCount` | 成分 + 层数（大马士革从这里来）。首版整件一份 |
| **几何** | 体积格节点位置 + 派生量（`totalVolume`、`totalLength`、截面宽/厚/重心、`wedge` 楔形程度） | 形状无关，用体积格表示（沿用已验收的网格方向） |
| **热处理** | `temperature`（标量）、`quench{medium,startTemp}`、`temper{temp}` | 温度路径；淬火/回火记录 |
| **完整性与表面** | `damage` 0–1、`stress` 0–1、`cracked`、`surfaceFinish` 0–1、`edgeCoverage` 0–1、`edgeEvenness` 0–1 | 缺陷 + 表面 |

> 注：几何的**粒度/求解器**（体积格多细、变形怎么解）是独立子问题，本规格不拍死；只约定它必须满足「形状无关 + 局部连续变形 + 体积守恒」。

---

## 2. 八个操作动词

每个动词 = 对上面状态的**一次状态转移**。没有「大马士革按钮」，只有能组合的动词。

### 2.1 选料 `selectMaterial(id)`
- **改**：材料（整体替换 `carbon/density/hardenability/toughnessBase`）
- **涌现**：定「能多硬、能多韧」的天花板
- **验证样本**：选高碳钢 → `carbon≈0.9, hardenability≈0.95, toughnessBase≈0.6`；选低碳钢 → `carbon≈0.2, hardenability≈0.55, toughnessBase≈0.95`

### 2.2 切割 `cut(position)`
- **改**：几何（在某个截面把体积一分为二，产生两个独立工件；或切掉一段）
- **涌现**：这是「做罐子/叠层/分段/截短」的共同地基
- **验证样本**：从中间切 → 两个工件，`totalVolume` 各占原一半，和为原体积

### 2.3 焊合 `forgeWeld([workpieces], flux)`（含「装罐」）
- **改**：材料（`carbon` 按各块体积加权平均、`layerCount++`）+ 几何（合并成一块）+ 完整性（焊合质量）
- **公式**：`carbon' = Σ(carbon_i × vol_i) / Σvol_i`；焊合质量 `q = f(温度在焊合窗口, flux使用, 表面清洁)`，`q` 低 → 产生「未焊合/夹杂」缺陷（损伤↑）
- **涌现**：大马士革 = 反复 `切割 + 焊合`；夹钢/包钢 = 焊合不同 `carbon` 的块
- **验证样本**：焊合 A(碳0.2) + B(碳0.9) → `carbon≈0.55`、`layerCount+1`

### 2.4 加热 `heat(duration, env)`
- **改**：热处理 `temperature`
- **公式**：`dT/dt = (T_env − T) / τ`（τ 为时间常数旋钮，压缩真实分钟到游戏秒）；`T > 过热阈值` → 完整性 `damage↑`
- **派生**：`plasticity = clamp((T − 塑性起始) / (塑性峰 − 塑性起始), 0, 1)`
- **验证样本**：入炉 10s → T 从 20 升到 >800；取出 10s → T 下降；过热 → `damage>0`

### 2.5 锤击 `hammer(section, energy, face)`
- **改**：几何（局部形变）+ 完整性（`stress/damage`）
- **公式**：位移量 `= f(energy, plasticity)`；体积守恒（被压体积分给相邻自由方向：拔长/展宽/开刃）；冷锻（`plasticity` 低）→ `stress↑、damage↑`，超阈值 → `cracked`
- **涌现**：弯刀弧度 = 多敲一侧 → 一侧被拉长 → 自然弯；刀尖 = 多敲一头拔长收尖；斧 = 拔长(柄)+展宽(头)
- **验证样本**：热态锤击 → 局部变薄变宽、`totalVolume` 不变；冷态重锤若干次 → `damage` 升、出现 `cracked`

### 2.6 淬火 `quench(medium)`（水/油）
- **改**：热处理 `quench{medium,startTemp}` + 完整性（脆性）
- **公式**：`hardness = hardenability × f(startTemp 在淬火窗口, medium) × 介质折扣`；`brittleness = f(medium 剧烈度, 过热程度)`
- **涌现**：从理想温度水淬 → 硬但脆；从低温淬 → 不硬
- **验证样本**：理想温度水淬 → `hardness` 高、`brittleness` 高；油淬 → `hardness` 略低、`brittleness` 低

### 2.7 回火 `temper(temp)`
- **改**：热处理 `temper{temp}`
- **公式**：回火温度越高 → `hardness↓、toughness↑`（硬↔韧旋钮）
- **涌现**：玩家主动选「偏硬的利器」还是「偏韧的耐用刀」
- **验证样本**：不回火 → 硬而脆；高温回火 → 韧而软

### 2.8 研磨 `grind(section, amount, angle)`
- **改**：几何（刃口变薄）+ 完整性与表面（`edgeCoverage/edgeEvenness/surfaceFinish`）
- **公式**：`sharpness = f(edgeCoverage, 刃口厚度, hardness)`；`angle` 决定「锋利↔耐用」取舍；研磨不均 → `edgeEvenness↓ → 外观↓`
- **验证样本**：均匀研磨 → `edgeCoverage` 高、`edgeEvenness` 高；局部过磨 → `edgeEvenness` 低

---

## 3. 数值：从状态到 `WeaponData`

六维全部由状态公式求出（涌现），无可散落的 `+X`；每维可追溯来源。

| 维度 | 公式来源 |
| --- | --- |
| 锋利 | `f(edgeCoverage, 刃口厚度, hardness)` |
| 硬度 | `f(carbon, quench, temper)` |
| 韧性 | `f(carbon, toughnessBase, damage, cracked, brittleness, layerCount)` |
| 重量 | `f(totalVolume, density)` |
| 平衡 | `f(质量分布/重心)` |
| 外观 | `f(对称性, surfaceFinish, edgeEvenness, layerCount)` |

`WeaponData` = 六维 + `traits/flaws`（结构化、带来源）+ `ruleVersion`（版本化、可序列化、自包含，不依赖 Three.js/文案）。

---

## 4. 验证：固定样本（确定性）

每条样本 = 操作序列 → 状态断言 → 数值断言，同一序列永远同一结果。

1. **普通短剑**：选料→加热→锤击拔长→锤击开刃→研磨→淬火→回火 → 六维合理、无裂纹
2. **大马士革**：选料A+选料B→切割→焊合(装罐)→加热→锤击→（脱罐）→ 层数↑、碳混合、外观↑
3. **失败**：低温重锤×N → `damage` 升 → `cracked` → 韧性↓ → 交付测试会断
4. **弯刀**：单侧多锤 → 重心偏移 → 平衡↓、外观变化

---

## 5. 数据流契约

```
玩家操作(8个动词) → 修改四类状态 → 公式求值 → WeaponData(六维+缺陷+版本) → 下游
```

- 下游（动作游戏算伤害/攻速、冒险故事算分支）是**下一步**，本规格只保证 `WeaponData` 稳定、可追溯、确定性。
- 所有平衡旋钮（τ、阈值、权重）集中在规则表，作者调数值 = 改表，不碰公式。
