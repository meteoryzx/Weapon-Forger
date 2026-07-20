# GitHub 首次设置

> 这份只用于 S0。GitHub CLI 可用后由 Codex 自动化；当前先保留网页操作路径。

## 1. 建 S0 Issue

1. 打开仓库的 **Issues**，选择 **New issue**。
2. 选择 **Playable vertical slice** 模板。
3. 标题写：`[Slice] S0 可迁移工程地基`。
4. Player Outcome 写：`在任意干净目录 clone 后，可以检查环境、运行测试、用 Cocos 3.8.8 打开并构建 H5。`
5. In Scope 写：协作规范、Cocos 工程、依赖锁、doctor、测试、CI、H5、LFS、换机演练。
6. Out Of Scope 写：S3 锻造功能、正式美术、微信正式版。
7. 建立后把 Issue 编号写进 `CURRENT_TASK.md`。

## 2. 建 Draft PR

1. 当前 branch 第一次 push 后，打开 GitHub 提示的 **Compare & pull request**。
2. base 选择 `main`，compare 选择 `chore/S0-portable-workflow`。
3. 标题写：`[S0] 建立可迁移协作与 Cocos 工程地基`。
4. 选择 **Create draft pull request**，不要创建正式 PR。
5. 在 `Linked Issue` 填 `Closes #编号`，把 PR 编号写进 `CURRENT_TASK.md`。

## 3. 保护 main

在仓库 **Settings → Rules → Rulesets → New branch ruleset**：

- Target branch：`main`。
- Require a pull request before merging：开启。
- Required approvals：单人项目可设为 0；仍必须经过 PR。
- Require status checks to pass：CI 首次出现后选择项目检查。
- Block force pushes：开启。
- Block deletions：开启。
- 规则设为 Active 并保存。

保护规则只防误操作，不替代验收。Draft PR 不得合并；只有测试、Codex review 和作者试玩都通过，才转正式并 squash merge。
