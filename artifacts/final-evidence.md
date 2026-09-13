# R1-X2R reconstruction evidence

The scene construction pipeline now authors equipment in millimetres and converts once at the render boundary. The single room contains grounded benches, a readable anvil and hammer, front-opening furnace, open water/oil basins, grinding wheel, power-hammer reservation, timber/masonry enclosure and selection tools. The previous independent tempering furnace was removed; tempering shares the large furnace.

Automated evidence:

- `npm run typecheck` passed.
- `npx vitest run --config vitest.config.ts` passed: 20 files, 114 tests.
- `npm run build:web` passed.
- `npm run build:wechat` passed.
- `git diff --check` passed.
- Real model boundary tests passed for floor contact, reserved footprints, room bounds, no inter-station overlap, 800 mm bench depth and 875 mm work surface.
- Edge browser acceptance paths: 19 passed; one long continuous workflow test remains timing-sensitive while switching the shared furnace mode and is not claimed passed.

Visual evidence includes `artifacts/reconstruction-overview-clean.png`, `artifacts/reconstruction-materials.png`, `artifacts/reconstruction-cut.png`, `artifacts/reconstruction-hammer.png`, `artifacts/reconstruction-quench.png` and `artifacts/reconstruction-grind.png`. The current build exposes localhost-only `window.__forgeInspect()` diagnostics with station projections, camera, renderer counts and quench immersion.

Author review remains required for proportion, compactness, camera comfort, material quality and forging feel. The preview URL is `http://127.0.0.1:4183/`.
