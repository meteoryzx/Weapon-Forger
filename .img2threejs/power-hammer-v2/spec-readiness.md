# Spec readiness

The authored specification passes validate_sculpt_spec.py --strict-quality. This is a schema/quality-depth result, not a render, placement or action pass. The user-authorized fourth correction was evaluated: IoU 0.8427 remains below 0.85, while aspect delta 0.0194 and scale delta 0.0729 pass. The run is stopped at 4/4 corrections; see artifacts/game-progress.md. No further automatic correction or build pass is approved.

- 30 named components after adding visible foot pads and the small service cover; separate ram pivot with upper mount and upper die children. Only the currently unlocked blockout components are emitted.
- 14 grid-inspected details map to actual component.localFeatures entries.
- Main-reference crops for iron, steel and brass inspected before extraction. Each extraction reports 0.86 with threshold 0.7. These are candidate inverse-rendering estimates, not true measured material parameters; steel/brass specular bands must not be mistaken for relief.
- The invisible root reuses iron evidence only to satisfy the container material contract; it contributes no visible surface.
- No identity-defining printed pattern or decal is requested. Whole-image projection is not applicable: it would project front-facing illumination and machinery seams onto other faces. Reference PBR evidence and procedural local material responses are specified instead. Surface matching still requires relighting and material gate review.
- Dimensions, camera alignment, clearance, mesh attachment and workshop fit remain blockout/structural gates. The current run has no approved build pass.
- Hidden sides remain explicitly inferred from the generated six-view sheet. No manufactured pneumatic internals are claimed.
