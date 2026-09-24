# Workshop reconstruction

## 2026-09-23 pressure experience calibration and placement response

- Resumed the account handoff from the existing dirty checkout. The previous 600 kN calibration produced only about 0.016 mm compression at 65% and 0.057 mm at 70% on the hot spring-steel acceptance baseline, so the player could not read the result in the scene even though the rule tests changed geometry.
- Calibrated `PRESS_RULES.maximumForceN` to 800 kN. The same baseline now compresses about 0.33 mm at 65% and 0.47 mm at 70% after 4 s, while low load and cold material remain below yield and unchanged. Added regressions for the visible 70% response and the below-yield path.
- Restored direct placement feedback for both powered machines: left drag translates the billet along the real table plane, right drag rolls it, and collision/path checks still reject obstructed poses. Added desktop/narrow Playwright coverage for real drag input.
- Fixed powered W/S/A/D input backlog: placement uses cached conservative bounds, stationary machine envelopes are cached, and the latest pose is applied on the next frame with a short coalesced render delay so keyup and held input are not blocked by WebGL synchronization. The focused browser timing regression now records four keys below 80 ms while contact remains supported.
- Evidence: focused press rules 33/33; powered browser suite 8/8 including the <80 ms input regression; typecheck, governance, Web build and `git diff --check` pass. The full serial unit suite is 206/207 because `tests/forge/hammer-support.test.ts` exceeds its 5 s per-test limit under the full parallel run; the isolated case passes in about 2 s. Web retains the existing >500 kB chunk warning.
- Author experience remains pending. Open `http://127.0.0.1:4199/?accept=press` and hold `Space` or hold the `下压` button at 65–70%; use left drag to move the billet and right drag to roll it. The current slice still uses a flat platen; V-shaped tooling remains a separate geometry/physics contract.

## 2026-09-21 account handoff, not final acceptance

- User requests moving development to another Codex account. Implementation stopped; preserve the dirty local checkout on `feat/R1-shaping-flow`, HEAD `2cf5e5c`, ahead one. No new commit/push.
- Current authority for continuation: `docs/CODEX_ACCOUNT_HANDOFF.md`. It records accepted references, working controls/model/core, exact files, verification and finish order.
- Important unresolved discrepancy: pressure core still has temporary maximum force 1 MN; lead intended restoration to600 kN with UI65% default and70% test. Do not lower material yield thresholds to force a50% deformation test. Redundant cross-clone JSON cache remains. Current passing checks do not resolve this calibration discrepancy.
- Full serial unit run completed at handoff:36 files/205 tests pass. Press desktop/narrow/safety E2E3 pass; prior shared power E2E4 pass. Current builds/governance and final model pipeline checklist remain incomplete. Author experience has not been accepted.
- Vite4199 returned HTTP200. Reference images copied into repository; no temporary attachment dependency. Resume from this checkpoint, not older image-generation blockers below.

## 2026-09-21 resumed scope: both machines to experience, new images for press only

- Author supersedes the end-of-day stop: continue power hammer and hydraulic press through prompts, reference images, img2threejs modeling, integration and verification to author experience. Then clarifies that power-hammer references already exist; reuse them and generate only new pressure-machine references.
- Preserve Git checkpoint `2cf5e5c`, accepted power controls and faster nominal cadence. Do not regenerate the power references, reuse the rejected press as accepted art, or implement a press as repeated hammering. This expands authorization beyond the prior power-only stop; no new Git push or scheduled run is implied.
- Prepared `assets/concepts/forge-press-v2-reference-prompt.md`: matching early-industrial, real-proportion low-poly hydraulic frame, guided platen, replaceable flat tool, readable open work area; main view followed by a consistent three-view sheet. Approximate image proportions are not measured engineering dimensions. V-shaped tools/multilayer joining need distinct future geometry/physics contracts, not a fake fusion result.
- Image generation blocker: no built-in image generation tool is exposed in this session. Asked whether author authorizes image API fallback (local key, billable) or will return externally generated images. No image API request, new generated image, model replacement or gameplay edit has been made for this resumed scope yet.

## 2026-09-21 end-of-day Git checkpoint

- Author requests saving the current version to Git and continuing tomorrow. Archive the complete current power-hammer implementation, reference assets, img2threejs provenance/failed-gate history, tests and art decisions on `feat/R1-shaping-flow`. Local commit only; no push or automatic continuation scheduled.
- Reuse the immediately preceding valid checks: 161 unit tests, 4 focused power browser paths, typecheck, governance, Web/WeChat builds and diff check. This checkpoint adds documentation only; no new gameplay changes or full-chain rerun.
- Resume with the original img2threejs model's exterior improvement: cast-body volume and edge treatment, iron/steel/brass differentiation and readable contact-area lighting. Keep the accepted controls and faster 300 ms nominal cycle. Art is still pending; do not advance to the pressure machine or restart microdetail fidelity chasing. Experience entry: `http://127.0.0.1:4199/?accept=power`; verify/restart the server next session if needed.

## 2026-09-21 faster power-hammer cadence; operation accepted, art still pending

- Author says the operation logic is correct, requests faster hammering and asks whether the exterior can improve. This accepts the control logic, not the current speed or art. Keep img2threejs and its reference-driven low-poly direction; next visual work should prioritize cast-body form/edge treatment, material separation and readable lighting before the press. No geometry/material/art changes in this speed update.
- Nominal cycle 500 -> 300 ms (2 -> 3.33 strokes/sec); down/return each 140 -> 100 ms. One impact per stroke, actual physics, captured force, release safety and no catch-up queue remain unchanged. Slow solve/rendering still limits real cadence; 3.33 is NOT a measured guarantee.
- Stop refreshing the full view when powered pose is unchanged. Defer post-impact pose redraw until the new snapshot arrives, avoiding an intermediate render of old geometry. Existing workpiece geometry caching already skipped most identical mesh rebuilds; redundant view updates and rendered frames were the removable work, not a proven repeated full geometry solve. Press still refreshes changed poses normally.
- Timing probe: five held-Space strokes on the same local headless Chromium route. Old start intervals 3520/2657/2409/2617 ms; final 2299/1634/1376/1615 ms. Median interval about 2637 -> 1625 ms (~38% shorter) in this constrained test environment. This is one local comparison, not a cross-hardware benchmark. Solver/contact waiting and rendering remain material limits.
- Checks: typecheck, governance, Web/WeChat builds and diff check pass; serial full unit suite 30 files / 161 tests passes. New regression locks the 300 ms ideal cadence and unchanged-pose redraw suppression. Power browser suite 4/4 passes (43.3 sec), covering desktop/narrow drag/rotation, force, held/released Space, descent release, empty hits and inspection/focus-loss stop. No full crafting chain or additional hand-hammer physics run; core numerical rules are untouched.
- Current desktop/narrow `output/playwright/power-{1280,390}-{layout,operation,machine}.png` captures and canvas-pixel assertions pass; shape/art are unchanged. Existing large Web chunk warning and untested WeChat hardware remain. No commit/push.
- Author check: reset at `http://127.0.0.1:4199/?accept=power`, compare holding Space and releasing with the prior build. Force and geometry per hit should remain unchanged; only timing should feel faster. Next checkpoint is an exterior improvement pass on the existing model, not fine-detail score chasing or pressure-machine implementation.

## 2026-09-20 simplified img2threejs model and playable power-hammer integration

Current stage and checkpoint: power-hammer model/operation slice, awaiting author experience.
Planned objective: retain image-driven modeling and early-industrial, real-proportion low-poly art; reduce detail effort, not modeling or physics requirements.
Actually completed: position and rotate the billet beneath the fixed machine, see its contact preview, hold Space for strokes, release to stop new strokes, and adjust force by wheel.
Available evidence: 159 unit tests, typecheck, Web/WeChat builds, governance, diff check; 4 power input paths and 2 hand-hammer eccentric input paths, desktop and narrow screens.
Not yet verified: author art/feel acceptance, WeChat device behavior, production performance across hardware.
Deviation: fidelity. Fine-pixel materials and final light/sound/VFX are not implemented; geometry remains deliberately approximate under the author's revised scope.
Required experience fidelity now: state readability, visible machine motion and contact.
Deferred but preserved: refined material/light response, timed sound/VFX, then independent sustained-pressure machine and interchangeable tools.
Advance decision: enter acceptance for this simplified power-hammer iteration, not the old exact-replica pipeline or pressure-machine completion.

- This supersedes the earlier wording about replacing img2threejs with manual modeling. The runtime uses the original generated factory, with workshop materials and actual mm conversion. Five structural parts from its spec are added (three covers, circular cover, front oil cup), not a replacement body. Circular cover embeds 2 mm into the frame; top oil cup is lowered 38 mm to meet the cap. Original stopped 4/4 state and failed fidelity scores are untouched.
- Base remains 1050 x 1400 mm; working height 875 mm; open gap 120 mm. Only the ram hierarchy moves. Fixed 48 x 48 mm insert and 224 x 104 mm lower support match the existing hand-hammer solver. Reference holders remain, but are not advertised as a calibrated wide-die material solver. Shared steel transparency leakage from the old press pick proxy is fixed; furnaces and material scale stay unchanged.
- Nominal cadence 500 ms, one recorded operation per real contact. Slow computation delays the next stroke without catch-up. Releasing during descent completes that stroke; empty cycles do not edit material. Blur/hidden tab and inspection stop held input. Placement is locked during a stroke. Left drag translates; right drag uses selected Y turn or X roll axis. Wheel changes the next stroke's force. Preview uses the same clipped material surface as the hand hammer.
- Player causality: placement/rotation changes contact and support; force changes mechanical work and plastic deformation in the shared saved geometry. Repositioning alone does not edit material, volume or temperature. Repeated strikes accumulate permanent shape, while empty strikes do not. The player can contrast centered contact with an empty offset, and lighter with heavier force; exact feel remains author judgment.
- Final checks: typecheck/governance pass; `npm run test -- --maxWorkers=1` 29 files / 159 tests pass; both builds and `git diff --check` pass. Default parallel `npm run check` hit one 5-second hammer-support timeout while browser work was running (158/159); serial rerun passed without changing test budgets or material rules. Web retains the >500 kB chunk warning (~976 kB JS, ~232 kB gzip). No full crafting E2E, commit, push or merge.
- Current browser evidence: `tests/e2e/power-hammer.spec.ts` 4/4, including real dragging, both rotation axes, wheel, held/released Space, single descending stroke, empty cycle, inspection and focus-loss safety. `hammer-overhang.spec.ts --grep off-center` 2/2 confirms desktop/narrow 12-blow continuity. Blur is additionally dispatched because headless window focus is not reliable; this is not an OS-focus certification.
- Screenshots inspected: `output/playwright/power-{1280,390}-{operation,layout,machine}.png`, plus `power-model-{reference,right,front,closed,mobile}.png`. Gameplay canvas nonblack >99.97%, luminance deviation 24.59-47.54. Model reference/mobile deviation 71.26/63.34. These prove nonblank rendering, not material physics or author art approval. Narrow controls no longer split labels from their sliders.
- The independent model viewer `.img2threejs/power-hammer-v2/preview/integrated.html` imports the SAME runtime factory. It is a modeling inspection artifact, not a second gameplay room. Workshop neighbors remain visible; its whole-device camera can still show foreground parts of the old press. Operation camera keeps the die and billet visible.
- Limits: shared reduced physics, center-sampled contact (edge-only overlap may still count as empty), conservative machine collision proxies, destination-only neighbor checks, Y/X rotations rather than arbitrary XYZ manipulation. No industrial contact/rigid-body solver. Old pressure-machine mechanics/model remain unaccepted and are not rebuilt here. This iteration does not claim final REPLACED-like lighting or pixel art.
- Author path: open `http://127.0.0.1:4199/?accept=power`, reset; hold/release Space, wheel force, left-drag billet, select axis and right-drag, compare empty placement with centered contact. Use the independent model viewer for unobstructed shape inspection. No spontaneous deformation, continued firing after release, floating moving parts or UI covering the billet should occur. Author judges silhouette, art consistency and whether changing placement/force is understandable.
- Next after author acceptance: continue the same img2threejs-based low-poly style with necessary contact-synchronized feedback, then rebuild the pressure machine as sustained loading; no renewed microdetail/score-chasing loop.

## 2026-09-20 author-approved simplified model scope

- Author explicitly accepts reasonable shape, usable operation and consistent art instead of a highly detailed reference replica. Current standard is in docs/ART_DIRECTION.md; reference-first analysis is retained, automatic fidelity chasing is superseded by manual procedural modeling.
- Preserve the reference assets, blockout body/ram hierarchy and failed 4/4 img2threejs history. No threshold changes, no retroactive approval. Current work is NOT author-accepted art or powered gameplay.
- Reuse candidates: main C-frame, cylinders, pedestal, aligned dies and separate ram. Necessary next work: workshop-compatible materials, actual assembly/clearance checks and same-scale room fit, then held-Space strokes, wheel force, workpiece positioning/rotation and shared contact preview. Decorative hardware and wear can wait; physical and contact requirements cannot.
- This update changes the agreed scope and documentation only. No gameplay, geometry, save format, old-device deletion, commit or push in this update.

## 2026-09-20 authorized fourth blockout correction

- Evaluated the one additional authorized correction, without changing src gameplay. Primary-image proportions now control the base, front/rear cylinders and anvil; the six-view sheet is supplementary. Buttress profiles are reflected with corrected winding. Camera calibration remains approximate, not a solved reference camera.
- Current captures: `.img2threejs/power-hammer-v2/preview/refined-{reference,front,right,rear,left,top,controls,mobile}.png`. Strict spec validation and standalone generated-factory TypeScript check pass.
- Real browser controls verify 120 mm open gap, 0 mm closed gap, moving ram with fixed lower die, lower working face 875 mm, floor 0 mm and shared die axis X/Z=(0,500). Base measures 1050x170x1400 mm. Narrow viewport 390x844 has scrollWidth 390 and header bottom 85 px. These are model-preview checks, not powered forging or collision validation.
- Tier1 still FAILS: IoU 0.8427 < 0.85; aspect delta 0.0194 <= 0.05 and scale delta 0.0729 <= 0.08 now pass. Previous 0.7491 comparison is historical. No Tier2 visual score or pass approval; attachment, self-intersection, full material and gameplay checks remain incomplete.
- Fourth correction recorded; no further automatic correction authorized. User raised unacceptable elapsed time. Stop score-chasing and discuss a revised delivery approach before more modeling. Preserve references, spec, factory and all history; do not lower thresholds or treat this blockout as accepted.
- Previous project unit/build evidence predates this isolated model correction; it was not rerun and is not new-model acceptance evidence. No full crafting chain, commit or push. Internal preview server restored on 4201, not opened as a gameplay acceptance entry.

## 2026-09-20 power-hammer v2 blockout: stopped at correction limit

- Resolved the failed JSON patch using exact on-disk text. Authored 30 components and 14 mapped reference details; strict-quality validation passes. Three inspected material crops each produced 0.86 extraction confidence at 0.7 threshold. These estimates do not validate physical PBR or rendered material likeness.
- Generated the blockout-only factory and independent preview under .img2threejs/power-hammer-v2/preview. No src gameplay changes or replacement of old equipment. Development server is localhost:4201; preview is an internal working artifact, NOT an accepted equipment experience.
- Corrected generator/spec semantics: explicit unit transform.scale overrode millimetre dimensions; centered rotational solids now use closed lathe profiles instead of attachment-derived cylinders. Extrusion offsets account for non-centered local depth. Promoted silhouette-defining collars and ribs into blockout and sampled curved throat profiles.
- Browser measurements: lower working face 875 mm, open die gap 120 mm, closed gap 0 mm, base min Y=0, die center X/Z=(0,550). Real slider Home/End and Motion checkbox work; lower die stays fixed while ram moves. No page errors in the measured path. Narrow 390x844 view has no horizontal overflow, header bottom 85 px. These tests do not exercise workpiece contact or deformation.
- Six view captures exist; multi-angle collapse test passes with front/reference area ratio 0.483 and right/reference 0.902. Desktop/mobile pixel standard deviations 68.17/61.25 and non-background fractions 0.492/0.300 establish nonblank rendering only. Preview render statistics: 4738 triangles and 33 draw calls including shadow/ground rendering, not whole-workshop performance.
- Latest calibrated map-stripped reference comparison FAILS: silhouette IoU 0.7491 (required 0.85), aspect-ratio delta 0.0532 (max 0.05), scale delta 0.1133 (max 0.08). Do not change thresholds to obtain a pass. Front/rear silhouette, buttress orientation and camera/reference matching remain unresolved; full attachment/self-intersection and material gates have not passed.
- State tool now reports stopped: max-correction-loops-reached:blockout:3/3 (3/6 total). No pass is approved. Explicit user direction is required before extending correction work; preserve this state and evidence rather than reinitialize to bypass the bound. Recommended next scope: one focused reference-derived geometry/camera correction, then rerun the same gates, not material decoration or powered gameplay.
- Verification: generated factory standalone TypeScript check, project typecheck, Web and WeChat builds, governance and diff check pass. Parallel unit run hit two existing hammer timeouts (152/154); after closing the preview, serial run with unchanged assertions/timeouts passed all 154 tests in 27 files, 42.84 seconds. No full crafting E2E chain. Web retains the existing >500 kB bundle warning; no WeChat device verification.


## 2026-09-20 power-hammer v2 reference intake

- Author supplied the externally generated main reference and six-view sheet, then authorized the reference-analysis/specification stage. Copied both original PNGs into assets/concepts/power-hammer-v2-{main,views}.png; old equipment and old pipeline state are untouched.
- New local authority: .img2threejs/power-hammer-v2/state.json. Image analysis, conditional suitability, deterministic admission, focused local search and pre-spec assessment are recorded with evidence. Main image admission passes (1122 x 1402, foreground coverage 0.537, largest component fraction 1.0); these numbers are not a mechanical or visual fidelity pass.
- docs/POWER_HAMMER_V2_INTAKE.md records observed/inferred structure, coordinate convention, provisional size table, moving hierarchy and quality contract. Lower work face remains 875 mm. All other proposed dimensions require blockout/workshop clearance validation; larger powered dies require their own contact/load calibration.
- Next gate is detail-inventory. Crop files and a sculpt-spec starter exist but are NOT completed evidence: detail-to-component mapping, projection/material evidence, full sculpt authoring and strict validation remain pending. No mesh generated, no runtime changed, no new gameplay or model acceptance claimed.
- This is an analysis/asset checkpoint only. Validate documentation and asset integrity here; run geometry/browser/build gates after implementation, without repeating the full crafting chain.

## Powered equipment restart: art alignment

- Author rejected both current powered devices as failing basic functionality. Continue grill-with-docs before new implementation; evaluate old equipment work for reuse or deletion after alignment. Prior test passes do not establish acceptance.
- Confirmed art choices are recorded in docs/ART_DIRECTION.md: early industrial setting, real proportions, fine pixel texture with readable continuous workpiece geometry, REPLACED-inspired lighting/feedback, fixed operation camera plus inspection views, side daylight and local furnace warmth, desktop-first quality with mobile downgrade paths.
- Confirmed power-hammer controls: hold Space to repeat; release prevents the next strike, while an already descending stroke completes contact and return. Mouse dragging/rotation positions the workpiece; wheel adjusts force; cadence is fixed, not a player control. Repositioning requires clearance and respects contact constraints.
- Author confirmed left-drag translation, right-drag rotation with axis selection, and an early pneumatic hammer with enclosed cast-iron drive body and front/side-open tooling space. Added hand-hammer-equivalent live contact-region preview following current geometry, not a promised deformation boundary.
- Next: new power-hammer reference, author confirmation, then matching orthographic/detail views before img2threejs. Exact cadence awaits sample calibration; axis widgets and depth mapping remain implementation details. Power hammer first, press second. No new gameplay or image generation performed in this documentation checkpoint.

## 2026-09-18 author-specified reference-first equipment pipeline

- Author corrected the equipment sequence: image prompt -> generated reference -> img2threejs modeling -> operation/physics/feel. Apply this to both power hammer and hydraulic forging press, power hammer first. Reference modeling is a prerequisite, not deferred final art.
- Git checkpoints remain 87d8882 (physics-9 code) and c243270 (equipment design). Current changes only update workflow documents and create assets/concepts/power-hammer-reference-prompt.md. No new model or gameplay implementation.
- Main reference prompt uses one complete three-quarter object view, neutral background, visible mechanism and dies. Additional views must follow the same design. Shared scale dimensions are distinguished from provisional dimensions inherited from the placeholder.
- Reference generation has not run: uv and bash are unavailable, Python 3.11.3 works, but GEMINI_API_KEY is missing from the process environment. Do not claim a reference exists or begin img2threejs without one. The user's requested model route is procedural img2threejs, not Tripo or a downloaded substitute.

## 2026-09-18 requested Git checkpoint before powered equipment

- Author requested saving the current version to Git and continuing, and asked whether power-hammer/hydraulic equipment can begin. Archive the complete current physics-9 development state on feat/R1-shaping-flow, including prior contact facts and the previously recorded grinding E2E wait correction. No merge or release is implied.
- The immediately preceding verified source is unchanged: 29 focused hammer rule tests, 8 distinct hammer browser paths (corner rerun with a 60-second case budget), typecheck, Web/WeChat builds, governance and diff check passed. Do not rerun the full crafting chain; the author's hammer-only regression instruction remains active. This checkpoint is a development archive, not a claim of general physics fidelity or additional explicit experience approval.
- Continue with a powered-equipment design/technical checkpoint: power hammer first; hydraulic forging press requires its own sustained-load contract. Keep their contact/shape state shared, preserve the user's fixed-hand-hammer decision, and do not implement a press as repeated hammer operations.

## 2026-09-18 eccentric-load continuity correction, physics-9

- Author found a remaining physics-8 defect: an eccentric edge strike folded only half the width while the other half stayed straight. A full-size 336 mm / 1007 C spring-steel test reproduced it with ONE strike at pose x=100, target (105,18), energy 0.8: tail cross-section chord residual 2.01434 mm. Moving target z from 7.9 to 8.1 mm changed the opposite-side displacement by 0.60423 mm.
- Diagnosed source: the aim-dependent `wholeSection` flag switched from a common section to a width mask that became zero on the far side. Endpoint-only selection of the boundary cross-section also made its width jump by a mesh cell. Contact traces on either side of the threshold had identical sample forces/lever arms, excluding the pressure sampling as the main cause; the failure already existed in the core nodes, excluding a render seam.
- Fix: continuously clip support intersection segments. Use the complete support section for slender overhang bending, and include signed eccentric torque about its centroid. A Saint-Venant rectangular torsion estimate supplies a bounded residual section rotation; width and height rotate together. Bending/torsion share the edge work/travel budget. Geometry-only aspect-ratio blending (overhang length/section width 0.5 to 1) retains the broad short-strip approximation without an aim-dependent switch. This remains a reduced model, not solved plate mechanics.
- Parameter version is physics-9; state remains forge-state-5. Old saved geometry and plastic history are preserved, with no retroactive correction and no old-version replay engine. No new hammer shape, bend mode, support type, furnace change or unrelated gameplay work.
- Verification: 4 hammer rule files / 29 tests pass. New cases include one-blow reproduction, old-threshold micro-movement, continuous section width, 90-degree boundary rotation, opposite-side torque direction, 12-blow mirror/conservation and deterministic save/replay. The repeated eccentric tail chord residual is approximately 0.0002 mm (test limit 0.01 mm), rather than a prescribed equal-height condition.
- Eight distinct hammer browser paths pass. Real 80% centered and off-center twelve-blow sequences pass at 1280 x 720 and 390 x 844; the latter uses the opposite side. All committed counts, full transverse profiles, longitudinal tail straightness, side-dependent tilt, material-volume records, error checks and canvas/control separation pass. The corner test initially reached its 30-second total timeout after the blow had committed; isolated rerun with a 60-second case budget passed in 30.0 seconds. Both eccentric paths were then rechecked after the parameter update and inspection captures.
- Typecheck, governance, Web/WeChat builds and diff check pass. Only hammer regressions were run; no full crafting workflow or full unit suite. Existing Web chunk warning remains; WeChat has no device verification. Repeated mirror/replay unit case has a specific 20-second budget because it executes 36 full-size deformation operations; no assertion was removed.
- Screenshots reviewed: output/playwright/eccentric-{1280,390}-{before,after,front}.png. Canvas-only before/after pairs are nonblank (99.91%/100% nonblack, pixel deviations 56.54/56.56) and change by 650/728 pixels. Numeric assertions establish continuity; screenshots/pixel change alone do not establish mechanics.
- Limits: constant sampled rectangular section capacity, approximate separate bending/torsion yielding and budget split, small increments, smooth beam/strip blending and global volume correction. No torsion warping/warping restraint, coupled yield surface, general wide-plate solution, deep-notch stiffness, contact dynamics/friction, elastic recovery or fully coupled energy solve.
- Author check: refresh http://127.0.0.1:4199/?accept=hammer and reset; move right 100 mm (25 Right Arrow taps), choose 80%, aim near the right support junction and one width-side (about z=18), strike repeatedly, then reset and compare the other side. Both edges may differ in height because of section rotation, but the width must remain connected rather than form two independent flat strips. Await this experience judgment before adding other supports. No commit/push/merge this round.

## 2026-09-18 full-size right-overhang correction, physics-8

- Author reported that a blow at the right support junction still rapidly curled the remote end into a U. Testing is explicitly limited to hammering; no complete crafting chain or full unit suite was run this round. Existing contact vectors, furnace placement and other uncommitted work are preserved.
- Reproduction gap: earlier rule fixtures used 64 sections (128 mm), whereas the browser sample is 168 sections (336 mm). A new full-size spring-steel/1007 C fixture failed against the forced-return deflection pulse: loaded material fell while the remote tail was forced back to its original y, introducing reverse curvature without a physical support there. Tail motion is not itself strain and must not be forbidden.
- Replaced that prescription with sampled section moment M(s)=sum(F_i*max(d_i-s,0)). Excess above plastic section capacity supplies curvature, integrated into rotation and displacement. Allocated work, tool travel and per-blow angle bound its magnitude. Unloaded tail inherits the tangent without new curvature. Narrow sections within the footprint plus one thickness on each side bend coherently; wider sections retain the local-strip approximation. Footprint boundaries include half a sampling cell to avoid artificially unloaded side strips.
- Parameter version advances to physics-8; forge-state-5, saved geometry, plastic history and same-version determinism are retained. There is still no old-physics replay engine; resetting the acceptance sample is required for a clean comparison, not as a migration strategy.
- Technical checks: 3 focused rule files / 22 tests pass, covering full-size repetition, hot/cold and energy contrast, mirror/yaw, finite cuts, half-width locality, corner paths, grounding, conservation and save/replay. Six hammer-only browser paths pass, including 12 real 80% blows at the right boundary on both 1280 x 720 and 390 x 844. Every hit commits; longitudinal tail collinearity and transverse cupping remain within 0.002 mm; material-volume records stay unchanged. No page errors, horizontal overflow or canvas/control overlap in those paths.
- Typecheck, Web build, WeChat build and git diff --check pass. Web retains the existing >500 kB chunk warning; WeChat was not device-tested. Canvas pixel checks: desktop nonblack 99.91%, luminance deviation 56.54, 764 changed pixels; narrow nonblack 100%, deviation 56.56, 876 changed pixels. Screenshots reviewed: output/playwright/moment-{1280,390}-{before,after}.png. Changed pixels establish rendered change, not physical correctness; geometry assertions provide the latter limited evidence.
- Limits: reduced held-strip plastic increment with constant sampled section capacity, calibrated force and small-angle kinematics; no elastic rebound, contact dynamics, solved pressure/friction, arbitrary supports, exact notched/wide-plate stiffness or fully coupled energy balance. Narrow-section coherence is a beam approximation, not a plate solver.
- Author check: http://127.0.0.1:4199/?accept=hammer, reset, move right 25 arrow taps (100 mm), set 80% force, strike around the right support junction 12 times, then inspect the front view. The tail may lower/tilt while staying straight beyond the yielding region; it must not curl upward or become transversely cupped. Compare lighter force and confirm repositioning preserves deformation. Await this experience judgment before expanding support descriptions. No commit, push or merge this round.

## 2026-09-17 reusable contact facts and corner load

- Author accepted the finite propagation result as looking very good. Advanced to the planned narrow checkpoint without running the full workflow regression.
- `HammerContact` now exposes the downward impact normal. Each crossed support boundary exposes an outward normal, tangent, resultant load path and actual material support-section path. The deformation step consumes these vectors for distance, localization and displacement instead of branching directly on the X/Z axis.
- Added a rectangular-anvil corner case: a billet shifted 100 mm right and 40 mm across, struck at `(105, 58)`, yields independent +X and +Z boundary paths. Two focused rule files pass 18 tests; the new corner rule preserves geometry volume within 0.002%.
- Focused desktop E2E passed through real arrow-key placement, pointer aim and click. A separate 390 x 844 Playwright CLI pass reported two paths, unchanged recorded volume, no page errors, no horizontal overflow and no canvas/control overlap. Captures: `output/playwright/contact-paths-narrow-{before,after}.png`; measurements: `output/playwright/contact-paths-verification.log`.
- No grinding code or unrelated station behavior changed. No full gameplay/workflow suite was run for this checkpoint. Next: author checks whether the corner response is readable; after acceptance, introduce one non-axis-aligned or non-rectangular support description without changing the fixed hammer or adding a bend mode.

## 2026-09-17 resumed verification of physics-7

- Continued the existing uncommitted finite-propagation correction on `feat/R1-shaping-flow`, based on `de5ddf1`. No new bend mode, furnace change, or general contact solver was introduced. Corrected the stale current branch/checkpoint at the top of `PROJECT_PLAN.md`.
- `npm run check` passed: governance, typecheck, 24 unit files / 139 tests, Web and WeChat builds. The changed rules include mirror/yaw symmetry, local deformation, finite tail slope, volume conservation and deterministic save/replay. Independent read-only review found no concrete defect in the pulse delta; multi-hit symmetry could use stronger near-field comparison in a future extension.
- The full browser run passed 22/23 paths. The remaining continuous-workflow failure was reproduced in isolation: the automation released the grinding contact before a 160 ms update could remove material. Only `tests/e2e/forge-operation.spec.ts` changed, now waiting for actual removed volume to increase before releasing the held mouse. The original completion, identity and error assertions remain; the corrected full-chain path passed twice. No grinding product code changed. Subsequent typecheck, governance and diff checks passed.
- Fresh real-input checks on 1280 x 720 and 390 x 844 passed central compression, five 80% edge blows after moving right 100 mm, half-width overhang, and repositioning without lost deformation or anvil penetration. Center tail-height difference stayed zero. Five edge blows produced approximately 0.0874 mm relative tail lowering; half-width loading produced 0.2310 mm local lowering with zero measured far-section change. The small visible bend is an author readability question, not permission to amplify the rule toward a target shape.
- Captures: `output/playwright/physics7-{desktop,narrow}-{center,before,after,repositioned,half-width}.png`. Each viewport has 90 motion samples, nonblank/pixel-change checks, unchanged recorded material volume, and no page/console errors during the scripted pass. A first browser open separately logged a favicon 404 and the existing shader precision warnings; these are not represented as a zero-error initial load. Evidence JSON: `output/playwright/physics7-evidence.json`.
- Narrow controls scroll inside their panel; the overview button was brought into the visible viewport and captured in `physics7-narrow-controls.png`. Narrow checks use mouse/keyboard at the smaller viewport, not touch-device certification. Rendering still uses 192 desktop / 176 narrow draw calls; optimization and WeChat device review remain pending.
- Review entry: `http://127.0.0.1:4199/?accept=hammer`, served by `npm run dev:codex`. Current geometry awaits author experience acceptance. Next after acceptance: extend reusable load/support/contact facts for additional strike directions; retain the fixed square hammer and accumulated deformation history. No commit, push or merge performed in this continuation.

## 2026-09-17 finite normal load-path correction

- Author rejected the remaining edge response after observing that repeated blows at the supported/overhanging junction rotated the whole free tail into a U-shaped result. The red rule test reproduced the core geometry error: after five blows the remote overhang retained a slope of about `0.03448`, despite being outside the hammer footprint and local propagation path.
- Cause: the previous tangent localization fixed how far a blow spread *along* an anvil edge, but its normal response still used a finite circular hinge followed by rigid rotation of every remaining unsupported node. Repeated blows therefore accumulated a permanent angle across an arbitrarily long free tail.
- `physics-7` replaces that infinite tail rotation with a continuous finite residual-rotation pulse. Rotation rises from the support edge, peaks at the sampled load centroid, and decays to zero after the occupied hammer footprint plus a thickness-scaled propagation band. The remote tail can inherit a bounded continuous offset, but not an unbounded per-blow angle. The model remains a deterministic impact/inertia approximation, not static beam theory or dynamic finite elements.
- Focused evidence now covers near-field deformation, grounded support, remote-tail orientation, opposite-edge symmetry, 90-degree yaw symmetry, half-width tangent localization, volume conservation and deterministic save/replay. Five right-edge blows leave a remote slope near `0.000078`; the mirrored case is equal and opposite, and the yawed case remains near `0.000093`.

## 2026-09-17 half-width overhang localization correction

- Author found that moving half the width beyond the anvil and striking the overhang made the whole billet bend. The red regression measured the actual symptom: the loaded overhang section moved about `-0.330 mm`, while a far length section was incorrectly moved about `-0.018 mm` by the same blow.
- Cause: edge bending checked only the unsupported direction (`x` or `z`) and applied the residual rotation to every node beyond that edge. It did not retain where the hammer load entered along the edge, so a local width-overhang impact became a full-length strip load.
- Fix: each `HammerEdgeLoad` now stores the loaded footprint's tangent center and half-span. Residual rotation is multiplied by a smooth compact falloff outside that span, with a transition based on the loaded cross-section thickness. The fixed 48 x 48 mm hammer remains unchanged; no shape-target or aspect-ratio control was added.
- Evidence: the focused rule test and real browser test both pass. In the half-width case, the center overhang section bends about `-0.330 mm` while the far section remains within `0.01 mm`; browser contact diagnostics report `axis=z`, `boundary=52 mm`, `loadFraction=1/3`, and `supportRatio≈0.61`. Existing edge T6 still passes with about `1.003 mm` tip drop; volume and replay checks remain passing.
- Next: generalize the contact description beyond a single rectangular anvil edge: preserve contact normal, loaded path, support path and boundary collision facts, then validate other support layouts and strike directions. This remains a reduced deterministic model, not a full finite-element or dynamic contact solver.

## 2026-09-17 end-of-day checkpoint

- Author requested Git checkpointing and will resume tomorrow. Branch: `feat/R1-shaping-flow`; workspace: `D:/打了个铁/Weapon-Forger-hammer`. Preserve this branch as the continuing development line; the new contact-foundation implementation has not received author experience acceptance yet.
- Resume from `docs/HAMMERING_HANDOFF.md` (current technical positioning) and the verified implementation below. First reproduce the existing center/edge hammer contrast, then extend reusable contact/load/support facts for further strike-driven bending. Keep the fixed square hammer; no face-aspect control or target-shape shortcut.
- Experience: `http://127.0.0.1:4199/?accept=hammer`. If the server stopped after shutdown, run `npm run dev:codex` from this workspace. Local screenshots/measurement JSON remain under `output/playwright`; verification conclusions are recorded below.
- This checkpoint archives source, focused regressions and handoff documentation on the feature branch. No merge or release is part of the end-of-day request.

## 2026-09-17 finite support: first contact-foundation case

- Author clarified that impact/contact feedback is underlying technology for future player-driven bending and other deformation. The edge case below validates one boundary condition; it does not complete general bending or introduce a selectable bend mode. Keep the fixed 48 x 48 mm hammer.
- `hammerContact` now exposes contact thickness and estimated edge loads from occupied footprint samples and edge cross-sections. `deformSurfaceHammer` uses temperature-dependent yield, section capacity and a bounded residual beam rotation. `hammerFrame` grounds only material over the finite anvil rectangle, so a hanging tip no longer lifts the supported work off the anvil. Geometry guards and volume correction remain active.
- Added five support regressions: hot/heavy versus light/cold, unloaded/fully supported strikes, opposite/yawed edges, finite-cut preservation, repeated grounding/repositioning/conservation/save/replay. Parameter version is `physics-6`; state structure stays `forge-state-5`, with no old-version physics replayer.
- Corrected benchmark counting so T1's 40 blows really means 40; it remains informational. Full bench: T2/T3/T4/T5/T6 pass. T1 span 8.00 -> 6.86 mm, T6 one hot high-carbon edge blow gives 1.098 mm relative tip drop with 0.00049% volume drift; 40-blow T4 drift 0.004%, deterministic replay.
- Browser verification uses actual arrow keys, wheel, pointer clicks and reposition button on 1280 x 720 and 390 x 844. Three 80% edge blows on the acceptance sample give approximately 0.774 mm relative tip drop, unchanged material volume and preserved geometry after repositioning. Fixed a narrow CSS override that extended the canvas behind controls; fixed a pre-event animation-frame timestamp causing upward hammer overshoot at strike start.
- Verification: governance/typecheck/24 unit files (136 tests)/Web and WeChat builds pass. E2E initially passed 20/22 while concurrent browser instrumentation was running; the failed grinding and complete-workflow paths each passed in isolated reruns without product or test changes. Dedicated desktop/narrow hammer input, layout, animation and canvas checks cover the final scoped changes. Captures and measurements: `output/playwright/support-{desktop,narrow}-{before,after,repositioned}.png`, `support-evidence.json` and `support-verification.log`.
- Limits: stable holding, sampled footprint and rectangular section-capacity approximation; no dynamic contact pressure, friction, elastic rebound, arbitrary supports, horn/body collision or exact deeply notched/wide-plate stiffness. Impact energy is a reduced calibration, not a solved energy balance for compression plus bending. Existing bundle warnings remain; WeChat is build-checked only. Narrow rendering is above the skill's initial 150-call/200-geometry budget in calls only (176 calls, 160 geometries); draw-call optimization is not part of this physics change.
- Next: extend the contact/load/support description with material-path and contact-normal evidence, then validate additional strike-driven bending cases and physical motion/contact timing. Do not revive face-aspect controls or erase accumulated plastic-strain history. Furnace layout preserved; subsequent Git checkpointing is recorded above.

## 2026-09-16 shaping direction correction: fixed hammer, physical boundaries

- Author rejected tool-face aspect or a rectangular hammer as a control for choosing draw-out versus spread. The hammer remains one fixed traditional flat-faced tool; face aspect and face orientation are not gameplay variables.
- Direction must emerge from physical boundary conditions: strike position, workpiece pose, temperature, impact energy, contact/friction, finite anvil support and nearby free surfaces. The solver must not steer material toward a requested product dimension.
- The old T1 target (40 blows must thin 120 mm to 5 mm) is now an experience measurement, not permission to distort the flow rule. T2 is evidence of different free-surface boundary responses, not a direct directional control. T3 truthfulness, T4 conservation/replay and T5 locality remain hard constraints.
- The existing uncommitted T6 benchmark for anvil reaction is preserved. Next implementation target: replace the current boolean support gate with a finite support reaction so a supported blow compresses against the anvil while an overhang responds at the anvil edge. Feedback must display the resulting contact and motion rather than a synthetic direction cue.
- Accumulated plastic strain remains a history fact and must not be erased on heating. If repeated hot work is too resistant, dynamic recovery/recrystallization must reduce its contribution to hot flow stress without deleting deformation history.

## 2026-09-16 shaping branch: radial flow (author feedback)

- Author found that hammering one middle spot kept extending the sides. Measured cause: the flow kernel was separable, so lateral displacement depended only on the axial offset and every blow translated the whole axial band outwards. 40 blows at one spot took the local width 48.0 -> 96.9 mm while the thickness span never moved.
- Fix: the flow is a radial isochoric map, compression as a function of radius with the outward displacement satisfying `(r+u)^2 = r^2 + 2*integral((1/s-1)*r dr)`, so it decays like 1/r. Same 40 blows now give 48.0 -> 57.5 mm with falling increments, and the station 40 mm away moves only to 50.8 mm.
- Trade-off: T1 is red again (120 mm span 8.00 -> 6.84 mm in 40 blows, was 4.90). Part of the old speed was the non-physical far-field translation. T2 separation 98%, T3 feedback 0.00% error, T4 drift 0.005% with byte-identical replay, T5 locality ratio 0.03.
- Superseded: tool-face aspect was proposed to bring T1 back without losing T5, but the author rejected that control scheme. Continue with finite anvil reaction and physically grounded hot-flow calibration.

## 2026-09-16 shaping branch: free-surface flow

- Frozen state: commit `cdd13ed` on `feat/R1-hammer-continuous` (dual furnace, truthful facts, non-bricking hammer guard, capability loop). New work happens on `feat/R1-shaping-flow`.
- `npm run bench:hammer` is the capability loop: T1 shaping speed, T2 directional freedom, T3 feedback accuracy, T4 conservation/replay. A non-zero exit means a target is unmet; it is a target gauge, not part of `npm run check`.
- Change: the blow's lateral outflow now aims at the nearest free surface, read from the placed surface at the contact (`freeSurfaceReach`/`lateralFlowWeights` in `hammer-surface.ts`). Placement therefore selects the flow direction instead of the model picking one shape.
- Measured (`npm run bench:hammer`): mid-bar blow dL/dW = 0.14 (dL +0.41, dW +2.90 mm) - spreads; near-free-end blow dL/dW = 1.04 (dL +1.61, dW +1.54 mm) - draws out; separation 86% against a 25% target. T2 now passes; T3 (length error 0.00%, span thickness error 0.24%) and T4 (geometric drift 0.003%, byte-identical replay) still pass.
- Still red: T1 - 40 deliberate blows take a 120 mm span from 8.00 to 6.38 mm in 8.2 s (204 ms/blow). Likely cause: `plasticStrain` never recovers on reheat (`applyHeat` restores only stress and elasticStrain), so each blow after the first moves less material, and the per-blow cost is unchanged. Next candidates: work-hardening recovery on reheat, then tool-face aspect, then anvil support/overhang, then per-blow cost.

## 2026-09-16 hammer facts correction (shape must agree with numbers)

Measured on the current rules layer (high-carbon steel, heated to 1050 C, default 168-section billet):

| | real size (mm) | `ForgeFacts.totalLength` | mean thickness | thinnest |
| --- | --- | --- | --- | --- |
| initial | 336.0 x 48.0 x 8.0 | 336 | 8.00 | 8.00 |
| 1 blow | 337.0 x 49.0 x 8.0 | 337 (was 418) | 7.81 | 7.13 |
| 16 blows | 347.4 x 49.6 x 8.0 | 347.4 (was 865) | 6.75 | 4.59 |
| 40 blows | 359.5 x 50.5 x 8.0 | 359.5 (was 1408) | 5.75 | 3.01 |

- Two reported facts were not describing the workpiece. `totalLength` summed per-section spans, and a deformed lattice spreads a span without filling it, so it over-reported by up to 3.9x (this feeds `WeaponResult.reachMm` and `balanceOffsetMm`). `averageThickness` averaged each section's vertical span, which the 8 mm edge strips a 32 mm hammer face never reaches pinned at the original billet thickness no matter how far the piece was drawn out.
- Both now come from the material itself: length from the occupied axial extent, thickness from material columns (one axial x lateral position, summing the stacked cells' heights — a single cell is only 2 mm because the billet is four cells tall). `minimumThickness`, `maximumThickness` and `sectionProfile` (per station: axial position, thickness, width, volume) are new, so a downstream weapon consumer can finally read the actual profile.
- Regression: `tests/forge/forge-facts.test.ts` asserts volume conservation, a real thickness drop after hammering, and deterministic repetition; the earlier implementation fails it.
- Gates: governance, typecheck, `npm run test` (23 files / 130 tests), `build:web`, `build:wechat` all pass.
- Still wrong for real forging, and next: one blow only thins the hit patch (the middle column reads 6.19 while the outer five columns hold 8.00 — a groove, not a blade), 156-260 ms of rule time per blow, no directional control between drawing out / spreading / tapering, and the anvil is still a boolean gate that rejects unsupported hits instead of reacting to them.

## 2026-09-16 dual-furnace layout correction

- Author decision: the tempering furnace belongs immediately to the right of the heating furnace. It now stands at `WORKSHOP_LAYOUT.temper = [156, 0, -135]`, on the same hearth line as `furnace = [76, 0, -135]`, leaving roughly 280 mm between the two bodies.
- The previous placement at `[-92, 0, -125]` sat inside the selection table: the measured meshes interpenetrated over roughly 58 x 100 scene units, which failed `tests/render/workshop-models.test.ts` before this correction.
- The rendered room is narrower than the declared layout rectangle: `roomAsset` narrows x by `ROOM_SCALE_X = 0.72`, so the finished side-wall interior is at `|x| ~ 195`, not the 214 the old test allowed. Those wall dimensions are now exported as `ROOM_INTERIOR`, `roomAsset` authors from the same constants, and the geometry test asserts every station against the real interior faces.
- The tempering unit is a mirrored station: its temperature dial sits on the aisle side (`-x`) and its close-up camera approaches from the aisle (`temperCameraFrame`, lateral `-1`), which keeps the camera inside the room and the dial visible and pickable. Dragging the workpiece follows the pointer in both furnaces, so the temper insertion drag uses the opposite horizontal sign (`dragTemperInsertion`).
- Acceptance test corrected: `forge-acceptance.spec.ts` previously asserted that heating and tempering shared one camera frame, which encoded the removed shared-furnace behaviour. It now asserts two independent furnace frames, a restored temper frame, retained workpiece identity and a completed temper step.
- Verification on this revision: governance, `npm run typecheck`, `npm run test` (23 files / 129 tests), `npm run build:web`, `npm run build:wechat`, `git diff --check` and `npx playwright test --workers=1` (22 tests) all pass. Current captures: `output/playwright/desktop-{overview,furnace,temper}.png` and `output/playwright/narrow-{overview,furnace,temper}.png`; `__forgeInspect()` reports the heating camera at `[120,98,0]` and the tempering camera at `[112,98,0]`, both inside the room, with no page errors.
- Still open for author review: the desktop tempering frame includes part of the heating furnace at the left edge by design (the two-furnace bank is visible); the power hammer remains a visual reservation.

## 2026-09-16 plan alignment and next checkpoint

- Author-confirmed baseline: materials, cutting, heating, hammering, whole-piece quenching, tempering and grinding have passed basic experience review. Welding remains deferred and unaccepted; the power hammer and hydraulic plasticity remain future scope.
- The project has entered `R1-C` single-workpiece chain verification. This checkpoint validates continuity across the existing operations rather than adding new mechanics: identity, geometry, volume/loss accounting, temperature, stress, damage and process history must survive station transitions.
- The continuous chain and downstream `ForgeFacts` consumer are now verified. Final art, sound and feel tuning remain deferred.

## 2026-09-15 completion checkpoint

- Three.js is installed as the real runtime dependency: `three@0.185.1` and `@types/three@0.185.1`; source imports `WebGLRenderer`, `three/addons`, and `RoomEnvironment`.
- Author correction (2026-09-16): heating and tempering require two independent furnaces. The renderer now owns separate furnace origins, workpiece rigs, targets and camera frames while preserving the shared thermal-state contract.
- Restored the thermal contract (`thermalTimeScale=6`) and saw travel contract (`sawTravelLength=90`); retained keyboard compatibility for the quench acceptance path and center-tolerant hammer picking.
- Verification: governance, `npm run test` 23 files / 127 tests, `npm run typecheck`, 22 Playwright E2E tests with one worker, `npm run build:web`, `npm run build:wechat`, and `git diff --check` all pass.
- Current visual captures: `output/playwright/desktop-temper.png` (`1280x720`) and `output/playwright/mobile-temper.png` (`390x844`). Narrow view is non-blank and responsive, but the reserved power hammer can partially occlude the furnace and remains for author review.

Current authorized scope: rebuild scene authoring through a playable author review. Preserve forge state, physical rules and input semantics. Welding is deferred on the selection table; the power hammer belongs to hammering and currently needs a visual reservation, not invented gameplay.

## Evidence and corrections

- Previous coordinate edits did not constitute the requested model pipeline reconstruction.
- Current screenshots show occluded material candidates, excessive rack/blade/anvil dimensions, unconnected parts and duplicated visibility ownership.
- Historical full E2E failures above refer to the pre-diagnostic-point revision and are superseded by the current chain regression below; they are retained only as historical context.
- Author references: Desktop/reference folder (Chinese name), selection2, cut2, heat1, quench3, power hammer, grinding, overview5/7. Overview7 omits the heating and tempering furnaces; retain them from the game structure. Generated dimensions are design suggestions unless present in the scale contract.

## Implementation plan

1. Central physical specification in millimetres. Model roots keep scene-unit translations; model factories convert dimensions once.
2. Shared bevelled geometry/material kit; replace station construction, retain dynamic workpiece/controller ownership.
3. One instance per station in a continuous room. Proxies never render; close-up cameras do not replace rooms or resize steel.
4. Validate actual model bounds, floor/support contact, finite tool travel, picking and state continuity.
5. Desktop and narrow screenshots, real-input regression, builds, pixel diagnostics. User review only after a concrete playable result.

Confirmed: 1750 mm human, 1600 mm eye, 875 mm work surface, 800 mm bench depth, 336 x 48 x 8 mm standard billet, 0.08 scene units/mm.

Current implementation: scene authoring uses a millimetre-authored workshop kit. The room is one continuous space with persistent station bodies, measured footprints, grounded bases, shared 0.08 units/mm scale, visible reference rulers and camera diagnostics. Heating and tempering now use separate furnace bodies and operation views. Welding remains deferred as a future selection-table operation, and the power hammer is visual reservation only.

Tempering reconstruction: the independent tempering furnace accepts a target temperature and timed soak. Dragging the quenched workpiece fully into that furnace starts the soak; dragging it fully out commits a temper event that releases part of residual stress according to temperature, duration and material response. Existing damage and cracks remain facts and are not repaired.

Grinding consensus update: the player positions the billet in XYZ, rotates it around local X/Y/Z, feeds it to the belt with W/S, and holds contact for fixed-timestep material removal. The current input mapping is wheel=X, A/D=Y, Q/E=Z, Shift-drag=horizontal translation. The HUD derives blade angle, edge thickness, roughness, symmetry and removed volume from the existing forge snapshot; it does not create a parallel value-card simulation.

Current evidence: the focused abrasive-contact path and the R1 chain path pass. The Web and WeChat builds, typecheck, and diff check pass. The grind acceptance path passes real pointer/keyboard input: W feeds into the belt, held contact removes material, and S retracts and stops removal. The authored continuous workflow now passes real browser input through selection, cutting, heating, hammering, whole-piece quenching, tempering and grinding while retaining the workpiece identity. The grind computation and mesh preparation run in `grind.worker.ts`; the main thread receives immutable solid updates and a prepared mesh. The local preview remains `http://127.0.0.1:4183/`.

## 2026-09-16 R1-C chain evidence

- Plan alignment: seven single-workpiece base operations are author-confirmed; welding remains deferred, and power-hammer/hydraulic gameplay remains future scope.
- Deterministic chain regression: `tests/forge/r1-chain.test.ts` passes the sequence cut -> heat -> hammer -> oil quench -> temper -> grind. It asserts the same workpiece identity, reduced volume with accounted removal, heat-treatment history, mechanical work, material regions and finite `ForgeFacts`.
- Browser chain regression: `tests/e2e/forge-operation.spec.ts` passes real inputs through selection, cutting, furnace drag-in/drag-out, hammering, whole-piece quenching, temper drag-in/drag-out and grinding in one session; the workpiece id remains unchanged.
- Diagnostic correction: browser scene inspection now projects the actual furnace workpiece when the furnace or temper station is active, so automated drag evidence targets the rendered object rather than a stale generic billet.
- The downstream `src/weapon/weapon-result.ts` sample now consumes only `ForgeFacts` and derives mass, reach, balance, edge effectiveness, hardness, durability and usability. Its tuning is intentionally outside `src/forge`; it adds no attack power, story conclusion or total score to the core.

Next: verify the restored dual-furnace layout and narrow camera framing, then run a dedicated core-action feel pass before expanding the visible weapon-result consumer.

### Current quench correction

- Scope: correct partial immersion, fine vertical control, and thermal feedback without input stalls.
- Implemented: each lattice block now cools only by its actual immersion fraction; zero-dwell contact does not cause an instant whole-piece temperature drop. W/S uses 1 scene-unit nudges. Bottom/top block temperatures are exposed as browser diagnostics.
- Performance: quench pose input no longer rebuilds billet geometry. Thermal appearance and quench effects are batched; expensive matrix immersion sampling is reduced on the input path.
- Evidence: quench rule tests 8/8, full unit tests 21 files/120 tests, typecheck, Web and WeChat builds, diff check, and real keyboard water/oil regression passed. The oil quench acceptance page is open on port 4199 for author inspection.
- Author check: move with repeated S until only the lower portion enters the liquid, observe that cooling starts on contact and the upper portion remains hotter; move with W out of the liquid and confirm the temperature stops changing. Press W/S in short taps to feel the 1-unit precision.
- Numerical consequence: quench now writes block-level thermal damage, residual stress, damage and crack state. High-carbon steel with a severe high-temperature water quench can crack; oil under the same conditions produces less damage. HUD exposes bottom/top temperature, stress, thermal damage and crack state. Re-entry after leaving the bath creates a new cooling event.
- Scope correction: decorative steam, ripples and sound remain deferred. The quench acceptance view now frames the full basin, reserves more vertical space for the complete HUD, and disables dormant effect updates in the hot path.
- Camera correction: the materials view now approaches from the aisle side so the saw station is behind the camera; quench close-up hides unrelated close-up props and uses a basin-wide frame so the reserved power hammer cannot occlude the bath. Desktop screenshots for both acceptance routes were checked.
- Camera alignment update: selection and welding now share a centered operator-facing tabletop frame with a downward view; quench uses a centered front view of the basin at closer inspection distance. Eight isolated acceptance routes passed after the camera change.
- Near-field correction: selection and hammer cameras move closer to the active material/anvil area. The materials origin is shifted 20 scene units away from the left room boundary, with a screenshot check confirming visible clearance.
## 2026-09-21 pressure handoff continuation

- Restored the hydraulic press rating from the temporary `1,000,000 N` value to the intended `600,000 N`; 50% remains below the spring-steel yield threshold, while the accepted 65% path loads the hot baseline.
- Removed the redundant whole-workpiece JSON cross-clone press-path cache. Identity-based WeakMap caching remains; cloned baselines now prepare their own deterministic path.
- Focused verification: 5 Vitest files / 43 tests passed, governance and TypeScript checks passed, and the powered-forging browser path passed at desktop and narrow widths plus early-release/empty-load protection (3 tests).
- Existing pressure model evidence was retained without regeneration. Final front/reference captures and procedural source are present; the img2threejs state records the earlier blockout gate stop honestly. Projection and texture-material steps were skipped with reasons because this asset uses an existing procedural hard-surface build.
- Author review URL: `http://127.0.0.1:4199/?accept=press`. Interactive experience review is now handed to the author; no complete crafting regression was run.

## 2026-09-21 unified workpiece pose controls

- Cut, hand hammer, power hammer, hydraulic press and grinding now share the same pose contract: left drag translates on the station table; right drag or Shift-drag rotates around the selected axis; arrow keys translate; Q/E and A/D rotate; the shared axis selector and center button reset/choose the pose.
- Added the shared `pose-controls` bar and synchronized its axis with the legacy hammer/powered selectors, preserving existing controls while making the gesture semantics consistent across stations.
- Focused validation: TypeScript check passed; 3 affected Vitest files / 36 tests passed; the narrow pressure browser path passed after the overlay was made transparent to preserve the existing canvas pixel gate.
- Author should test the five stations manually; no complete crafting regression was run.

## 2026-09-21 author-directed station movement

- Replaced the temporary shared axis-selector/drag system with station-specific first-principles controls. Cut uses Shift+left planar placement and Q/E (Y), A/D (Z), W/S (X) rotations; ordinary left click remains selection/confirmation.
- Hand hammer now keeps the pictured clamped orientation: W/S feed along the fixed longitudinal direction and A/D roll around the workpiece long axis. Power hammer and press use the operator camera's horizontal forward vector for W/S feed and the same A/D roll.
- Grinding keeps ordinary left hold for material removal, Shift+left for planar placement, W/S for belt-normal feed, right drag for two-angle contact orientation, and A/D for longitudinal roll.
- Removed the old movement sliders, rotation-axis selectors, free mouse dragging for hammer/powered equipment, and the generic pose bar so they cannot compete with the new contract.
- Cut preview/render now carry X/Y/Z pose angles and re-seat the visible billet on the tabletop after rotation. The core cut path remains the existing finite sweep approximation and needs a later 3D swept-plane upgrade before arbitrary tilted cuts can be treated as exact physics.
## 2026-09-22 author-approved workshop layout and +X operation axis

- Author fixed the scene contract: selection upper-left, saw middle-left, grinder lower-left, anvil center, power hammer right-middle, hydraulic press lower-right, quench rear-center, and heating/tempering furnaces rear-right with the tempering furnace kept clear of the power hammer.
- The authored world frame is X right, Y up, Z depth. The operator-facing machine feed axis is world +X; the power hammer and press roots now face the same side and map their local pose feed to that shared world direction.
- The press is yawed +90 degrees at the render root so its open work area is visible from the left operator station. The press is moved forward in Z to keep a real gap from the power hammer; the furnace pair remains against the back wall.
- Close-up power/press cameras now stand outside the machine mouth and look along +X. The operation camera contract treats occlusion of the billet/contact area by a rear machine as a layout or camera failure.
- Focused evidence: typecheck passed; power/press W/S changed local feed pose from z=0 to z=8 while the rendered operation camera remained on the +X axis; overview and both operation captures were checked. Full crafting regression was not run.

## 2026-09-22 author review: machine clearance and near-field operation views

- Moved the power hammer origin from X=120 to X=105 in the authored world frame, toward world `-X`, creating more clearance from the east/right wall while retaining separation from the anvil and press. The billet anchor and camera target derive from the same layout origin.
- Tightened the default operation camera for the power hammer and press to the near-field scale already used by grinding. Their working faces and billet contact area are now readable at entry, while the machine body remains part of the frame.
- Tightened the cutting station camera to the same near-field family so the saw blade, table and workpiece are visible together.
- Verified the grinder's actual authored bounds in the workshop geometry test: it remains in the lower-left station, within its footprint and room interior, without overlapping a neighboring station.
- Browser visual review covered the overview, power hammer, press, grinder and cutting station views on the running 4199 page. The latest page is left at `http://127.0.0.1:4199/?accept=power` for author review.

## 2026-09-22 layout inspection overview

- Re-authored `CAMERA_FRAMES.overview` as a near-vertical plan view at `[0, 640, 30]` aimed at `[0, 0, -30]`. The full room now fits in one frame without the foreground power hammer hiding the rear furnaces or lower grinder.
- The visible overview was checked in the browser after the camera change. All planned stations are simultaneously readable: materials upper-left, saw middle-left, grinder lower-left, anvil center, power hammer right-middle, press lower-right, quench basins rear-center, and the two furnaces rear-right.

## 2026-09-22 author-directed facing and aisle spacing

- Author clarified the power-hammer contract: rotate the machine model 180 degrees, but keep the player's world-reference operation view facing world +X/right. The power-hammer root is now -90 degrees Y; the operation camera remains on its world -X side. Pressure-press operation remains on world -X, facing the right wall.
- Rotated the grinder presentation by 180 degrees and moved its operation camera to the opposite side. The belt contact normal, support placement and feed clearance were updated together; W feeds into the belt and S retracts.
- Shifted the saw forward from Z=0 to Z=35, the grinder from Z=125 to Z=155, and the anvil left from X=0 to X=-12, opening space below the materials bench and to the left of the hammer.
- Station-local/world offset conversion now derives the visible billet anchors from each authored yaw, so the turned power-hammer billet stays at its die rather than the old world anchor.
- Verification: TypeScript check and diff check passed; focused layout/render tests passed (4 files / 13 tests); power-hammer real-input browser checks passed at 1280px and 390px (2 tests); rotated-grinder material-removal browser regression passed (1 test). The power-hammer operation view is open for author review.

## 2026-09-22 layout-boundary continuation

- Corrected the powered-station pose mapping for pointer placement: world tabletop deltas are now converted through each station's +90 degree yaw before entering the local hammer frame. W/S remains the authored feed path and mouse placement no longer treats world X/Z as unrotated local coordinates.
- Measured the actual rotated station meshes instead of relying on pre-yaw footprints. The power hammer reservation is now `[124, 84]`; the pressure press reservation remains `[80, 82]`. The real AABB test now passes without masking intersections.
- A second layout issue exposed by the measurement pass was fixed: the water and oil basins were microscopically overlapping the furnace envelope. The water basin moved to X=-11 and the oil basin to X=24, leaving a real measured gap before the furnace while keeping both quench stations distinct.
- Fixed a genuine desktop narrow-frame issue in the powered view: the control panel's rendered height exceeded the old canvas reservation, so the lower controls overlapped the canvas. Desktop powered canvas space now reserves the observed panel height; the 1280px power-hammer layout regression passes and the prior 390px power-hammer layout path remains passing.
- Verification: focused geometry tests 3 files / 7 tests passed, `npm run typecheck` and `git diff --check` passed, and the desktop power-hammer browser case passed. The full powered browser suites still contain stale expectations: the press test expects an older wheel direction/default-load contract, and the power empty-strike test still uses deprecated arrow-key placement. These are not being reported as complete until their contracts are deliberately reconciled. Full crafting regression remains unrun.

## 2026-09-22 powered-equipment checkpoint continuation

- Reconciled the powered-equipment input contract instead of weakening the press response: the pressure machine now starts at the intended 65% load, one upward wheel step reaches 70%, and the center button restores the station's feed-aligned pose.
- Confirmed the physical consequence of partial support: after a small roll only part of the lower contact bears on the die, so 70% can remain below yield; the basic deformation regression recenters first, while the empty-load regression moves beyond the finite support until the contact preview disappears.
- Updated the stale browser paths to use the current W/S feed contract and explicit support-boundary distance. No force threshold or material yield rule was lowered to make a tilted or unsupported workpiece deform.
- Verification: `npm run test:e2e -- tests/e2e/powered-forging.spec.ts --workers=1` passed 3/3; `npm run test:e2e -- tests/e2e/power-hammer.spec.ts --workers=1` passed 4/4; full unit tests passed 37 files / 207 tests; typecheck, governance, both builds and `git diff --check` passed. The 4199 author page should now be reloaded after the dev server restart.
- Remaining author review: inspect the pressure machine's integrated early-industrial model, continuous close/load/release feel, and whether the reduced-detail appearance is acceptable. Img2threejs state remains an honest active evidence record with the earlier blockout Tier-1 failure; this is not being relabeled as a final visual pass. Full crafting-chain regression remains intentionally unrun.

## 2026-09-24 仓库整理与当前体验基线

- 作者要求当前体验内容完整进入 main，再进入手感、美术打磨。5173 的 Vite 确认来自 Weapon-Forger-hammer，main@f37effe，代码已完整收录，无需再次合并旧分支。
- 文件树核对：30db90c = b14155d；d2a08c9 = 8fea9a6。选料、基线属于 squash 后旧分支残留；旧几何由 f752faf 修复接续，不能回退到旧有限切割算法。详情见 docs/REPOSITORY_BASELINE.md。
- 旧 dsh 目录 8 个未提交文件、governance 目录 1 个未提交文件原地保留，不参与当前体验。没有删除分支/工作目录，也没有改写历史。
- 本轮未修改运行代码，完整保留当前体验版本。npm run check 通过：治理、类型、37 文件 / 208 单测、Web 和微信构建；Web 包体积警告仍存在。本轮未重新跑浏览器体验，遵循作者自行体验要求；之前 1280px 布局失败和严格响应门槛失败仍未解决，不将本次归档称为全量玩法通过。
- 下一阶段已获方向授权：连续移动响应与局部坐标、布局与接触可读性优先，之后统一模型/材质/光影/音效。作者提供体验判断，自动检查不能代替。
