# R1-X2R reconstruction evidence

The scene construction pipeline now authors equipment in millimetres and converts once at the render boundary. The single room contains grounded benches, a readable anvil and hammer, front-opening furnace, open water/oil basins, grinding wheel, power-hammer reservation, timber/masonry enclosure and selection tools. The previous independent tempering furnace was removed; tempering shares the large furnace.

Automated evidence:

- `npm run typecheck` passed.
- `npm run test` passed: 21 files, 123 tests.
- `npx playwright test --workers=1 --reporter=line` passed: 22 tests.
- `npm run build:web` passed.
- `npm run build:wechat` passed.
- `git diff --check` passed.
- Real model boundary tests passed for floor contact, reserved footprints, room bounds, no inter-station overlap, 800 mm bench depth and 875 mm work surface.
- The heating/tempering acceptance path confirms one shared furnace origin, identical camera frames, retained workpiece identity, and the two-step temper workflow (dial, insert/soak, extract/commit).
- The completed Web build reports a 757 kB minified main chunk (202 kB gzip); Vite emits the existing non-blocking chunk-size warning.

Visual evidence includes `artifacts/reconstruction-overview-clean.png`, `artifacts/reconstruction-materials.png`, `artifacts/reconstruction-cut.png`, `artifacts/reconstruction-hammer.png`, `artifacts/reconstruction-quench.png` and `artifacts/reconstruction-grind.png`, plus the current-run `output/playwright/desktop-temper.png` and `output/playwright/mobile-temper.png`. Desktop (`1280x720`) and narrow (`390x844`) captures were non-blank with settled cameras and varied Canvas pixels. The current build exposes localhost-only `window.__forgeInspect()` diagnostics with station projections, camera, renderer counts and quench immersion.

Author review remains required for proportion, compactness, camera comfort, material quality and forging feel. On narrow temper view the reserved power hammer can occlude part of the furnace; this remains a visual follow-up rather than an automated release failure. The preview URL is `http://127.0.0.1:4199/`.
