# Weapon Forger / 打了个铁

一款以自由锻造和可解释故事后果为核心的 2.5D 系统策划作品集。项目使用 TypeScript、Three.js 和 Vite，同一套游戏逻辑与程序化场景同时服务浏览器 H5 和微信小游戏。

## 当前状态

- 已完成并验收：浏览器与微信同源入口、蓄力锤击、钢坯转面、送料、稳定薄坯局部形变。
- 当前切片：`R1i-a` 火炉送入、取出、升温、降温与热历史。
- 下一验收：在 Windows 浏览器中试玩火炉循环；通过前不继续淬火或研磨。

项目状态与计划以 [`PROJECT_PLAN.md`](PROJECT_PLAN.md) 为准；AI 协作、批准、验收和 Git 规则只以 GitHub `main` 的 [`AGENTS.md`](AGENTS.md) 为准。

## 本地运行

需要 Node.js 24。

```powershell
npm ci
npx playwright install chromium
npm run check
npm run dev -- --host 127.0.0.1 --port 4177
```

浏览器入口为 `http://127.0.0.1:4177`。微信产物由 `npm run build:wechat` 生成到 `dist/wxgame`，登录、导入、扫码和真机验收由作者完成。

## 仓库结构

```text
src/
  app/       组装依赖与控制流程
  entry/     浏览器和微信运行入口
  platform/  输入与平台能力适配
  forge/     确定性锻造状态、操作与回放
  evaluate/  最终状态到隐藏性能、特性和缺陷（R2）
  story/     武器数据到确定性事件（R3）
  render/    Three.js 程序化场景与状态可视化
tests/       按源码边界组织的逻辑、平台和端到端测试
scripts/     可重复的开发与验证脚本
wechat/      微信小游戏宿主配置
.github/     CI、PR 和 Issue 协作模板
```

`dist/`、`node_modules/`、`test-results/` 和 Playwright 报告均为本地产物，不进入 Git。旧 Cocos 路线仅保留在 Git 历史中，不是现行工程的一部分。
