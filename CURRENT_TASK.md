# Current Task

> This is the only live handoff note. Update it before changing device, pausing a slice, or requesting merge.

- **Task**: S0b portable Cocos engineering foundation
- **Branch**: `main` after PR #2 merges; next create `chore/S0-cocos-foundation`
- **Issue / PR**: Issue `#1` remains open; the S0b Draft PR does not exist yet
- **Prepared next Issue**: `#3` S3a minimal simulation core
- **Base**: the squash commit produced by merging PR #2
- **Device owner**: current macOS device; Windows takes over only after the clean-clone rehearsal
- **State**: S0a plan/workflow baseline accepted and reviewed; merge PR #2, then start S0b

## Verified Facts

- Node `v24.18.0` and npm `11.16.0` work locally.
- Cocos Dashboard and Creator `3.8.8` are installed.
- A clean Cocos 3D project exists at `/Users/yzx/NewProject`; it is the source for the 2.5D project skeleton, not a second product repository.
- GitHub Issue #1, Issue #3, and Draft PR #2 exist. `main` requires a PR, linear history, squash-only merge, and blocks deletion/force pushes. CI is not yet available to require.
- LFS tracking rules exist, but the Git LFS executable is not installed yet.
- Legacy S1 data check runs with local Node. It proves only that legacy reference data is readable.

## Next Actions

1. Merge the accepted S0a PR #2 without closing Issue #1.
2. Create `chore/S0-cocos-foundation` from the updated `main` and open its Draft PR.
3. Ask the author to close Creator, then import only the generated project skeleton from `/Users/yzx/NewProject`.
4. Add lockfile, `doctor`, typecheck, tests, data validation, CI, Web Desktop build wrapper, LFS, and the clean-clone rehearsal.

## Before Leaving This Device

Close Cocos, run available checks, update this file, commit and push the active branch, verify the remote commit matches, and leave a clean worktree.
