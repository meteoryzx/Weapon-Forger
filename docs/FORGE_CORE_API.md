# Forge Core API

## Boundary

`src/forge/index.ts` is the source-level public entry for the reusable forging core. It may depend on forge types, rules, simulation, physics, serialization, and fact derivation only. It must not import `app`, `render`, `entry`, `platform`, Three.js, browser or WeChat APIs, story content, or a consuming game's attribute vocabulary.

This boundary is designed for future reuse, but the repository does not yet publish a standalone package or promise a stable commercial SDK.

## Public layers

- `ForgeState`: complete serializable raw state and operation history.
- `ForgeSnapshot`: read-only projection for rendering and acceptance HUDs.
- `ForgeFacts`: read-only physical/process facts for a host-owned downstream profile.
- `ForgeDerivedData`: output of the current reference profile mechanism; it is not the R1 deliverable or a locked product attribute set.

Normal use:

```ts
const initial = createForgeState();
const next = applyForgeIntent(initial, intent);
const saved = serializeForgeState(next.state);
const restored = deserializeForgeState(saved);
const snapshot = createForgeSnapshot(restored);
const facts = createForgeFacts(restored);
```

`replayForgeState(initialState, operations)` is the deterministic replay boundary. A host can create state, apply intents, save it, restore it, and replay operations without importing the game application or renderer.

## State semantics

`stateVersion` identifies the serialized state schema and field meanings. `parameterVersion` identifies the numerical forge rules used to produce results. They change independently:

- A state shape or semantic change requires a `stateVersion` decision and migration coverage.
- A rule-table value or mechanical formula change requires a `parameterVersion` decision and updated fixed samples.
- A downstream profile formula change updates only that profile's version unless the forge facts contract also changes.

The current deserializer accepts only the current `stateVersion`. No historical migration function exists yet; unsupported versions are rejected explicitly rather than guessed.

## Material and process provenance

`WorkpieceState.material` is a volume-weighted aggregate used by the current reduced-order formulas. It does not mean a welded workpiece is spatially homogeneous.

Each block retains `materialId` and `materialRegionId`. Cutting gives the resulting pieces independent region identities, while welding keeps both sources. Welds also create `JointState` records with contact area, weld temperature, and integrity. `heatTreatments` is an ordered event list so repeated quench and temper operations are not overwritten.

`ForgeFacts.materialRegions`, `jointIntegrity`, `heatTreatmentCount`, and `removedVolume` expose those raw facts to future consumers without assigning game-specific meaning.

## Downstream profiles

`deriveForgeData(state, profile)` accepts a `ForgeDerivationProfile`. Profiles own their attribute IDs, formulas, classifications, ID, and version. An action game may define attack or armor break; a fantasy game may define arcane affinity; an adventure game may define six dimensions. None of those names belong in `ForgeState`.

`REALISTIC_FORGE_PROFILE` is a reference implementation used to exercise the extension boundary. Its values and classifications are not an accepted weapon-balance model and do not make R1 dependent on six dimensions.

## Invariants

- Hosts submit `ForgeIntent`; only forge simulation produces `ForgeOperation` and new state.
- New operations use shared material/physics rules and must not add fixed damage or score increments.
- Rendering reads snapshots and never mutates simulation state.
- Invalid or unknown serialized input is rejected at the boundary.
- Every public-state change requires deterministic unit samples; player-facing changes also require browser-path regression evidence and author acceptance.
