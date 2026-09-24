# Codex Account Handoff

Checkpoint: 2026-09-21. User explicitly requested switching accounts; feature work stopped for handoff. Continue in the SAME local checkout. This is not a release or author acceptance.

## Start Here

1. Open `D:/打了个铁/Weapon-Forger-hammer`, read `AGENTS.md`, this file, and the current section of `PROJECT_PLAN.md`.
2. Run `git status --short --branch` and preserve all tracked/untracked changes. Branch `feat/R1-shaping-flow`; HEAD `2cf5e5c` (`feat(power-hammer): integrate reference model and faster held strokes`), ahead of origin by one. No new commit or push is authorized by this handoff.
3. Resolve the pressure calibration discrepancy below before using passing tests as final evidence. Then complete model evidence, focused regressions and hard gates, and open the experience. No need to request another design approval or generate more references.

## User Decisions

- Goal: finish power hammer and hydraulic press to playable author review. Latest account-switch request pauses that implementation, not its scope.
- Real proportions, early-industrial integrated cast-iron machines, low-poly geometry, shared iron/steel/brass palette. Fine-pixel materials and REPLACED-inspired lighting are later polish, not grounds to delay usable geometry indefinitely.
- Keep img2threejs reference-driven modeling; simplify detail, not physical functionality. User supplies images externally; no image generation/API spending here.
- Pressure reference main and auxiliary views are sufficient and accepted for modeling, not approved final art. Preserve one integrated machine, no separate modern pump/tank.
- Power: hold Space for repeated strikes, fixed cadence, wheel force, left drag translation, right drag selected yaw/roll axis, contact preview. Release stops new strikes; descending strike completes.
- Press: sustained compression, not repeated hammering. Fixed machine, freely positioned/rotated material when tooling is open. Flat tooling first; future V-shaped tools and fusion need new contracts. Multilayer fusion is NOT implemented.
- Preserve same workshop, actual billet scale, furnace positions and saved material facts. Regression scope is equipment/hammer only, not full crafting E2E.
- User accepts reduced detail, but both machines' current art/feel still require author judgment. Do not claim final cinematic/pixel finish.

## Critical Unfinished Item

The original handoff calibration discrepancy is resolved in the current continuation: `src/forge/press-response.ts` now uses an 800 kN playable rating. This was changed after the author reported that the previous 600 kN result was visually indistinguishable in real use; the material yield rule remains intact and no artificial minimum deformation was added.

- Pressure-machine UI default remains 65% and the 70% wheel setting is covered. Power default remains 45%.
- Real acceptance sample is `GameApplication(SPRING_STEEL)` -> move furnace -> `getSnapshot(30000)` -> `commitPreview()` -> move inspection with elapsed 0. Temperature is about 1006.62 C.
- The current 800 kN calibration gives about 0.33 mm at 65% and 0.47 mm at 70% on that baseline. Loads below each material's actual resistance still do not deform; do not lower material yield thresholds to force a result.
- `tests/forge/press-platen.test.ts` currently requires both high-carbon/spring-steel real baselines to deform at 50%; reconcile with each material's actual yield, not a universal assertion. `press-response.test.ts` currently includes temporary 1 MN cold-steel expectations; revise to intended calibration.
- `transferredPath` serializes a whole workpiece for cross-clone caching. Lead has since made the worker reuse the actual immutable baseline, so remove this redundant JSON cache and its cross-clone cache expectation if no remaining consumer needs it. Keep identity-keyed WeakMap caching and deterministic results.
- The 205-unit-test and latest press browser passes below ran with the temporary configuration. They establish exercised paths, NOT final calibration acceptance.

## Implemented Working Tree

- `src/forge/press-response.ts`: independent quasi-static upsetting path, force/yield/temperature/friction/support, bounded stroke/dwell, volume conservation, no hand-hammer invocation. Flat-platen clearance checks use actual clipped surfaces; full contact response extends beyond the die edge by a mesh collar so a high rim cannot intersect the tool. Remote nodes are fixed, lateral flow localized. Handles retained cut-solid control nodes. Still reduced-order supported compression, not general FEM or press bending.
- `src/forge/forge-simulation.ts`, `forge-types.ts`, `index.ts`: pressure operation remains `{kind:'forge-press',pose,target,pressure,strokeMm,dwellMs}` and updates geometry/material facts. Old saved geometry loads unchanged; operation-only historical replay uses the new rule.
- `src/app/forge-press-cycle.ts`: approach -> loading -> settle final result -> return. Early release reverses before contact; cumulative dwell caps at 4000 ms; maximum requested plastic stroke 24 mm, actual response further limited by thickness/yield.
- `src/entry/browser.ts`: immutable per-cycle baseline; serialized async previews evaluated from baseline with cumulative dwell; one final operation committed on release. Baseline identity guards, blur/hidden/inspection stop, no queued impacts. Same material translation/rotation and wheel controls for both devices. Pressure setting locked within a cycle. Brief below-yield/support-limited status. Default pressure 65%, power 45%.
- `src/platform/hammer.worker.ts`: optional `reuseBaseline` protocol, retaining immutable original state for repeated evaluations, never previous preview. Existing hand-hammer callers still send full state.
- `src/render/forge-press-model.ts`: image-derived integrated gate frame, pedestal, guided crosshead, piston, 48x48 upper die /224x104 lower support, gauge, valve, ribs, fasteners. `createForgePress(k)` returns root/ram/control/contact/upper/openRamY/closedRamY. 875 mm work surface, 120 mm open gap. Same low-poly palette as power.
- `src/render/forge-press-workpiece.ts`, `power-hammer-workpiece.ts`, `forge-billet-view.ts`, `workshop-assets.ts`: actual placed surface and shared footprint preview, pressure-specific obstacle volumes, moving ram tied to rendered contact height, old fake press animation/model removed. Operation and whole-device views. Conservative placement proxies, not full collision dynamics.
- `src/app/workshop-scale.ts`: press X origin 70 -> 68 scene units to remove actual overlap with power base; pressure work surface corrected to 40. Furnace positions unchanged.
- `index.html`: removed fixed dwell slider; holding defines dwell. Added/reworked focused tests under app/forge/render and `tests/e2e/powered-forging.spec.ts`.

## Images and Model Evidence

- Reference assets are now in repo: `assets/concepts/forge-press-v2-main.png`, `forge-press-v2-views.png`. Do not depend on old temporary clipboard paths.
- Pressure pipeline: `.img2threejs/forge-press-v2/`. Consult `state.json` with `python C:/Users/30949/.codex/skills/img2threejs/forge/next.py --state .img2threejs/forge-press-v2/state.json .img2threejs/forge-press-v2/object-sculpt-spec.json` before proceeding. At handoff audit state remained active, current step `projection-route`, current pass `blockout`; model/spec/captures already exist beyond that checklist. Reconcile evidence honestly; do not fabricate retrospective gate completion.
- Retained blockout/structure/final sources and multi-view screenshots are in that folder; `preview/index.html` imports the actual runtime model. Hidden rear hydraulics are inferred, not reconstructed engineering facts. Shared unpatterned material palette deliberately replaces photographic wear detail.
- Model worker's final report: blockout Tier1 failed (IoU0.3792, scale/proportion and missing map-stripped evidence). Structure was manually advanced without standard pass unlock; preserve this process deviation. The spec now lags final geometry/guide positions. Existing early strict validation is not a final model pass. Inspect final captures and reconcile applicable gates under the user's explicitly reduced fidelity scope without laundering the failed gate.
- Model-only final capture completed, no page errors, 120 mm open gap and approximately zero closed gap;5410 triangles/141 draw calls versus spec target100 (check shadow-pass contribution). Final model-only images were not visually inspected by the lead. Actual envelope986x900x1900 mm, X[-490,496]; sliding shoes extend to X +/-330. Model tests5/5 passed. All workers are now stopped/closed and no test process remains running from this handoff.
- Original power `.img2threejs/power-hammer-v2/state.json` has a stopped failed exact-fidelity history; keep it. Runtime power model remains its original generated body plus approved structural additions; do not reset its gate or claim exact fidelity passed.
- Current workshop screenshots inspected: `output/playwright/press-{1280,390}-{operation,machine,loading}.png`; power equivalents also exist. Workpiece and die readable; both bodies remain visible in the same room. Final art approval is pending.

## Verified and Pending

- Latest completed full unit run after calibration: `npm run test -- --maxWorkers=1` -> **37 files /207 tests passed**.
- Pressure browser: `npm run test:e2e -- tests/e2e/powered-forging.spec.ts --workers=1` -> **3 passed**. Desktop1280x900/narrow390x844: drag, yaw/roll, wheel, held load, one release commit, volume/temperature, early-release no-op, empty loading, blur stop, nonblank pixel/layout and machine captures.
- Power browser: `tests/e2e/power-hammer.spec.ts --workers=1` -> **4 passed** before the final pressure-only calibration/default updates. Shared input/worker integration was exercised.
- Typecheck passed during integration; final post-calibration typecheck still required. Latest `git diff --check` passed before this handoff doc.
- Full Web/WeChat builds and governance have NOT been rerun for this pressure implementation. Prior committed green checks are not evidence for current source. Existing Web chunk-size warning and untested WeChat hardware remain.
- Model test initial failures were stale parent matrix updates and bevel-aware ray expectations; worker corrected the test helpers. Current full suite passes them. Keep actual geometry bounds/clearance assertions, do not weaken them to fit wrong geometry.
- Optional focused hand-hammer protection after shared changes: `tests/e2e/hammer-overhang.spec.ts --grep off-center --workers=1`. No full crafting chain requested.

## Finish Sequence

1. Fix the explicit pressure calibration/cache discrepancy; verify hot50%-versus65/70%, cold sub-yield, finite stroke, complete platen clearance and baseline replay.
2. Complete/reconcile img2threejs evidence for the existing model. No rebuilding from scratch, new images, or microdetail loop.
3. Review pressure preview/commit safety, then full serial units, typecheck, governance, both builds, diff check, affected power/press browser paths and desktop/narrow images. Do not run heavy physics suites concurrently with browser work.
4. Update current progress/plan and evidence with actual final results. Mark author acceptance pending.
5. Verify local Vite on4199 and open `http://127.0.0.1:4199/?accept=power` and `http://127.0.0.1:4199/?accept=press` for author review. At handoff, press URL returned HTTP200. Existing server process was18940; recheck rather than assuming it survives account switching.

No Git commit, push, reset, or remote fetch was performed in this handoff. The current feature lives in uncommitted local changes, including untracked model/reference files; cloning origin alone will lose this checkpoint.
