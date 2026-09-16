// Hammer capability loop.
//
// This is the red-capable feedback loop for "can the forge actually shape metal,
// and does the game report the truth about it". It changes no game behaviour: it
// drives the real rules layer and checks physical capability targets. Run it with
// `npm run bench:hammer`. A non-zero exit means at least one target is unmet.
//
// Targets:
//   T1 response - observe cumulative hot-working response and solver cost; the
//                 old 5 mm target is not a license to distort material flow
//   T2 boundary - free-surface geometry produces different physical responses
//   T3 feedback - reported facts must match the real deformed geometry
//   T4 contract - volume stays conserved and replay stays byte-identical
//   T5 locality - deformation decays away from the contact
//   T6 support  - finite anvil support produces an edge reaction on overhangs
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const forge = await import(pathToFileURL(path.join(root, "src/forge/index.ts")).href);
const { applyForgeOperation, createForgeState, createForgeFacts, geometryVolumes, replayForgeState, serializeForgeState, HIGH_CARBON_STEEL, HAMMER_HOME } = forge;

const quick = process.argv.includes("--quick");
const PERFORMANCE = { blows: quick ? 16 : 40, positions: 7, spacing: 20, energy: 0.55, temperatureC: 1000 };
const TARGETS = { spanMm: 120, feedbackPercent: 5, volumeDriftPercent: 0.2 };

function heat(material, temperatureC) {
  return applyForgeOperation(createForgeState({ material }), { kind: "heat", temperatureC });
}

function strike(pose, energy = PERFORMANCE.energy) {
  return { kind: "surface-hammer", pose, target: { x: 0, z: 0 }, energy };
}

function realVolume(state) {
  return [...geometryVolumes(state.workpiece).values()].reduce((sum, value) => sum + value, 0);
}

// Real geometry, read straight off the control lattice: nothing here trusts a
// reported fact, so it can disagree with one on purpose.
function realShape(state) {
  const nodes = state.workpiece.geometry.nodes;
  const bounds = nodes.reduce((acc, node) => ({
    minX: Math.min(acc.minX, node.axialPosition), maxX: Math.max(acc.maxX, node.axialPosition),
    minZ: Math.min(acc.minZ, node.lateralOffset), maxZ: Math.max(acc.maxZ, node.lateralOffset),
    minY: Math.min(acc.minY, node.verticalOffset), maxY: Math.max(acc.maxY, node.verticalOffset),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minY: Infinity, maxY: -Infinity });
  return { lengthMm: bounds.maxX - bounds.minX, widthMm: bounds.maxZ - bounds.minZ, heightMm: bounds.maxY - bounds.minY };
}

// Mean thickness of the material columns inside an axial window around the
// centre: the same definition the facts layer now reports.
function spanThickness(state, windowMm) {
  const { grid } = state.workpiece.geometry;
  const columns = new Map();
  state.workpiece.sections.forEach((section, index) => {
    if (section.blocks.length === 0) return;
    if (Math.abs(section.position - centre(state)) > windowMm / 2) return;
    for (const block of section.blocks) {
      const key = `${index}:${block.widthIndex}`;
      const footprint = block.length * block.width;
      const column = columns.get(key) ?? { footprint: 0, thickness: 0 };
      column.footprint = Math.max(column.footprint, footprint);
      column.thickness += footprint > 0 ? block.volume / footprint : 0;
      columns.set(key, column);
    }
  });
  const all = [...columns.values()];
  const area = all.reduce((sum, column) => sum + column.footprint, 0);
  return area > 0 ? all.reduce((sum, column) => sum + column.thickness * column.footprint, 0) / area : 0;
}

// Mid-plane height of a station, addressed as a fraction of the occupied length.
function sectionMidPlane(state, fraction) {
  const occupied = state.workpiece.sections
    .map((section, index) => ({ section, index }))
    .filter(entry => entry.section.blocks.length > 0);
  if (occupied.length === 0) return 0;
  const at = occupied[Math.min(occupied.length - 1, Math.max(0, Math.round(fraction * (occupied.length - 1))))];
  const { grid, nodes } = state.workpiece.geometry;
  const stride = grid.widthBlocks + 1, ring = stride * (grid.heightBlocks + 1);
  let min = Infinity, max = -Infinity;
  for (let offset = 0; offset < ring; offset += 1) {
    const value = nodes[at.index * ring + offset].verticalOffset;
    min = Math.min(min, value); max = Math.max(max, value);
  }
  return (min + max) / 2;
}

function centre(state) {
  const positions = state.workpiece.sections.filter(s => s.blocks.length > 0).map(s => s.position);
  return positions.length ? (Math.min(...positions) + Math.max(...positions)) / 2 : 0;
}

// Lateral extent of the material ring at a station, addressed as a fraction of
// the occupied length (0 = one end, 1 = the other).
function sectionWidth(state, fraction) {
  const occupied = state.workpiece.sections
    .map((section, index) => ({ section, index }))
    .filter(entry => entry.section.blocks.length > 0);
  if (occupied.length === 0) return 0;
  const at = occupied[Math.min(occupied.length - 1, Math.max(0, Math.round(fraction * (occupied.length - 1))))];
  const { grid, nodes } = state.workpiece.geometry;
  const stride = grid.widthBlocks + 1, ring = stride * (grid.heightBlocks + 1);
  let min = Infinity, max = -Infinity;
  for (let offset = 0; offset < ring; offset += 1) {
    const value = nodes[at.index * ring + offset].lateralOffset;
    min = Math.min(min, value); max = Math.max(max, value);
  }
  return max - min;
}

function passAlong(state, offsets) {
  let next = state;
  let applied = 0;
  for (const offset of offsets) {
    try { next = applyForgeOperation(next, strike({ ...HAMMER_HOME, x: offset })); applied += 1; }
    catch { /* a spent spot is reported through the thickness numbers, not an exception */ }
  }
  return { state: next, applied };
}

function offsetsFor(positions, spacing) {
  const half = Math.floor(positions / 2);
  const offsets = [];
  for (let i = 0; i < positions; i += 1) offsets.push((i - half) * spacing);
  return offsets;
}

const results = [];
function check(id, label, passed, detail) {
  results.push({ id, label, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${id}  ${label}  ${detail}`);
}

function observe(id, label, detail) {
  console.log(`INFO  ${id}  ${label}  ${detail}`);
}

// ---------------------------------------------------------------- T1: speed
const started = heat(HIGH_CARBON_STEEL, PERFORMANCE.temperatureC);
const initialSpan = spanThickness(started, TARGETS.spanMm);
const startedAt = performance.now();
let training = started;
let applied = 0;
for (let round = 0; round < Math.ceil(PERFORMANCE.blows / PERFORMANCE.positions) + 1; round += 1) {
  const before = applied;
  const next = passAlong(training, offsetsFor(PERFORMANCE.positions, PERFORMANCE.spacing).slice(0, PERFORMANCE.blows - applied));
  training = next.state; applied += next.applied;
  if (applied === before) break;
  if (applied >= PERFORMANCE.blows) break;
}
const speedMs = performance.now() - startedAt;
const finalSpan = spanThickness(training, TARGETS.spanMm);
observe("T1", `${PERFORMANCE.blows} hot blows over a ${TARGETS.spanMm} mm span`,
  `applied=${applied}/${PERFORMANCE.blows} span=${initialSpan.toFixed(2)}->${finalSpan.toFixed(2)} mm in ${(speedMs / 1000).toFixed(1)}s (${(speedMs / Math.max(1, applied)).toFixed(0)} ms/blow)`);

// ------------------------------------------------------------ T2: boundary
// The same fixed flat hammer produces different outcomes near different free
// surfaces. This is boundary-response evidence, not a direct direction control.
const perBlowGrowth = (offset) => {
  const before = heat(HIGH_CARBON_STEEL, PERFORMANCE.temperatureC);
  const after = applyForgeOperation(before, strike({ ...HAMMER_HOME, x: offset }, 1));
  const a = realShape(before), b = realShape(after);
  return { length: b.lengthMm - a.lengthMm, width: b.widthMm - a.widthMm };
};
const midBlow = perBlowGrowth(0);
const endBlow = perBlowGrowth(155);
const ratioOf = (growth) => growth.width !== 0 ? growth.length / growth.width : Infinity;
const midRatio = ratioOf(midBlow), endRatio = ratioOf(endBlow);
const separation = Math.abs(midRatio - endRatio) / Math.max(Math.abs(midRatio), Math.abs(endRatio), 1e-9);
check("T2", "free-surface boundaries change the deformation response",
  Number.isFinite(midRatio) && Number.isFinite(endRatio) && separation > 0.25,
  `mid-bar dL/dW=${midRatio.toFixed(2)} (dL ${midBlow.length.toFixed(2)} dW ${midBlow.width.toFixed(2)}) | near free end dL/dW=${endRatio.toFixed(2)} (dL ${endBlow.length.toFixed(2)} dW ${endBlow.width.toFixed(2)}) | separation ${(separation * 100).toFixed(0)}% (needs >25%)`);

// ------------------------------------------------------------ T5: locality
// A blow may not shove the whole bar sideways: the work has to change where the
// hammer landed and fade out from there. The first implementation translated
// everything outside the kernel rigidly, so the entire side edge walked outwards
// on every blow no matter where it landed.
const locality = (() => {
  let state = heat(HIGH_CARBON_STEEL, PERFORMANCE.temperatureC);
  const before = [0.1, 0.5, 0.9].map(fraction => sectionWidth(state, fraction));
  for (let i = 0; i < 10; i += 1) {
    try { state = applyForgeOperation(state, strike({ ...HAMMER_HOME, x: 0 })); } catch { break; }
  }
  const after = [0.1, 0.5, 0.9].map(fraction => sectionWidth(state, fraction));
  const centreGain = after[1] - before[1];
  const endGain = Math.max(after[0] - before[0], after[2] - before[2]);
  return { centreGain, endGain, ratio: centreGain > 1e-6 ? endGain / centreGain : Infinity };
})();
check("T5", "a blow changes the work where it landed, not the whole bar",
  Number.isFinite(locality.ratio) && locality.ratio < 0.35,
  `width gain at the ends ${locality.endGain.toFixed(2)} mm vs ${locality.centreGain.toFixed(2)} mm at the blow (ratio ${locality.ratio.toFixed(2)}, needs <0.35)`);

// ------------------------------------------------------- T6: anvil reaction
// A held strip can yield in bending when an edge-straddling load exceeds its
// section capacity. Its hanging tip must not become the anvil resting plane.
const bend = (() => {
  let state = heat(HIGH_CARBON_STEEL, PERFORMANCE.temperatureC);
  // pose.x = 100 slides the bar so its +X end hangs well past the 224 mm anvil
  // face while the contact point still sits on the anvil.
  const before = [sectionMidPlane(state, 0.5), sectionMidPlane(state, 0.9)];
  let thrown = null;
  try {
    state = applyForgeOperation(state, {
      kind: "surface-hammer",
      pose: { ...HAMMER_HOME, x: 100 },
      // The 48 mm face straddles the +112 mm anvil edge, so part of the load is
      // supported and part acts on the overhang.
      target: { x: 105, z: 0 },
      energy: 0.8,
    });
  } catch (error) { thrown = error instanceof Error ? error.message : String(error); }
  const after = [sectionMidPlane(state, 0.5), sectionMidPlane(state, 0.9)];
  const tilt = (after[1] - after[0]) - (before[1] - before[0]);
  const initialVolume = realVolume(heat(HIGH_CARBON_STEEL, PERFORMANCE.temperatureC));
  return { tilt, thrown, drift: Math.abs(realVolume(state) / initialVolume - 1) };
})();
check("T6", "an overhanging blow bends the overhang down about the anvil edge",
  bend.thrown === null && bend.tilt < -0.05 && bend.drift < 0.00002,
  `tip dropped ${(-bend.tilt).toFixed(3)} mm relative to the supported part (needs >0.05), volume drift ${(bend.drift * 100).toFixed(5)}%${bend.thrown ? ` | refused: ${bend.thrown}` : ""}`);

// ------------------------------------------------------------ T3: feedback
const facts = createForgeFacts(training);
const shape = realShape(training);
const lengthError = Math.abs(facts.totalLength - shape.lengthMm) / Math.max(shape.lengthMm, 1e-9) * 100;
const reportedSpan = facts.sectionProfile
  .filter(entry => Math.abs(entry.axialPositionMm - centre(training)) <= TARGETS.spanMm / 2);
const reportedSpanArea = reportedSpan.reduce((sum, entry) => sum + entry.volumeMm3, 0);
const reportedSpanThickness = reportedSpanArea > 0
  ? reportedSpan.reduce((sum, entry) => sum + entry.thicknessMm * entry.volumeMm3, 0) / reportedSpanArea
  : 0;
const thicknessError = Math.abs(reportedSpanThickness - finalSpan) / Math.max(finalSpan, 1e-9) * 100;
check("T3", "reported facts match the real geometry",
  lengthError <= TARGETS.feedbackPercent && thicknessError <= TARGETS.feedbackPercent,
  `length error ${lengthError.toFixed(2)}% | span thickness reported ${reportedSpanThickness.toFixed(2)} vs real ${finalSpan.toFixed(2)} mm (${thicknessError.toFixed(2)}% error)`);

// ------------------------------------------------------------ T4: contract
const drift = Math.abs(realVolume(training) - realVolume(started)) / realVolume(started) * 100;
const replayed = replayForgeState(createForgeState({ material: HIGH_CARBON_STEEL }), training.operations);
const replayEqual = serializeForgeState(replayed) === serializeForgeState(training);
check("T4", "volume conserved and replay byte-identical",
  drift <= TARGETS.volumeDriftPercent && replayEqual,
  `geometric drift ${drift.toFixed(3)}% (fact says ${createForgeFacts(training).totalVolume.toFixed(0)} vs real ${realVolume(training).toFixed(1)}) | replay ${replayEqual ? "identical" : "DIFFERENT"}`);

const failed = results.filter(result => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} capability targets met${quick ? " (quick run)" : ""}`);
process.exit(failed.length === 0 ? 0 : 1);
