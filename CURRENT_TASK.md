# Current Task

> This is the only live handoff note. Update it before changing device, pausing a slice, or requesting merge.

- **Task**: S3b 2.5D workshop navigation and forge interaction
- **Branch**: create `feat/S3b-workshop-graybox` from current `main`
- **Issue / PR**: Open design-gate Issue `#6`; create one Draft PR for the first playable S3b slice
- **Base**: `afaa5df` from merged S3a PR #5
- **Device owner**: current macOS device; Windows performs its clean-clone rehearsal from merged `main` before taking over
- **State**: S3a's physical core is merged and Issue #3 is closed. The S3b graybox experience is confirmed: fixed top-down/oblique workshop overview, click a station to enter its close operation view, no visible player character, tongs and hammer represent the player at the anvil. The minimum stations are rack, furnace, anvil, quench tank, and grinder. Hand hammer comes first; power hammer is a later tool using the same M1 operation interface.

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
- S3a's pure TypeScript core currently proves deterministic JSON replay, material-specific hot/cold deformation and stress differences, stress recovery without crack healing, thermal damage, orientation response, neighbour influence, volume preservation with draw-out, bending correction, and deterministic cracks caused by local cold-working damage rather than a raw stress threshold.
- S3a is merged as `afaa5df`; PR #5 had green CI and no blocking review finding. Issue #6 records the required S3b design gate.
- Legacy S1 data check runs with local Node. It proves only that legacy reference data is readable.

## Next Actions

1. Record the confirmed design gate in Issue #6, create the S3b branch/Draft PR, then implement the workshop overview and rack -> furnace -> anvil navigation chain.
2. Add deterministic M1 time advance/passive cooling before anvil input, then implement the hand-hammer close view and continuous workpiece feedback.
3. On the private Windows PC, clone merged `main` and run the documented rehearsal before Windows starts feature work; record the result in its active S3 PR.

## Before Leaving This Device

Close Cocos, run available checks, update this file, commit and push the active branch, verify the remote commit matches, and leave a clean worktree.
