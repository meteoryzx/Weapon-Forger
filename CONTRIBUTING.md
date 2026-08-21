# 贡献与 AI 协作

开始前请阅读：

1. `README.md`
2. `docs/README.md`
3. `AGENTS.md`
4. `PROJECT_PLAN.md`
5. `docs/ARCHITECTURE.md`
6. `docs/FORGE_CORE_API.md`

## 开发流程

```powershell
git status --short --branch
git log --oneline --decorate -12
npm ci
npm run check
```

从功能分支工作。修改前先确认目标阶段、文件所有权、公共接口和当前未提交现场。修改后至少运行与改动边界匹配的检查；进入交付前运行完整 `npm run check`。

## 提交与 PR

提交信息格式：

```text
[阶段/模块] 可读动作
```

PR 必须包含：

- 目标和范围；
- 主要设计取舍；
- 修改文件和公共接口变化；
- 自动检查证据；
- 作者需要体验的步骤；
- 尚未验证的浏览器、微信或真机边界。

不要把生成目录、依赖目录、测试报告或本地密钥提交到仓库。不要未经确认删除历史、修改 `main` 历史、改变仓库可见性或添加许可证。

## 体验验收

自动测试不能替代作者验收。涉及新玩家行为的 PR 必须说明准备入口、操作步骤、应该看到的结果、不应该看到的结果和通过标准。
