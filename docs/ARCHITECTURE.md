# 锻造系统架构与仓库边界

## 1. 目标

本项目同时是《打了个铁》的游戏代码、可迁移的锻造核心实验场和 AI 协作记录。当前优先级是先验证统一锻造过程能否形成真实可玩的第一人称操作，再考虑将核心供其他游戏消费。

目标不是工业有限元软件。我们保留真实的因果结构，使用确定性、可校准的降阶模型，并保证结果可见、可回放、可解释。

## 2. 分层

```text
platform / entry
  鼠标、键盘、触摸、时间、画布和微信能力
            |
            v
ForgeIntent -> forge core -> ForgeOperation -> ForgeState
                                      |                 |
                                      |                 +-> ForgeSnapshot -> render
                                      |
                                      +-> ForgeFacts -> downstream profile
```

### `src/forge`

可迁移的确定性核心。负责材料、几何、热、应力、塑性、损伤、表面、界面、规则、操作合法性和回放。不得依赖 Three.js、DOM、微信、故事文本或某个游戏的属性名。

其中 `forge-physics.ts` 是共享材料响应层：几何求解器提供应变和接触载荷，它统一计算屈服软化、弹塑分配、残余应力、损伤和机械功。后续工序不得绕过此层直接修改质量或损伤。

### `src/app`

组装宿主、输入和核心，控制当前游戏流程。不存物理公式，不直接修改锻造状态。

### `src/render`

只读 `ForgeSnapshot`。负责第一人称工作站、程序化场景和反馈，不反向写入状态。

### `src/entry` / `src/platform`

把浏览器和微信输入转换成平台无关的 `ForgeIntent`。两端必须能够回放同一组操作得到相同核心状态。

### 下游 profile

动作游戏的攻击、破甲、防御；冒险游戏的六维；魔法游戏的奥术亲和、符文承载等，都只能读取 `ForgeFacts` 并拥有自己的版本和公式。不得把这些属性塞回 `ForgeState`。

## 3. 统一锻造模型

八个工艺类别共享同一份状态和过程机制：

```text
选料 -> composition / material
切割 -> separation / topology / removal
焊合 -> interface / pressure / heat / diffusion approximation
加热 -> thermal boundary
锤击 -> local compressive contact
淬火 -> cooling boundary / phase approximation
回火 -> thermal cycle / stress relief
研磨 -> abrasive removal / surface integrity
```

它们不是八套独立的加减分数。接触压力、摩擦、温度、材料流动、质量/体积约束和损伤状态由核心统一处理；工艺只提供不同的工具几何、运动和边界条件。

## 4. 第一人称工作站

锻造操作工作站采用第一人称构图：工件和工具接触区处于视线中心，手部、夹具和工具作为近景反馈，炉子、工具架和淬火槽作为周边空间。玩家的点击、拖动、旋转和送料必须对应工件上的实际接触和载荷。当前原型暂不提供独立的落点标记；瞄准可读性和操作反馈由后续手感/UI 阶段统一设计，不能因此改变核心状态接口。

仓库选择与工坊导航可以使用俯视或 2.5D；进入锤击、加热、切割、焊合、淬火、回火和研磨工作站后，操作视角以第一人称为准。

## 5. 八类工艺与操作覆盖

八类足以作为系统主干，但不代表八个按钮。锤击工作站需要通过锤头形状、砧面、支撑、旋转、送料、落点和能量涌现拔长、镦粗、展宽、压薄、弯曲、扭转、拔尖、校直和整形。切割需要为后续冲孔、修边和拓扑分离保留接口；研磨需要真正移除表层质量，而不是只增加锋利分数。

需要新增能力时，优先扩展已有工具和过程接口；只有出现独立的玩家目标、工具空间和状态边界时，才新增顶层工艺。

## 6. 版本与公共契约

- `ForgeState`、`ForgeIntent`、`ForgeOperation`、`ForgeSnapshot` 的形状或语义改变，必须说明兼容策略并增加迁移/固定样本。
- 物理规则参数改变，必须提升规则参数版本并更新受影响的样本。
- 下游 profile 公式改变，只提升 profile 版本，不修改核心状态版本。
- 每个回放必须记录核心规则版本、操作序列和下游 profile 版本（如有）。
- 不通过隐式字段、死字段或临时兼容分支保存旧设计；废弃公共字段时同步删除测试、文档和入口调用。

## 7. 文件所有权

```text
src/forge       核心状态、操作、规则、回放、派生事实
src/app         组装和流程
src/entry       浏览器/微信入口
src/platform    平台适配
src/render      Three.js 只读表现
src/data        可校验的材料、规则和内容数据
tests           按源码边界镜像；e2e 只放 tests/e2e
docs            计划、契约、架构和研究基线
.github         CI、PR 和 Issue 模板
```

不要创建 `utils`、`common`、`manager`、`service` 等无明确所有权的兜底目录。

## 8. 交接流程

接手者必须：

1. 阅读 `AGENTS.md`、`PROJECT_PLAN.md`、本文档和核心 API 文档。
2. 执行 `git status --short --branch`、`git log --oneline --decorate -12`。
3. 确认分支、HEAD、远端关系和是否存在未提交修改。
4. 执行 `npm ci` 与 `npm run check`；失败时先记录失败，不把失败结果写成“已完成”。
5. 修改前确认公共接口、目录责任和当前阶段，修改后提供文件、测试和未验证边界。

## 9. GitHub 交付规则

- `main` 只接受经过自动检查和作者体验验收的合并。
- 功能使用短期分支；不 force push，不重写历史，不用 `reset --hard` 清理现场。
- PR 必须说明目标、范围、设计取舍、测试证据、未验证项和是否改变公共接口。
- Issue 用于记录待讨论的体验问题、物理假设和技术任务；不要用聊天记录代替仓库事实。
- 不擅自添加许可证、第三方资产或外部依赖；来源和许可证必须先记录。
