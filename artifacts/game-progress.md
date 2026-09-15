# Workshop reconstruction

## 2026-09-15 completion checkpoint

- Three.js is installed as the real runtime dependency: `three@0.185.1` and `@types/three@0.185.1`; source imports `WebGLRenderer`, `three/addons`, and `RoomEnvironment`.
- The independent tempering furnace is removed from the layout and renderer. Heating and tempering now share one `FurnaceStationView`, one furnace origin, one workpiece rig, one temperature control, and one camera frame.
- Restored the thermal contract (`thermalTimeScale=6`) and saw travel contract (`sawTravelLength=90`); retained keyboard compatibility for the quench acceptance path and center-tolerant hammer picking.
- Verification: `npm run test` 21 files / 123 tests, `npm run typecheck`, 22 Playwright E2E tests with one worker, `npm run build:web`, `npm run build:wechat`, and `git diff --check` all pass.
- Current visual captures: `output/playwright/desktop-temper.png` (`1280x720`) and `output/playwright/mobile-temper.png` (`390x844`). Narrow view is non-blank and responsive, but the reserved power hammer can partially occlude the furnace and remains for author review.

Current authorized scope: rebuild scene authoring through a playable author review. Preserve forge state, physical rules and input semantics. Welding is deferred on the selection table; the power hammer belongs to hammering and currently needs a visual reservation, not invented gameplay.

## Evidence and corrections

- Previous coordinate edits did not constitute the requested model pipeline reconstruction.
- Current screenshots show occluded material candidates, excessive rack/blade/anvil dimensions, unconnected parts and duplicated visibility ownership.
- Latest full E2E: 15 passed, 4 failed (old overview projections, weld interaction, finite saw placements). These remain unresolved; older green tests do not certify this revision.
- Author references: Desktop/reference folder (Chinese name), selection2, cut2, heat1, quench3, power hammer, grinding, overview5/7. Overview7 omits the heating and tempering furnaces; retain them from the game structure. Generated dimensions are design suggestions unless present in the scale contract.

## Implementation plan

1. Central physical specification in millimetres. Model roots keep scene-unit translations; model factories convert dimensions once.
2. Shared bevelled geometry/material kit; replace station construction, retain dynamic workpiece/controller ownership.
3. One instance per station in a continuous room. Proxies never render; close-up cameras do not replace rooms or resize steel.
4. Validate actual model bounds, floor/support contact, finite tool travel, picking and state continuity.
5. Desktop and narrow screenshots, real-input regression, builds, pixel diagnostics. User review only after a concrete playable result.

Confirmed: 1750 mm human, 1600 mm eye, 875 mm work surface, 800 mm bench depth, 336 x 48 x 8 mm standard billet, 0.08 scene units/mm.

Current implementation: scene authoring has been replaced with a millimetre-authored workshop kit. The room is one continuous space with persistent station bodies, measured footprints, grounded bases, shared 0.08 units/mm scale, visible reference rulers and camera diagnostics. The independent tempering furnace was removed; tempering now uses the large furnace body and its mode controls. Welding remains deferred as a future selection-table operation, and the power hammer is visual reservation only.

Tempering reconstruction: the shared furnace now accepts a target tempering temperature and a timed soak. Sending the quenched workpiece into the furnace starts the soak; taking it out commits a temper event that releases part of residual stress according to temperature, duration and material response. Existing damage and cracks remain facts and are not repaired. Author acceptance is still pending.

Grinding consensus update: the player positions the billet in XYZ, rotates it around local X/Y/Z, feeds it to the belt with W/S, and holds contact for fixed-timestep material removal. The current input mapping is wheel=X, A/D=Y, Q/E=Z, Shift-drag=horizontal translation. The HUD derives blade angle, edge thickness, roughness, symmetry and removed volume from the existing forge snapshot; it does not create a parallel value-card simulation.

Current evidence: the focused abrasive-contact path has 21 test files and 119 unit tests passing. The Web and WeChat builds, typecheck, and diff check pass. The grind acceptance path passes real pointer/keyboard input: W feeds into the belt, held contact removes material, and S retracts and stops removal. The continuous authored workflow is still not claimed green until its furnace transition timeout is separately repaired. The grind computation and mesh preparation now run in `grind.worker.ts`; the main thread receives immutable solid updates and a prepared mesh. The local preview remains `http://127.0.0.1:4183/`.

Next: open the grind acceptance slice and inspect that the bevel forms on the contacted side, the workpiece remains grounded, and S stops removal. After that manual check, continue the focused second-side/symmetry pass; complete the full workflow only at the stage boundary.

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
