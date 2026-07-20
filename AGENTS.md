# Weapon Forger - Codex Guide

## Start Here

1. Read `CURRENT_TASK.md` for the active branch, task, and next action.
2. Read `START_HERE_AGENT交接指南.md` for product intent.
3. Read `PROJECT_RULES.md` before editing code or project files.
4. Read only the task-relevant design docs linked by those files.

## Working Rules

- Never develop directly on `main`. Use one short branch per playable vertical slice.
- Before editing, report the current branch, working-tree state, intended change, and acceptance evidence.
- Keep the simulation core free of Cocos imports. Cocos adapts input and renders read-only snapshots.
- Stories may read finalized `WeaponData`; they must not read forging-session internals.
- Do not encode an operation as a direct stat bonus. Operations change physical state; evaluation derives stats.
- Put tunable numbers and player-facing text in data files.
- Preserve user changes. Ask before deleting files or making a breaking contract change.
- Prefer recoverable Git operations. Do not use `git reset --hard` without a rescue branch or remote copy and explicit approval.
- Run the checks named in the active Issue/PR before requesting acceptance.
- Explain each checkpoint in plain Chinese: outcome, evidence, current term, and user acceptance steps.

## Definition Of Done

A slice is done only when automated checks pass, the relevant Cocos/H5 behavior is demonstrated, Codex reviews the diff, the author accepts the behavior, and the PR is ready to squash-merge.

## Canonical Commands

Commands will be activated when the portable Cocos project is initialized:

- `npm ci` - install the exact locked dependencies.
- `npm run doctor` - verify the local environment and repository state.
- `npm test` - run pure simulation and data tests.
- `npm run typecheck` - check TypeScript contracts.
- `npm run build:web` - build the local Cocos Web Desktop target.
