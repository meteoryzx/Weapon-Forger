# 锻造核心 API

`src/forge/index.ts` 是可迁移锻造核心的公共入口。它只依赖锻造类型、规则、模拟、物理、保存和事实导出，不依赖应用层、渲染层、浏览器、微信或任何具体游戏属性。

## 核心对象

- `ForgeState`：完整可保存的原始状态和操作历史。
- `ForgeIntent`：平台无关的玩家意图。
- `ForgeOperation`：经过合法性校验、可回放的操作记录。
- `ForgeSnapshot`：供渲染和验收 HUD 读取的只读投影。
- `ForgeFacts`：供未来宿主公式读取的原始锻造事实。

## 基本调用

```ts
const initial = createForgeState();
const next = applyForgeIntent(initial, intent);
const saved = serializeForgeState(next);
const restored = deserializeForgeState(saved);
const snapshot = createForgeSnapshot(restored);
const facts = createForgeFacts(restored);
```

`replayForgeState(initialState, operations)` 是确定性回放入口。相同初始状态和相同操作序列必须产生相同结果。

## 加热时间与移动

`move-billet` 的 `elapsedMs` 表示工件在**移动前的位置**停留的时间；先按该环境积分热状态，再切换到 `destination`。进入或退出炉口可传 `elapsedMs: 0`，不凭移动直接增加或清除温度。

当前也接受 `destination` 与当前位置相同且 `elapsedMs > 0`：表示继续留在炉内加热，或留在炉外空气中冷却。相同位置加零时间仍拒绝。这是已有操作的合法输入扩展，不新增存档字段；操作序列仍可确定性回放。

核心不读取墙上时钟。浏览器简化加热工位仅在该工位前台有焦点时提交经过时间；离开工位会取出工件并保留热状态，切回后不补算后台时间。其他工位和其他工件不参与全局自动冷却。

## 事实出口

`ForgeFacts` 只提供材料、几何、质量分布、温度、热历史、力学状态、损伤、焊合界面和研磨去料等事实。它不提供固定六维、攻击力、破甲值、故事结论或魔法评分。

不同宿主可以从同一份事实计算不同结果，例如动作游戏的破甲、冒险游戏的六维或奇幻游戏的魔法承载。每种消费方式都必须在自己的模块中拥有公式、版本和测试。

## 版本与拒绝策略

- `stateVersion` 标记存档结构和字段含义。
- `parameterVersion` 标记规则参数和公式版本。
- 当前反序列化器只接受当前状态版本；不认识的版本明确拒绝，不猜测兼容。
- 改变状态契约或规则参数时，必须补固定样本和对应测试。
