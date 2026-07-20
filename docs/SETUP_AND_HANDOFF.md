# 环境与换机交接

## 当前 macOS 环境

- Node `v24.18.0`、npm `11.16.0` 已验证。
- Cocos Dashboard 与 Creator `3.8.8` 已安装。
- 临时 Creator 3D 工程：`/Users/yzx/NewProject`。关闭 Creator 后，Codex 只迁移其项目骨架；绝不迁移 `.git`、`library/`、`temp/`、`profiles/` 或构建物。

## S0 完成后可用命令

```bash
npm ci
npm run doctor
npm test
npm run typecheck
npm run build:web
```

`doctor`、测试和构建脚本尚未建立；它们必须在 S0 中实际运行后才能算可用。

## Windows 接手

第一天只复现，不开发：

1. 安装 Git、Git LFS、Node 24 LTS、Cocos Dashboard 和 Creator 3.8.8。
2. clone 仓库，读取根目录 `AGENTS.md`、`CURRENT_TASK.md`、`PROJECT_PLAN.md`。
3. 切换指定分支并执行 `git pull --ff-only`；如有 LFS 资产再执行 `git lfs pull`。
4. 安装锁定依赖，运行 `doctor`、测试和类型检查。
5. 用 Creator 打开工程，等待首次导入；构建并打开 H5。
6. 将结果写回当前 Draft PR。两台设备结果一致后，Windows 才取得开发权。

## 每次离机

关闭 Creator，运行可用检查，更新 `CURRENT_TASK.md`，创建 WIP 或完成 commit 并 push，确认本地/远端提交一致且工作区干净。不要用 `git reset --hard` 或 force push 处理问题；先建立 rescue 分支，已合入历史用 `git revert`。
