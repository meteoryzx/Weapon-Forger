# 锻造统一过程模型（讨论基线）

本文是当前实现与后续锻造核心的物理与数据设计基线。八个动词不得各自维护一套互不相干的“加减数值”规则；每个动词都应转换成对同一份状态施加的过程载荷。

## 1. 统一状态

每个工件由以下字段组成。字段属于 `forge` 的原始事实，不属于某个游戏的攻击力、六维或故事结果。

```text
geometry       节点位置、单元体积、拓扑、质量分布
thermal        节点/单元温度、热流、氧化剂量、热历史
mechanical     速度、应力、弹性应变、塑性应变、应变率、残余应力
microstructure 晶粒/再结晶比例、相状态、材料流线
integrity      孔隙、裂纹、局部损伤、连接界面完整性
surface        氧化皮、粗糙度、磨痕、去除量、表面残余应力
composition    材料成分、层片、夹杂物、魔法/特殊成分
process        当前工具接触、支撑、夹持、润滑/助焊剂、历史
```

魔法扩展应作为 `composition` 或独立的可序列化场效应加入，例如“火属性场影响热源边界”。它可以改变材料参数或边界条件，但不能偷偷绕过体积、质量、热量和拓扑约束。

## 2. 共同方程骨架

### 2.1 热场

```text
rho * cp(T) * dT/dt
  = div(k(T) * grad(T))
  + q_plastic
  + q_friction
  + q_external
  - h * A * (T - T_air)
  - emissivity * sigma * A * (T^4 - T_surroundings^4)
```

首版可以把温度场降级为单元温度，后续再增加节点温差，但热量来源必须仍然走这条接口。锤击、切割、研磨产生的机械功只有一部分转化为热；炉子、空气、淬火介质是边界条件，不应直接给温度 `+X`。

### 2.2 接触与运动

所有工具都先生成接触集合和边界条件：

```text
contact pressure = f(tool geometry, workpiece geometry, relative motion)
friction force   = mu(T, lubricant, oxide, pressure) * normal force
heat from friction = friction force * sliding speed * efficiency
```

接触压力决定材料是否超过屈服面；摩擦决定材料是否随工具拖动，以及多少能量转为热。工具的锤面、刀口、磨轮和焊合压力装置都复用这个机制，只改变接触几何与运动方式。

### 2.3 弹塑性与材料流动

使用有限但统一的弹塑性近似，而不是每个动词写一个形变公式：

```text
sigma = elastic_response(total_strain - plastic_strain, T)
yield_surface = yield_strength(T, strain_rate, hardening, microstructure)
if equivalent_stress <= yield_surface:
    elastic deformation only
else:
    plastic flow along the stress direction
```

塑性流动近似不可压缩：

```text
det(F_plastic) ~= 1
mass ~= constant unless material is cut, removed, or added
```

所以：

- drawing out 主要让长度增加、截面减少；
- upsetting 主要让长度减少、截面增加；
- 弯曲改变节点位置和应变分布，不凭空制造材料；
- 切割才改变拓扑或移除质量；
- 研磨移除表层质量；
- 焊合把两个接触界面转为连接界面。

### 2.4 损伤与裂纹

损伤不是“每次操作固定增加”。建议用增量形式：

```text
dD = damage_rate(
  plastic_strain_increment,
  stress_triaxiality,
  strain_rate,
  temperature,
  local_thickness,
  support_state,
  existing_voids
) * dt
```

锻造中的关键判断应是：

- 高温、受支撑、均匀压缩：塑性应变增加，`dD` 很小；
- 低温或材料已硬化：屈服强度升高，同样能量更容易转为残余应力和损伤；
- 局部过薄、悬空、单侧集中锤击：应力三轴度和局部化升高，裂纹风险增加；
- 热梯度很大时：冷却应变产生残余应力，淬火可造成表面与内部不同步收缩。

游戏实现可以使用经过校准的简化损伤模型，但输入必须来自这些状态变量，不能使用“操作次数”作为主变量。

## 3. 八个动词如何共用体系

| 动词 | 统一系统中的作用 | 主要变化 |
| --- | --- | --- |
| 选料 | 创建/组合材料与成分场 | 质量、密度、碳含量、夹杂、层片、魔法成分 |
| 切割 | 建立分离面并移除或分离拓扑 | 断面几何、切口宽度、切割热、毛刺、残余应力 |
| 焊合 | 让接触界面在热、压力和清洁条件下连接 | 接触面积、氧化物、扩散程度、界面完整性 |
| 加热 | 修改热边界和热历史 | 温度场、塑性、氧化、相状态、热应力 |
| 锤击 | 施加局部瞬态压缩接触 | 节点运动、塑性流动、应变率、摩擦热、残余应力 |
| 淬火 | 施加强冷却边界并触发相变近似 | 冷却曲线、相状态、硬化、脆性、残余应力 |
| 回火 | 再次加热并释放部分热处理应力 | 相稳定性、硬度/韧性取舍、残余应力下降 |
| 研磨 | 施加移动磨粒的表面去除载荷 | 去除质量、刃口几何、粗糙度、磨削热、表面应力 |

这张表描述的是“载荷类型”，不是八套独立的结果分数。下游游戏只读取最终事实，例如几何、质量分布、硬化状态、连接完整性和表面状态，再自行选择攻击力、破甲或故事条件的解释方式。

## 4. 各工序的真实约束

### 切割

切割不能表现为“点击后把长度乘一个系数”。可用剪切平面近似：

```text
cut_force ~= shear_strength(T, material) * cut_area / cutting_efficiency
cut_work  ~= cut_force * cut_distance
```

切口方向、刀具角度、送料速度和工件支撑影响切口偏斜、毛刺、热量和断面质量。金属切削的剪切面、前角、切深和切削力关系可参考 MIT 的切削分析课程资料。[MIT Metal Cutting](https://ocw.mit.edu/courses/2-008-design-and-manufacturing-ii-spring-2025/mit2_008_s25_lec05.pdf)

### 焊合

焊合不是把 `integrity` 直接设为 1。它应当由：

```text
joint_integrity = f(contact_area, temperature_time, pressure_work,
                    surface_cleanliness, oxide, flux, void_ratio)
```

锻焊是固态连接，需要达到适合的焊接温度，并通过压力和塑性变形让界面贴合、排出污染物。[ASM Forge Welding](https://dl.asminternational.org/handbooks/edited-volume/28/chapter-abstract/385759/Forge-and-Coextrusion-Welding)

### 淬火与回火

淬火的核心不是一次性写入硬度，而是记录冷却曲线和材料相变窗口。表面和内部冷却速度不同，会产生热梯度和残余应力；这也是淬火裂纹与变形的来源之一。[ASM Residual Stress Modeling](https://dl.asminternational.org/handbooks/edited-volume/217/chapter/4153021/Residual-Stress-Modeling-Strategies-for-Mitigation)

回火应作为热循环和应力释放过程，不能只是“温度越高，硬度减去一点”。硬度、韧性、残余应力和相状态之间应由同一段热历史派生。

### 研磨

研磨同时是材料去除和热过程：

```text
removed_volume ~= abrasive_contact * removal_rate * time
grinding_heat ~= grinding_power * heat_partition
surface_damage ~= f(surface_temperature, force, residual_stress, wheel_state)
```

磨削速度、法向力、砂轮、冷却和接触面积会共同影响材料去除、表面粗糙度和热损伤。[ASM Principles of Grinding](https://dl.asminternational.org/handbooks/edited-volume/33/chapter-abstract/441230/Principles-of-Grinding)

## 5. 当前落地状态

`physics-4` 保留第一轮共同机械响应，并新增连续姿态表面锤击。材料响应位于 `src/forge/forge-physics.ts`，新几何流动位于 `src/forge/hammer-surface.ts`：

- 新锤击使用三维节点点阵与有限砧面支撑，先局部压缩，再用互逆侧向积分扩展；总几何体积数值校正只调侧向位移，不改质量。旧锤击的 XPBD 求解保留兼容。
- 材料层使用温度软化后的屈服强度，并以累积塑性应变计算应变硬化。
- 新形变从单元实际变形梯度的主伸长计算对数应变，再分配为弹性和塑性应变；刚性转动本身不产生应变。材料软化、应变硬化和实际支撑决定压缩量。
- 残余应力使用指数累积；损伤使用局部化、薄截面、支撑、温度塑性和热损伤共同驱动的指数演化。
- 机械功由屈服应力、弹塑应变和单元体积计算，记录在原始状态中，不能作为命中次数的替代计数器。

新锤击每锤最大压缩系数 0.11，力度 0.1–1；有效系数还受屈服强度与支撑缩减。方锤宽 32 mm，平滑权重为 `(1-t²)²`（范围外为零）。两次压缩/侧向积分构成近似不可压缩流动，总体积误差超过 0.002% 或任一控制四面体倒置会拒绝该锤。单元局部体积未做逐格严格约束，支撑距离法和薄截面风险也只是可解释近似。新操作取消旧冷接触固定增量，损伤由实际应变驱动；温度按作者要求冻结，不将机械功再转换成升温。具体常数以 `HAMMER_RULES` 与 `FORGE_RULES` 为准。

当前锤击使用最完整的共享机械响应；切割、焊合、淬火、回火和研磨已经接入共享状态并记录各自的降阶过程事实，后续再逐步提高接触、热和界面模型的精度。

## 6. 当前限制

1. 工作站近景以第一人称操作为目标；仓库选择和未来的工坊导航可以使用俯视或 2.5D。
2. 玩家不直接读取公式。画面负责表现热色、形变、材料去除和其他后果；开发与测试读取可保存的原始状态。
3. 当前是可校准的降阶模型，不是有限元、真实晶粒或完整化学扩散模拟。
4. 锤击的机械响应最完整；局部温差、切割接触、焊接扩散、热处理相变和研磨表面重网格仍是未来可提高的精度，不属于当前 R1 承诺。
5. 自动测试只能证明契约、因果方向和固定样本稳定，不能证明真实感或操作体验已经通过。

具体开发顺序只以根目录 `PROJECT_PLAN.md` 的唯一当前检查点为准。
