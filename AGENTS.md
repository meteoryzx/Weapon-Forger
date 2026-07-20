# Weapon Forger Agent Guide

## Read Order

1. Read `CURRENT_TASK.md` for branch, owner, progress, and next action.
2. Read `PROJECT_PLAN.md` before changing code, data, scenes, or design.
3. Read `docs/锻造工艺研究报告.md` for simulation rules and `docs/SETUP_AND_HANDOFF.md` for environment or device work when relevant.

## Non-Negotiable Rules

- Never develop on `main`, force-push, or use `git reset --hard` for routine recovery.
- One short branch and one Draft PR deliver one player-verifiable vertical behavior. Keep `main` runnable.
- The pure simulation, evaluation, and agent world must not import Cocos.
- Input creates immutable `ForgeOperation` records. Operations change `ForgeState`; M3 derives `WeaponData`; no operation may directly add a stat.
- Rendering only reads `ForgeSnapshot`/`WeaponData`; stories only read finalized `WeaponData` and proved rule events. Neither may change simulation state.
- The player may freely forge a continuous billet. Do not require a weapon category or replace forging with prebuilt blade parts.
- Use deterministic rules for forging defects and explicitly seeded randomness for the agent world.
- Player-facing forging UI hides six stats and overall quality. Use visible material feedback; NPC adventure is the explicit performance feedback.
- Do not add soft-body physics, arbitrary welding, full weapon taxonomy, runtime LLMs, multiple worlds, economy, formal WeChat release, or large final-art production to this six-week demo.
- Treat the existing `assets/scripts/weapon` and `assets/data` files as legacy S1 references until the S3a migration plan replaces their contracts. Do not build new features on `baseForm`, `overall`, direct material stat bonuses, or fixed story branches.

## Workflow And Evidence

1. State branch, worktree state, intended player behavior, scope, and acceptance evidence before editing.
2. Create or link an Issue, set the Goal, and work in a short branch with a Draft PR.
3. Write/adjust contract tests before public interfaces, then pure logic, then Cocos adapters.
4. Commit and push every describable checkpoint. Use `[WIP]` only for an unfinished checkpoint.
5. Run the checks declared by the active slice. CI only proves pure TypeScript/data; local Cocos/H5 evidence proves engine behavior.
6. Give the author a plain Chinese test path. Review the complete diff before asking for acceptance.
7. After acceptance, squash merge the PR, tag major milestones, and update `CURRENT_TASK.md`.

## Project Files

- Commit Cocos source, `assets/`, `.meta`, `settings/`, `package.json`, lockfiles, source, data, and tests.
- Never commit `library/`, `temp/`, `local/`, `profiles/`, `build/`, dependency folders, or local caches.
- PSD, WAV, and BLEND source assets use Git LFS after it is installed. H5 archives and videos use GitHub Releases.
- Tunable values and player-facing copy belong in versioned data files, not scattered code.

## Done Means

A slice is complete only when its automated checks pass, its relevant Cocos/H5 behavior is demonstrated, the author has played and accepted it, Codex has reviewed the full diff, and its PR is ready to squash merge.
