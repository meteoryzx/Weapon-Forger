# Current evidence: eccentric section continuity (2026-09-18)

Current stage and checkpoint: R1 contact/force foundation, physics-9.
Planned objective: a single-sided edge blow must not fold two halves of one width independently.
Actually completed: eccentric strikes produce connected section bending and signed rotation; opposite-side strikes reverse that rotation.
Available evidence: 29 focused rule tests, 8 distinct hammer browser paths, desktop/narrow captures, typecheck, builds, governance and diff check.
Not yet verified: author acceptance, broad/short plate coupling, warping/combined yield, arbitrary supports and WeChat devices.
Deviation: evidence; physics-8 centered-strike tests missed the aim-dependent section switch. The earlier acceptance claim is superseded for eccentric loading.
Required experience fidelity now: state readability.
Deferred but preserved: general support mechanics, final models, sound and visual polish.
Advance decision: enter acceptance for the eccentric-load correction only.

## Behavior and cause

The player can strike one side of the steel at the anvil edge to produce persistent bending and section rotation, then choose the next placement/force from the connected resulting shape.

Sources: PROJECT_PLAN.md, HAMMERING_HANDOFF.md, hammer-surface.ts, hammer-bending.ts, hammer-eccentric.test.ts and hammer-overhang.spec.ts. The old wholeSection switch and endpoint-only section sampling caused the discontinuity. One blow gave 2.01434 mm cross-section residual; a 0.2 mm aim change gave a 0.60423 mm displacement jump. Both regressions failed before the fix and now pass.

| Causal element | Evidence / boundary |
| --- | --- |
| Purpose and action | Move steel beyond the edge, aim off-center, choose force and click. Real-input tests cover both width sides across the two viewport sizes. |
| Resistance | Section bending capacity and signed eccentric torque; work/travel limits and material history remain active. |
| Information | Actual footprint, support edge, force and persistent geometry. |
| State | Same geometry and strain/work history; mirror, conservation and save/replay checks pass. |
| Immediate feedback | Exactly twelve registered blows in each continuous input scenario, with nonblank changing canvas. |
| Consequence | A tilted but connected width rather than half-width flat strips; visibility/feel remains the author's judgment. |
| Later decision | Reposition, strike the opposite side or change force. No new shaping mode; no full downstream chain rerun. |

## Evidence and limits

- 4 focused rule files / 29 tests pass: centered behavior retained, eccentric continuity, old-threshold micro-movement, continuous section clipping, opposite sides, 90-degree boundary rotation, twelve-blow conservation and replay, plus torque balance/yield/sign and unloaded-tail checks.
- 8 distinct hammer E2E paths pass. The initial corner test hit its 30-second total budget after committing; rerun with a 60-second case budget passed in 30.0 seconds. Final eccentric desktop/narrow reruns also pass after the version update. No complete crafting workflow or full unit suite was run.
- Typecheck, Web and WeChat builds, governance and diff check pass. Existing Web bundle warning remains; no device claim.
- Captures: output/playwright/eccentric-{1280,390}-{before,after,front}.png. Canvas nonblack ratios 99.91%/100%, pixel deviations 56.54/56.56, changed pixels 650/728. Full-width profile tolerance 0.01 mm; observed repeated-rule residual about 0.0002 mm. Height difference itself is allowed and reverses with eccentricity.
- Model: geometry-based coherent narrow section with rectangular Saint-Venant torsion estimate; bending and torsion share edge work/travel. Broad short overhangs retain the local-strip approximation with smooth aspect-ratio blending. No full plate solver, constrained warping, coupled yield surface, elastic recovery, dynamic pressure/friction, complex notch stiffness or fully coupled energy solution.

## Author check

Preparation: refresh http://127.0.0.1:4199/?accept=hammer and reset with R to compare a fresh physics-9 sample. Old deformed saves are not silently straightened.

1. Move right 25 arrow-key taps and set 80% force.
2. Strike the right support junction near one width-side repeatedly, rather than always centering the hammer.
3. Inspect the width and the unloaded tail; reset and repeat on the opposite side.
4. Reposition the worked piece to confirm its shape persists.

Expected: the cross-section may tilt, leaving its two sides at different heights, but remains connected without an abrupt half-width fold or independent straight half. Tiny aim changes must not suddenly detach the opposite side. Each valid click registers once, without loss of history or volume bookkeeping.

Author judgment: does the visible response follow the contact and remain intelligible? Technical pass is recorded; author acceptance remains open. Stop here before extending support types. Next, after acceptance, resume the contact/support foundation with an explicitly validated boundary case.

# Historical evidence: right-overhang correction (2026-09-18)

Current stage and checkpoint: R1 contact/force foundation, physics-8 correction.
Planned objective: stop unjustified remote U-shaped deformation under a local edge blow.
Actually completed: the standard billet can be struck repeatedly at the support junction; the unloaded tail follows the yielding root while remaining approximately straight across its length and width.
Available evidence: 22 focused rule tests, 6 hammer browser paths, desktop/narrow screenshots and canvas measurements, typecheck, Web/WeChat builds and diff check.
Not yet verified: author experience acceptance, general support/contact behavior, elastic recovery and device execution.
Deviation: evidence; previous short-fixture and remote-height assertions did not establish full-size behavior. They are superseded by the full-size curvature checks below.
Required experience fidelity now: state readability.
Deferred but preserved: final sound, model/visual polish, broader supports and force directions.
Advance decision: enter acceptance for this correction only.

## Context and behavior

Sources: PROJECT_PLAN.md, docs/HAMMERING_HANDOFF.md, hammer-surface.ts, hammer-bending.ts, hammer-support.test.ts and hammer-overhang.spec.ts. The previous plan had already advanced to contact generalization; the author's new report returns the checkpoint to correction. Earlier dated results below are historical, not evidence for physics-8.

The player can move hot steel beyond the anvil and strike the support junction to produce persistent local yielding that changes how the next blow should be placed.

| Causal element | Evidence / limit |
| --- | --- |
| Purpose | Shape material by choosing support, position and force. |
| Action | Real arrow-key placement, pointer aim, wheel force and click. |
| Resistance | Temperature-dependent section capacity, lever arm, work/travel limits and retained strain history; contrasting rule tests pass. |
| Information | Visible anvil edge, actual contact footprint and force/support HUD. |
| State | Geometry nodes and shared material strain/work history; save/replay checks pass. |
| Immediate feedback | Hammer cycle and committed operation count; all 12 blows register in each viewport. |
| Readable consequence | Local compression and root bending with a straight following tail; whether the small change reads clearly remains an author judgment. |
| Downstream effect | Same serializable geometry persists; no full downstream workflow rerun this round. |
| Repeat choice | Reposition support, change force or strike location instead of selecting a target shape. |

## Technical evidence

- `hammer-bending`, `hammer-support`, `hammer-surface`: 22 passing tests. The new 336 mm regression first failed the old forced-return model; tail movement is now separated from tail curvature.
- Six browser tests pass: hammer entry, force/placement/roll, half-width locality, two-edge corner contact, and repeated right-edge blows at 1280 x 720 and 390 x 844. Each full-size case uses 12 blows at 80%, unchanged material-volume records, tail collinearity/cupping tolerance 0.002 mm and zero page errors.
- Typecheck, Web and WeChat builds and diff check pass. No complete workflow or full unit suite was run, per author scope. The existing Web bundle-size warning remains; no WeChat device claim.
- Captures: `output/playwright/moment-{1280,390}-{before,after}.png`, plus canvas-only pairs. Nonblack ratios 99.91% / 100%; pixel deviation 56.54 / 56.56; changed pixels 764 / 876. Screenshots show rendered steel, local deformation and no canvas/control overlap. Pixel change alone is not mechanics proof.
- Model limits: held strip, constant sampled section capacity, calibrated force, narrow-section coherence approximation, small-angle integration and global volume correction. Dynamic pressure/friction, elastic rebound, exact wide-plate/torsion coupling, arbitrary supports and fully coupled compression/bending energy remain unsolved.

## Author checklist

Preparation: open `http://127.0.0.1:4199/?accept=hammer`, refresh and reset with R for a fresh physics-8 sample.

1. Move right with 25 Right Arrow taps; the right part should overhang.
2. Set force to 80%, aim where the metal crosses the right anvil edge, and deliver 12 separate blows.
3. Select the front view and inspect both the bend near the edge and the long tail; then reposition to confirm shape persists.
4. Reset and repeat at lower force to compare the response.

Expected: each valid click produces one action; bending develops near the loaded support region, with a straight tail allowed to lower and tilt. No forced return to its old height, remote U-shaped curl, transverse cupping, state reset or material-volume gain.

Author judgment: does the response match the chosen contact/support and remain readable, and can the next position/force choice be made from what is visible? Technical checks above pass; experience acceptance remains open. Stop here before adding new support types. Once accepted, continue reusable contact/support work with a non-axis-aligned case and its own physical boundary validation.

# Historical evidence: reusable contact facts and corner load (2026-09-17)

The previously accepted finite edge response now exposes reusable facts instead of keeping its geometry implicit. `HammerContact` reports the tool impact normal; each crossed support boundary reports its outward normal, tangent, boundary-to-resultant load path, and material support-section path. Deformation consumes these vectors for propagation distance and localization. The current boundary extractor still describes the rectangular anvil.

The new contrast case shifts the billet 100 mm right and 40 mm across, then strikes at `(105, 58)`. That one contact crosses the +X and +Z anvil boundaries and produces two independent paths. Focused evidence:

- `tests/forge/hammer-support.test.ts` and `tests/forge/hammer-surface.test.ts`: 18 tests passed, including load/support path geometry, combined-corner deformation, finite propagation, mirrored/yawed near deformation, remote slope, volume, save and replay.
- One focused desktop browser path passed through real arrow keys, pointer aim and click. It verified both boundary normals, nonempty load/support paths, committed deformation and unchanged recorded material volume.
- One separate 390 × 844 Playwright CLI path passed with the same two boundary facts, no page error, no horizontal overflow and no canvas/control overlap. Renderer evidence was 176 calls, 180,828 triangles, 160 geometries and 20 textures.
- Typecheck, Web build, WeChat build and `git diff --check` passed. The Web main chunk remains above 500 kB and keeps the existing warning.
- No full unit suite and no complete workflow/browser regression were run for this narrow checkpoint, following the author's testing preference.

Current captures: [narrow before](../output/playwright/contact-paths-narrow-before.png) and [narrow after](../output/playwright/contact-paths-narrow-after.png). Detailed returned facts are in `output/playwright/contact-paths-verification.log`.

Author check: open `http://127.0.0.1:4199/?accept=hammer`, reset with R, press Right Arrow 25 times and Down Arrow 10 times, aim near the top-right corner where material crosses both anvil edges, then strike. Confirm the corner response reads as one local impact supported by two edges, without a whole-tail rotation or shape reset. After acceptance, the next smallest extension is a non-axis-aligned or non-rectangular support boundary; arbitrary supports, dynamic contact pressure, friction and anvil-body collision remain deferred.

## Earlier physics-7 local edge response

```text
Current stage and checkpoint: R1 contact/load foundation, feat/R1-shaping-flow
Planned objective: keep edge-impact deformation local instead of rotating the remote tail
Actually completed: center compression, local edge lowering, half-width localization, shape-preserving repositioning
Available evidence: 139 unit tests, typecheck, two builds, browser checks and desktop/narrow captures
Not yet verified: author acceptance of this correction, arbitrary supports, touch and WeChat devices
Deviation: none in product scope; a failed chain test needed a test-only timing correction
Required experience fidelity now: state readability
Deferred but preserved: broader contact mechanics, final art/audio, render optimization
Advance decision: enter acceptance
```

The player can position a hot workpiece over the anvil edge and strike it to produce local persistent deformation, then reposition it without losing that shape. The fixed 48 × 48 mm hammer remains unchanged.

## Current technical evidence

- `npm run check`: governance, typecheck, 24 test files / 139 tests and Web/WeChat builds passed on this rules revision. Web main chunk 768.34 kB (205.69 kB gzip); the existing size warning remains.
- Browser suite: 22/23 initially passed. The failed full-chain path released grinding contact too early. The test now holds until actual removed volume increases, then releases in `finally`. The corrected chain passed twice; this is not a claim that an untouched full suite passed 23/23 in one run. No grinding implementation changed.
- Final changed-test typecheck and documentation governance passed. `git diff --check` passed.
- Fresh keyboard, wheel and pointer checks at 1280 × 720 and 390 × 844: central compression, five 80% edge blows, half-width overhang, repositioning, unobstructed input and no canvas/control overlap passed. The narrow panel scrolls to its lower controls. This covers responsive mouse/keyboard use, not touch support.
- Central strike: no remote tail-height asymmetry. Five edge blows: approximately 0.0874 mm relative tail lowering on both viewports. Half-width case: approximately 0.2310 mm local lowering, zero measured far-section displacement. Recorded material volume remains 129024 mm³; actual geometry conservation and replay are independently checked by unit tests.
- Two 90-frame diagnostic sequences confirm downstroke/recovery without an initial upward jump. Canvas pixels are nonblank and changed after deformation: 205 desktop / 150 narrow quantized colors. Renderer: 192/176 calls and 160 geometries. The narrow call count remains above the initial 150-call budget.
- Scripted pass had no page/console errors. Initial CLI page load separately produced a missing favicon 404 and known shader precision warnings; they remain a minor development-page limitation.
- Independent focused review found no concrete pulse implementation defect. The model remains a sampled, reduced impact approximation with global volume correction, not solved dynamic contact pressure or general finite elements.

Fresh evidence and screenshots:

- [Measurements and motion samples](../output/playwright/physics7-evidence.json)
- [Desktop after five blows](../output/playwright/physics7-desktop-after.png)
- [Narrow half-width case](../output/playwright/physics7-narrow-half-width.png)
- [Narrow lower controls](../output/playwright/physics7-narrow-controls.png)

## Player causality and author check

| Link | Current evidence |
| --- | --- |
| Purpose and action | Place the workpiece, choose an occupied metal point, set force and click |
| Resistance and information | Temperature, section thickness, force and finite support govern response; HUD shows force/support and actual thickness |
| State and feedback | Material nodes deform, strain/work history persists; tool stroke and resulting contour are displayed |
| Contrast | Center compression differs from local edge lowering; far sections avoid the previous accumulated tail rotation |
| Downstream and repeat | Repositioning retains geometry; later operations consume the same workpiece and facts |

Open `http://127.0.0.1:4199/?accept=hammer`. Press R to reset. First strike the center. Reset, focus the canvas and press Right Arrow 25 times to shift 100 mm; aim near the right edge of the flat anvil face, increase force from 55% to 80% with five upward wheel steps, then strike five times. Use the front/side inspection views if needed. Choose “重新摆正” and confirm the shape remains without penetrating the anvil. As a second case, reset and press Down Arrow 10 times, then strike the width overhang.

Author judgment remains open: is the local response understandable and useful for shaping, especially given the small bend magnitude at this calibration? There must be no shape reset or whole-tail U-shaped rotation from these five local blows. After acceptance, extend contact/load/support facts to further support layouts and strike directions. Do not substitute a shape-target control, erase strain history, or merge before acceptance.

## Historical R1-X2R reconstruction evidence

The following earlier figures describe the reconstruction checkpoint, not current physics-7 verification.

The scene construction pipeline now authors equipment in millimetres and converts once at the render boundary. The single room contains grounded benches, a readable anvil and hammer, independent heating and tempering furnaces, open water/oil basins, grinding wheel, power-hammer reservation, timber/masonry enclosure and selection tools.

Automated evidence:

- `npm run typecheck` passed.
- `npm run check:governance` passed.
- `npm run test` passed: 23 files, 129 tests.
- `npx playwright test --workers=1 --reporter=line` passed: 22 tests.
- `npm run build:web` passed.
- `npm run build:wechat` passed: 735.40 kB (198.18 kB gzip).
- `git diff --check` passed.
- Real model boundary tests passed for floor contact, reserved footprints, room bounds, no inter-station overlap, 800 mm bench depth and 875 mm work surface. Station bounds are also checked against the rendered room's finished interior faces (`ROOM_INTERIOR`), because the room narrows x by `ROOM_SCALE_X = 0.72` and its masonry has real thickness.
- The heating/tempering acceptance path confirms separate furnace origins and camera frames, retained workpiece identity, and the temper workflow (dial, insert/soak, extract/commit).
- `tests/weapon/weapon-result.test.ts` passes 3 deterministic checks showing that a downstream consumer can derive mass, reach, balance, edge effectiveness, hardness, durability and usability from `ForgeFacts`; no combat stat was added to `src/forge`.
- The completed Web build reports a 760 kB minified main chunk (203 kB gzip); Vite emits the existing non-blocking chunk-size warning.

Visual evidence includes `artifacts/reconstruction-overview-clean.png`, `artifacts/reconstruction-materials.png`, `artifacts/reconstruction-cut.png`, `artifacts/reconstruction-hammer.png`, `artifacts/reconstruction-quench.png` and `artifacts/reconstruction-grind.png`, plus the current-run `output/playwright/{desktop,narrow}-{overview,furnace,temper}.png` captures of the two-furnace layout. Desktop (`1280x720`) and narrow (`390x844`) captures were non-blank with settled cameras and no page errors. The current build exposes localhost-only `window.__forgeInspect()` diagnostics with station projections, camera, renderer counts and quench immersion.

Author review remains required for proportion, compactness, camera comfort, material quality and forging feel. The tempering furnace now stands on the heating furnace's right at `[156, 0, -135]`, serviced from the aisle with a mirrored station model; the desktop tempering frame deliberately includes the heating furnace at the left edge so the two-furnace bank reads as one area. The power hammer remains a visual reservation. The preview URL is `http://127.0.0.1:4199/`.
