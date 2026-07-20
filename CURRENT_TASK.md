# Current Task

> This is the only live handoff note. Update it before changing device, pausing a slice, or requesting merge.

- **Task**: S0b portable Cocos engineering foundation
- **Branch**: `chore/S0-cocos-foundation`
- **Issue / PR**: Issue `#1`; Draft PR `#4`
- **Prepared next Issue**: `#3` S3a minimal simulation core
- **Base**: `d6ce8b6` from merged PR #2
- **Device owner**: current macOS device; Windows takes over only after the clean-clone rehearsal
- **State**: macOS clean-clone, Creator GUI, pure checks, Web build, and H5 visual acceptance pass; Windows rehearsal remains pending

## Verified Facts

- Node `v24.18.0` and npm `11.16.0` work locally.
- Cocos Dashboard and Creator `3.8.8` are installed.
- The 3D project skeleton from `/Users/yzx/NewProject` is integrated into this branch. Cocos generated eight required legacy asset `.meta` files; generated caches remain ignored.
- `assets/Bootstrap.scene` contains the initial camera/light scene and has a committed `.meta` identity.
- `npm run check` passes locally. The official Creator command-line build succeeds with exit code `36` and produces the ignored `build/web-desktop` directory.
- The author opened `http://127.0.0.1:4174` and confirmed the empty graybox H5 renders.
- GitHub Issue #1 and Issue #3 remain open; PR #2 is merged. `main` requires a PR, linear history, squash-only merge, and blocks deletion/force pushes.
- GitHub CLI `2.96.0` is authenticated with `repo` and `workflow` scopes. Pure-logic CI is added; its first PR run must pass before review.
- Git LFS `3.7.1` is installed in `~/.local/bin`, initialized, and recognizes the tracked `*.psd`, `*.wav`, and `*.blend` patterns.
- A fresh clone at commit `80bbe6c` installed dependencies, passed required doctor/check, rebuilt H5, opened in Creator with zero console errors, and remained Git-clean.
- Windows portability is designed but not yet proved on the private PC. `COCOS_CREATOR` supports non-default Dashboard install locations; Windows does not take ownership until its rehearsal passes.
- Legacy S1 data check runs with local Node. It proves only that legacy reference data is readable.

## Next Actions

1. Confirm the first pure-logic CI run passes on Draft PR #4.
2. Review the complete S0b diff and prepare author acceptance; keep Issue #1 open until Windows rehearsal if needed.
3. On the private Windows PC, run the documented rehearsal before any feature work.

## Before Leaving This Device

Close Cocos, run available checks, update this file, commit and push the active branch, verify the remote commit matches, and leave a clean worktree.
