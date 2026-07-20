import assert from "node:assert/strict";
import test from "node:test";

import {
  applyForgeOperation,
  createForgeSnapshot,
  createForgeState,
  replayForgeState,
  totalVolume,
} from "../../src/forge/index.ts";

const CENTER = 4;

function forgeAt(temperatureC, operations = []) {
  let state = createForgeState({ sectionCount: 9 });
  state = applyForgeOperation(state, { kind: "heat", temperatureC });
  for (const operation of operations) {
    state = applyForgeOperation(state, operation);
  }
  return state;
}

function center(state) {
  return state.workpiece.sections[CENTER];
}

test("same serializable start and operation history always replay to the same state", () => {
  const initial = createForgeState({ sectionCount: 9 });
  const operations = [
    { kind: "heat", temperatureC: 950 },
    { kind: "hammer", sectionIndex: CENTER, energy: 0.7, lateralBias: -1 },
    { kind: "rotate", quarterTurns: 1 },
    { kind: "hammer", sectionIndex: CENTER, energy: 0.45, lateralBias: 0 },
  ];

  const direct = replayForgeState(initial, operations);
  const replayed = replayForgeState(JSON.parse(JSON.stringify(initial)), JSON.parse(JSON.stringify(operations)));

  assert.deepEqual(replayed, direct);
  assert.equal(initial.operations.length, 0, "operations must not mutate the previous state");
});

test("hot material deforms more while cold heavy hammering accumulates more stress", () => {
  const hammer = { kind: "hammer", sectionIndex: CENTER, energy: 0.85, lateralBias: 0 };
  const hot = forgeAt(950, [hammer]);
  const cold = forgeAt(500, [hammer]);
  const original = center(createForgeState({ sectionCount: 9 }));

  assert.ok(original.thickness - center(hot).thickness > original.thickness - center(cold).thickness);
  assert.ok(center(cold).stress > center(hot).stress);
});

test("a quarter-turn swaps the width and thickness response", () => {
  const hammer = { kind: "hammer", sectionIndex: CENTER, energy: 0.8, lateralBias: 0 };
  const original = center(createForgeState({ sectionCount: 9 }));
  const faceOn = forgeAt(950, [hammer]);
  const edgeOn = forgeAt(950, [{ kind: "rotate", quarterTurns: 1 }, hammer]);

  assert.ok(center(faceOn).thickness < original.thickness);
  assert.ok(center(faceOn).width > original.width);
  assert.ok(center(edgeOn).width < original.width);
  assert.ok(center(edgeOn).thickness > original.thickness);
});

test("hammering is smooth across neighbouring sections and preserves approximate volume", () => {
  const initial = createForgeState({ sectionCount: 9 });
  const result = forgeAt(950, [{ kind: "hammer", sectionIndex: CENTER, energy: 0.9, lateralBias: 0 }]);
  const centerChange = center(result).thickness - center(initial).thickness;
  const neighbourChange = result.workpiece.sections[CENTER - 1].thickness - initial.workpiece.sections[CENTER - 1].thickness;

  assert.ok(Math.abs(neighbourChange) > 0, "neighbours receive a smaller, continuous influence");
  assert.ok(Math.abs(neighbourChange) < Math.abs(centerChange));
  assert.ok(Math.abs(totalVolume(result) - totalVolume(initial)) < 0.000001);
});

test("one-sided hits bend the billet and opposite hits can correct it", () => {
  const oneSided = forgeAt(950, [{ kind: "hammer", sectionIndex: CENTER, energy: 0.9, lateralBias: 1 }]);
  const corrected = forgeAt(950, [
    { kind: "hammer", sectionIndex: CENTER, energy: 0.9, lateralBias: 1 },
    { kind: "hammer", sectionIndex: CENTER, energy: 0.9, lateralBias: -1 },
  ]);

  assert.ok(Math.abs(center(oneSided).lateralOffset) > 0);
  assert.ok(Math.abs(center(corrected).lateralOffset) < Math.abs(center(oneSided).lateralOffset));
});

test("cold repeated heavy hits create deterministic cracks and expose them through a render-only snapshot", () => {
  const hammer = { kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 0 };
  const result = forgeAt(450, [hammer, hammer, hammer, hammer, hammer]);
  const snapshot = createForgeSnapshot(result);

  assert.equal(center(result).cracked, true);
  assert.equal(snapshot.hasCracks, true);
  assert.ok(snapshot.sections.some((section) => section.cracked));
});

test("invalid external operations are rejected before they can change a state", () => {
  const initial = createForgeState({ sectionCount: 9 });

  assert.throws(() => applyForgeOperation(initial, { kind: "heat", temperatureC: 1401 }));
  assert.throws(() => applyForgeOperation(initial, { kind: "rotate", quarterTurns: 2 }));
  assert.throws(() => applyForgeOperation(initial, { kind: "hammer", sectionIndex: CENTER, energy: 1, lateralBias: 3 }));
  assert.equal(initial.operations.length, 0);
  assert.equal(center(initial).integrity, 1);
});
