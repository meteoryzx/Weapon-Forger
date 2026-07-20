# 环境与换机交接

## 当前 macOS 环境

- Node `v24.18.0`、npm `11.16.0` 已验证。
- Cocos Dashboard 与 Creator `3.8.8` 已安装。
- Creator 3D 工程骨架已经并入正式仓库，项目版本锁定为 `3.8.8`。`/Users/yzx/NewProject` 只保留为临时来源，不再参与开发。

## 当前可用命令

```bash
npm ci
npm run doctor
npm test
npm run typecheck
npm run build:web
```

`npm run check` 会依次执行环境检查、类型检查、数据校验和单元测试。`npm run build:web` 调用本机 Creator 3.8.8；官方以退出码 `36` 表示构建成功。CI 不安装或启动 Cocos，只验证纯逻辑和数据。

本机 Git LFS 安装在 `~/.local/bin`，`~/.zprofile` 已加入该目录。换机验收使用 `npm run doctor -- --require-cocos --require-lfs`，同时要求 Creator 3.8.8 与 Git LFS 存在。

Creator 的账号登录、macOS/Windows 系统授权与真人试玩必须由作者完成。日常场景内容优先由代码和项目内扩展生成，不把第三方 MCP 当作换机必需条件。

## Windows 接手

第一天只复现，不开发：

1. 安装 Git、Git LFS、Node 24 LTS、Cocos Dashboard 和 Creator 3.8.8。
2. clone 仓库，读取根目录 `AGENTS.md`、`CURRENT_TASK.md`、`PROJECT_PLAN.md`。
3. 切换 `main` 并执行 `git pull --ff-only`；如有 LFS 资产再执行 `git lfs pull`。
4. 安装锁定依赖，运行 `doctor`、测试和类型检查。
5. 用 Creator 打开工程，等待首次导入；构建并打开 H5。
6. 将结果写回当时活跃的 S3 Draft PR。两台设备结果一致后，Windows 才取得开发权。

PowerShell 验收命令：

```powershell
git lfs install
git lfs pull
npm ci
npm run doctor -- --require-cocos --require-lfs
npm run check
npm run build:web
```

脚本会检查 Dashboard 的常见安装位置。如果 Creator 安装在其他盘符，当前终端先指定实际程序路径：

```powershell
$env:COCOS_CREATOR = "D:\\你的安装目录\\CocosCreator.exe"
npm run doctor -- --require-cocos --require-lfs
```

Windows 验收必须看到 `Doctor 通过`、全部测试通过、Cocos 构建成功，并能在浏览器打开新生成的 H5；在此之前不能宣称换机完成。

## 每次离机

关闭 Creator，运行可用检查，更新 `CURRENT_TASK.md`，创建 WIP 或完成 commit 并 push，确认本地/远端提交一致且工作区干净。不要用 `git reset --hard` 或 force push 处理问题；先建立 rescue 分支，已合入历史用 `git revert`。
