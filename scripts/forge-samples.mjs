import { applyForgeOperation, createForgeSnapshot, createForgeState, totalVolume } from "../src/forge/index.ts";

const center = 4;

const samples = {
  carefulHotForging: [
    { kind: "heat", temperatureC: 950 },
    { kind: "hammer", sectionIndex: center, energy: 0.65, lateralBias: -1 },
    { kind: "hammer", sectionIndex: center, energy: 0.65, lateralBias: 1 },
  ],
  coldHeavyHammering: [
    { kind: "heat", temperatureC: 450 },
    ...Array.from({ length: 5 }, () => ({ kind: "hammer", sectionIndex: center, energy: 1, lateralBias: 0 })),
  ],
  oneSidedHammering: [
    { kind: "heat", temperatureC: 950 },
    { kind: "hammer", sectionIndex: center, energy: 0.9, lateralBias: 1 },
  ],
};

const report = Object.entries(samples).map(([name, operations]) => {
  const initial = createForgeState({ sectionCount: 9 });
  const state = operations.reduce(applyForgeOperation, initial);
  const middle = state.workpiece.sections[center];
  return {
    sample: name,
    center: {
      width: round(middle.width),
      thickness: round(middle.thickness),
      plasticity: round(middle.plasticity),
      stress: round(middle.stress),
      integrity: round(middle.integrity),
      lateralOffset: round(middle.lateralOffset),
      cracked: middle.cracked,
    },
    volumeDifference: round(totalVolume(state) - totalVolume(initial)),
    snapshot: createForgeSnapshot(state),
  };
});

console.log(JSON.stringify(report, null, 2));

function round(value) {
  return Math.round(value * 1000000) / 1000000;
}
