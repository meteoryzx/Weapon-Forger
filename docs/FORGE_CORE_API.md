# Forge Core API

## Boundary

`src/forge/index.ts` is the public entry for the reusable forging core. The forge core may depend on its own types, rules, simulation, and derivation modules only. It must not import `app`, `render`, `entry`, `platform`, Three.js, browser APIs, WeChat APIs, story content, or a specific downstream game's vocabulary.

The core produces three reusable layers:

- `ForgeState`: the complete serializable raw state.
- `ForgeSnapshot`: a read-only projection for a renderer.
- `ForgeFacts` and `ForgeDerivedData`: stable inputs and outputs for a downstream ruleset.

`applyForgeIntent(state, intent)` is the normal input boundary. `replayForgeState(initialState, operations)` is the deterministic replay boundary. A host may use `createForgeState`, apply intents, serialize the state, and replay the same operations without importing the game application or renderer. The current core parameter version is `physics-2`; it records equivalent plastic strain, recoverable elastic strain, residual stress, damage, and absorbed mechanical work per block.

## Downstream profiles

`deriveForgeData(state, profile)` accepts a `ForgeDerivationProfile`. A profile defines its own attribute IDs and formulas over `ForgeFacts`. The built-in `REALISTIC_FORGE_PROFILE` demonstrates general forging attributes such as hardness, toughness, sharpness, weight, balance, and appearance.

An action game can define attributes such as `attack`, `defense`, or `armor-break`. A fantasy game can define `arcane-affinity`, `rune-capacity`, or other fictional properties. These attributes belong to the consuming game and must not be added to `ForgeState` merely because one host uses them.

Every derived attribute declares its source fact IDs. Profiles also have an explicit `id` and `version`; downstream save data and replays must record both the forge parameter version and the profile version.

## Versioning rules

- Changing the shape or meaning of `ForgeState`, `ForgeIntent`, `ForgeOperation`, or `ForgeSnapshot` requires a public contract/version decision and migration coverage.
- Mechanical response is shared: tools provide a load and contact footprint, while material response derives stress, strain, damage, integrity, and mechanical work from the same state. A new operation must not write a fixed damage increment directly.
- Changing a rule value requires updating the parameter version and fixed samples when the result changes.
- Changing a downstream formula requires changing only that profile's version unless the raw forge contract changes.
- The core does not own downstream balancing, combat terms, story text, or monetization terms.
