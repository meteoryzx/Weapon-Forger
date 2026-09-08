# 锻造系统架构

本文只说明代码职责和数据边界。项目当前阶段、验收顺序和协作规则分别见根目录 `PROJECT_PLAN.md` 与 `AGENTS.md`。

## 数据流

```text
浏览器 / 微信输入
        -> ForgeIntent
        -> 规则校验与 ForgeOperation
        -> ForgeState
             |-> ForgeSnapshot -> Three.js 表现
             `-> ForgeFacts    -> 未来的宿主消费公式
```

`ForgeState` 是唯一可写事实源。`ForgeSnapshot` 是给画面看的只读投影；`ForgeFacts` 是给其他游戏或模块读取的原始事实。渲染和下游模块都不能反向修改状态。

## 目录职责

- `src/forge`：可迁移的确定性锻造核心，负责材料、几何、热、力学、损伤、表面、界面、规则、操作合法性、保存和回放。
- `src/app`：组装平台输入和锻造核心，不存放锻造公式。
- `src/entry`、`src/platform`：把浏览器或微信输入转换成平台无关的 `ForgeIntent`。
- `src/render`：读取 `ForgeSnapshot`，负责工作站场景和状态表现。
- `tests`：按源码边界组织的逻辑、平台和端到端测试。
- `docs`：技术说明、公共契约和研究基线，不覆盖根目录协作规则。

`src/forge` 不依赖 Three.js、DOM、微信 API、故事文本或宿主游戏的属性名称。未来动作游戏的攻击力、冒险游戏的六维、魔法游戏的符文承载都属于宿主自己的消费公式，不进入锻造核心。

## 八类操作的共同模型

八类操作作用于同一份工件状态：

```text
选料 -> composition
切割 -> separation
焊合 -> interface
加热 -> thermal boundary
锤击 -> local contact and plastic flow
淬火 -> cooling boundary
回火 -> thermal history
研磨 -> material removal and surface state
```

当前模型是可解释的降阶模拟，不是工业有限元或完整冶金仿真。锤击已经使用点阵、支撑、温度软化、弹塑响应、应力、损伤和体积约束；其他操作记录各自的原始过程事实，并沿共同状态继续演进。新增规则不能退化为独立的固定加减分。

## 可迁移边界

公共入口由 `src/forge/index.ts` 导出。宿主可以创建状态、提交意图、保存、加载和回放操作，并读取快照和事实：

```ts
const state = createForgeState();
const next = applyForgeIntent(state, intent);
const facts = createForgeFacts(next);
```

核心不内置六维、故事、攻击、破甲、总评分或某种魔法结论。每个宿主应拥有自己的公式、版本和测试。

## 版本边界

- `stateVersion` 表示存档结构和字段语义。
- `parameterVersion` 表示产生状态结果的规则和公式版本。
- 改变公共状态形状要增加迁移决定或明确拒绝旧版本。
- 改变规则参数要更新固定样本和参数版本。
- 下游消费公式变化不应修改锻造状态版本。
