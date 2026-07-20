# Current Task

> This is the only live handoff note. Update it before changing device, pausing a slice, or requesting merge.

- **Task**: S0 portable project foundation and plan consolidation
- **Branch**: `chore/S0-portable-workflow`
- **Issue / Draft PR**: `#1` / `#2`
- **Prepared next Issue**: `#3` S3a minimal simulation core
- **Base**: `36bbe2f`
- **Device owner**: current macOS device; Windows takes over only after the clean-clone rehearsal
- **State**: plan audit in progress; Cocos integration intentionally paused until the audit is accepted

## Verified Facts

- Node `v24.18.0` and npm `11.16.0` work locally.
- Cocos Dashboard and Creator `3.8.8` are installed.
- A clean Cocos 3D project exists at `/Users/yzx/NewProject`; it is the source for the 2.5D project skeleton, not a second product repository.
- GitHub Issue #1, Issue #3, and Draft PR #2 exist. `main` requires a PR, linear history, squash-only merge, and blocks deletion/force pushes. CI is not yet available to require.
- LFS tracking rules exist, but the Git LFS executable is not installed yet.
- Legacy S1 data check runs with local Node. It proves only that legacy reference data is readable.

## Next Actions

1. Finish the plan audit and obtain author acceptance of `PROJECT_PLAN.md`.
2. Ask the author to close Creator, then import only the generated project skeleton from `/Users/yzx/NewProject`.
3. Add lockfile, `doctor`, typecheck, tests, data validation, CI, and Web Desktop build wrapper; export and play the first H5.
4. Install/configure Git LFS, rehearse a clean clone, then merge S0.

## Before Leaving This Device

Close Cocos, run available checks, update this file, commit and push the active branch, verify the remote commit matches, and leave a clean worktree.
