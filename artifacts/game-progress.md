# Workshop reconstruction

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

Grinding consensus update: the player positions the billet in XYZ, rotates it around local X/Y/Z, feeds it to the belt with W/S, and holds contact for fixed-timestep material removal. The current input mapping is wheel=X, A/D=Y, Q/E=Z, Shift-drag=horizontal translation. The HUD derives blade angle, edge thickness, roughness, symmetry and removed volume from the existing forge snapshot; it does not create a parallel value-card simulation.

Evidence this pass: 20 render/unit test files and 114 tests pass; Web and WeChat production builds pass; model-boundary tests pass; 19 browser acceptance paths pass under Edge/NVIDIA RTX 4060. The authored continuous-workflow path still has one timeout when switching the live furnace mode during the long path, so it is not claimed green. Existing screenshot captures are available under `artifacts/` and the local preview is `http://127.0.0.1:4183/`.

Next: author should inspect the preview at overview, furnace heat, furnace temper, hammer, quench and grind; report visual defects by station. After that feedback, continue the next focused graphics/gameplay pass without reopening the scale contract.
