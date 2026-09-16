# R1-X2R reconstruction evidence

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
