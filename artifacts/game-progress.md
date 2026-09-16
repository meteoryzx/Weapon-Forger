# Workshop reconstruction

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
