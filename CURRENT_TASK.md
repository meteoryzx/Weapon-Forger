# Current Task

> This is the only live handoff note. Update it before changing device, pausing a slice, or requesting merge.

- **Task**: S3a minimum simulation core
- **Branch**: `feat/S3-forge`
- **Issue / PR**: Issue `#3`; Draft PR not yet created
- **Base**: `39a4122` from merged S0b PR #4
- **Device owner**: current macOS device; Windows performs its clean-clone rehearsal from merged `main` before taking over
- **State**: contract and deterministic simulation are implemented locally; next checkpoint is a draft PR, full check and review.

## Verified Facts

- Node `v24.18.0` and npm `11.16.0` work locally.
- Cocos Dashboard and Creator `3.8.8` are installed.
- The 3D project skeleton from `/Users/yzx/NewProject` is integrated into this branch. Cocos generated eight required legacy asset `.meta` files; generated caches remain ignored.
- `assets/Bootstrap.scene` contains the initial camera/light scene and has a committed `.meta` identity.
- `npm run check` passes locally. The official Creator command-line build succeeds with exit code `36` and produces the ignored `build/web-desktop` directory.
- The author opened `http://127.0.0.1:4174` and confirmed the empty graybox H5 renders.
- GitHub Issue #1 is closed, Issue #3 is open, and S0b PR #4 is squash merged as `39a4122`. `main` requires a PR, linear history, squash-only merge, and blocks deletion/force pushes.
- GitHub CLI `2.96.0` is authenticated with `repo` and `workflow` scopes.
- Git LFS `3.7.1` is installed in `~/.local/bin`, initialized, and recognizes the tracked `*.psd`, `*.wav`, and `*.blend` patterns.
- A fresh clone at commit `80bbe6c` installed dependencies, passed required doctor/check, rebuilt H5, opened in Creator with zero console errors, and remained Git-clean.
- Windows portability is designed but not yet proved on the private PC. `COCOS_CREATOR` supports non-default Dashboard install locations; Windows does not take ownership until its rehearsal passes.
- S3a's pure TypeScript core currently proves deterministic JSON replay, hot/cold deformation and stress differences, orientation response, neighbour influence, volume preservation, bending correction and deterministic cracks.
- Legacy S1 data check runs with local Node. It proves only that legacy reference data is readable.

## Next Actions

1. Commit and push the S3a contract checkpoint, create its Draft PR, then complete sample output and full-diff review.
2. On the private Windows PC, clone merged `main` and run the documented rehearsal before Windows starts feature work; record the result in its active S3 PR.

## Before Leaving This Device

Close Cocos, run available checks, update this file, commit and push the active branch, verify the remote commit matches, and leave a clean worktree.
