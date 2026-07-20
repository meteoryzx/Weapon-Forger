# Current Task

> This is the only live handoff note. Update it before changing device, pausing a slice, or requesting merge.

- **Task**: S0b portable Cocos engineering foundation
- **Branch**: `chore/S0-cocos-foundation`
- **Issue / PR**: Issue `#1`; Draft PR `#4`
- **Prepared next Issue**: `#3` S3a minimal simulation core
- **Base**: `d6ce8b6` from merged PR #2
- **Device owner**: current macOS device; Windows takes over only after the clean-clone rehearsal
- **State**: Creator 3.8.8 opens the repository; pure checks pass; the first Web Desktop H5 builds successfully

## Verified Facts

- Node `v24.18.0` and npm `11.16.0` work locally.
- Cocos Dashboard and Creator `3.8.8` are installed.
- The 3D project skeleton from `/Users/yzx/NewProject` is integrated into this branch. Cocos generated eight required legacy asset `.meta` files; generated caches remain ignored.
- `assets/Bootstrap.scene` contains the initial camera/light scene and has a committed `.meta` identity.
- `npm run check` passes locally. The official Creator command-line build succeeds with exit code `36` and produces the ignored `build/web-desktop` directory.
- GitHub Issue #1 and Issue #3 remain open; PR #2 is merged. `main` requires a PR, linear history, squash-only merge, and blocks deletion/force pushes.
- The current HTTPS credential cannot upload `.github/workflows/*` because it lacks workflow scope. Add CI after GitHub authorization is refreshed; local `npm run check` is the current gate.
- LFS tracking rules exist, but the Git LFS executable is not installed yet.
- Legacy S1 data check runs with local Node. It proves only that legacy reference data is readable.

## Next Actions

1. Serve and visually inspect the first H5, then verify a clean Creator restart.
2. Refresh GitHub workflow authorization and add pure-logic CI.
3. Install LFS and perform the clean-clone rehearsal.

## Before Leaving This Device

Close Cocos, run available checks, update this file, commit and push the active branch, verify the remote commit matches, and leave a clean worktree.
