import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Shape, SphereGeometry, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { WORKSHOP_FLOOR_Y, workshopUnits as u } from "../app/workshop-scale.ts";
import type { WorkshopModelKit } from "./workshop-model-kit.ts";

export const FORGE_PRESS = { dieZ: 0, surfaceY: 875, openGap: 120 } as const;

// Millimetre-authored casting profiles; scene translation stays on root/ram.
export function createForgePress(k: WorkshopModelKit) {
  const root = new Group(), body = new Group(), ram = new Group(), moving = new Group();
  root.name = "forge-press-v2-img2threejs";
  body.name = "press-static"; ram.name = "press-ram"; moving.name = "press-moving-mm";
  body.scale.setScalar(u(1)); moving.scale.setScalar(u(1));
  body.position.y = moving.position.y = WORKSHOP_FLOOR_Y;
  root.add(body, ram); ram.add(moving);
  const iron = k.materials.iron.clone();
  iron.color.set("#555f60"); iron.roughness = 0.72; iron.flatShading = true;
  const steel = k.materials.steel.clone(); steel.flatShading = true;
  const brass = k.materials.brass.clone(); brass.flatShading = true;
  const meshes: Record<string, Mesh<import("three").BufferGeometry, MeshStandardMaterial>> = {};
  function add(parent: Group, name: string, geometry: import("three").BufferGeometry, at: readonly [number, number, number], material = iron) {
    const mesh = new Mesh(geometry, material);
    mesh.name = name; mesh.position.set(...at);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.keepMesh = true;
    parent.add(mesh); meshes[name] = mesh;
    return mesh;
  }
  function box(parent: Group, name: string, size: readonly [number, number, number], at: readonly [number, number, number], material = iron) {
    return add(parent, name, new BoxGeometry(...size), at, material);
  }
  function cylinder(parent: Group, name: string, radius: number, height: number, at: readonly [number, number, number], material = iron, segments = 16) {
    return add(parent, name, new CylinderGeometry(radius, radius, height, segments), at, material);
  }
  function profile(parent: Group, name: string, points: readonly (readonly [number, number])[], depth: number, at: readonly [number, number, number], material = iron, bevel = 0) {
    const shape = new Shape();
    points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
    shape.closePath();
    const geometry = new ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, steps: 1 });
    geometry.translate(0, 0, -(depth - bevel * 2) / 2);
    return add(parent, name, geometry, at, material);
  }

  box(body, "base", [980, 100, 900], [0, 50, 0]);
  profile(body, "gate-frame", [
    [-457, 103], [-457, 1680], [-428, 1757], [-310, 1777],
    [310, 1777], [428, 1757], [457, 1680], [457, 103],
    [303, 103], [303, 1530], [261, 1583], [-261, 1583], [-303, 1530], [-303, 103],
  ], 480, [0, 0, 0], iron, 3);
  profile(body, "pedestal", [[-270, 100], [270, 100], [220, 795], [-220, 795]], 500, [0, 0, 0]);
  cylinder(body, "cylinder-shell", 145, 330, [0, 1685, 0]);
  profile(moving, "crosshead", [[-270, 1050], [270, 1050], [270, 1210], [215, 1210], [185, 1190], [-185, 1190], [-215, 1210], [-270, 1210]], 260, [0, 0, 0]);
  cylinder(moving, "piston", 56, 510, [0, 1435, 0], steel);
  box(moving, "upper-holder", [150, 35, 135], [0, 1032.5, 0]);
  const upper = box(moving, "upper-die", [48, 20, 48], [0, 1005, 0], steel);
  box(body, "lower-holder", [320, 60, 220], [0, 825, 0]);
  const contact = box(body, "lower-support", [224, 20, 104], [0, 865, 0], steel);
  for (const side of [-1, 1]) {
    const suffix = side < 0 ? "left" : "right";
    box(body, `guide-${suffix}`, [30, 800, 90], [side * 287, 1215, 200], steel);
    // Two flanges and an inner web make an actual open guide shoe, not a solid rail intersection.
    const shoe = new Group(); shoe.name = `shoe-${suffix}`; moving.add(shoe);
    box(shoe, `shoe-${suffix}-front`, [80, 200, 22], [side * 290, 1130, 256]);
    box(shoe, `shoe-${suffix}-rear`, [80, 200, 22], [side * 290, 1130, 144]);
    box(shoe, `shoe-${suffix}-web`, [18, 200, 260], [side * 259, 1130, 126]);
    for (const zSide of [-1, 1]) {
      const brace = profile(body, `foot-brace-${suffix}-${zSide}`, [[230, 100], [435, 100], [230, 410]], 120, [side * 380, 0, 0]);
      brace.rotation.y = -zSide * Math.PI / 2;
      const foot = add(body, `foot-pad-${suffix}-${zSide}`, new RoundedBoxGeometry(130, 110, 130, 1, 6), [side * 425, 55, zSide * 375]);
      foot.userData.explodeWithParent = true;
      cylinder(body, `foot-bolt-${suffix}-${zSide}`, 22, 22, [side * 425, 120, zSide * 375], steel, 6);
    }
    add(body, `shoulder-${suffix}`, new RoundedBoxGeometry(200, 200, 500, 1, 8), [side * 355, 1680, 0]);
    cylinder(body, `post-cap-${suffix}`, 75, 40, [side * 355, 1800, 0], iron, 8);
    cylinder(body, `post-bolt-${suffix}`, 35, 26, [side * 355, 1833, 0], steel, 6);
    for (const y of [1060, 1200]) {
      const bolt = cylinder(shoe, `shoe-bolt-${suffix}-${y}`, 16, 12, [side * 290, y, 270], steel, 6);
      bolt.rotation.x = Math.PI / 2;
    }
  }
  cylinder(body, "cylinder-collar", 158, 28, [0, 1525, 0]);
  cylinder(body, "piston-gland", 100, 18, [0, 1505, 0], steel);
  cylinder(body, "cylinder-cap", 154, 28, [0, 1840, 0]);
  cylinder(body, "oil-cup", 22, 46, [0, 1877, 0], brass, 12);
  cylinder(moving, "piston-seat", 85, 30, [0, 1200, 0]);
  const cover = iron.clone(); cover.color.set("#444d4e");
  add(body, "service-panel", new RoundedBoxGeometry(14, 310, 245, 1, 5), [462, 885, -5], cover);
  const gaugeMount = cylinder(body, "gauge-mount", 30, 24, [461, 1420, 90]); gaugeMount.rotation.z = Math.PI / 2;
  const gauge = cylinder(body, "gauge", 60, 28, [476, 1420, 90], brass); gauge.rotation.z = Math.PI / 2;
  const dialMaterial = new MeshStandardMaterial({ color: "#e3dfcf", roughness: 0.85 });
  const dial = cylinder(body, "gauge-face", 50, 2, [491, 1420, 90], dialMaterial); dial.rotation.z = Math.PI / 2;
  const dark = k.materials.dark.clone();
  for (let i = 0; i < 9; i++) {
    const angle = -Math.PI * 0.75 + i * Math.PI * 1.5 / 8;
    const tick = box(body, `dial-tick-${i}`, [1.5, i % 2 ? 7 : 11, 3], [492.5, 1420 + Math.cos(angle) * 39, 90 + Math.sin(angle) * 39], dark);
    tick.rotation.x = angle;
    tick.userData.explodeWithParent = true;
  }
  const needle = box(body, "dial-needle", [2, 35, 3], [493, 1431, 100], dark); needle.rotation.x = -0.7;
  const hub = cylinder(body, "dial-hub", 5, 3, [493, 1420, 90], brass, 12); hub.rotation.z = Math.PI / 2;
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3;
    cylinder(body, `cap-bolt-${i}`, 15, 20, [Math.cos(angle) * 120, 1863, Math.sin(angle) * 120], steel, 6);
  }
  const control = add(body, "lever-valve", new RoundedBoxGeometry(30, 90, 65, 1, 4), [467, 1170, 80], brass);
  const spindle = cylinder(body, "lever-spindle", 22, 26, [475, 1170, 80], brass, 12); spindle.rotation.z = Math.PI / 2;
  const start = new Vector3(478, 1170, 80), end = new Vector3(478, 1310, 205);
  const lever = cylinder(body, "lever", 8, start.distanceTo(end), start.clone().add(end).multiplyScalar(0.5).toArray() as [number, number, number], brass, 12);
  lever.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), end.clone().sub(start).normalize());
  add(body, "lever-grip", new SphereGeometry(18, 12, 8), [478, 1310, 205], dark);
  control.userData.action = "forge-press-control";
  contact.userData.action = "forge-press-support";
  root.userData.referenceSource = "assets/concepts/forge-press-v2-main.png";
  root.userData.structureSource = ".img2threejs/forge-press-v2/object-sculpt-spec.json";
  root.userData.referenceMeshes = meshes;
  root.userData.sculptRuntime = {
    nodes: { root, body, ram, moving }, meshes,
    sockets: { lowerContact: [0, WORKSHOP_FLOOR_Y + u(875), 0], upperOpenContact: [0, WORKSHOP_FLOOR_Y + u(995), 0] },
    constraints: { ram: { axis: "y", min: -u(120), max: 0 } },
    parts: Object.values(meshes).map(mesh => ({ name: mesh.name, mesh, restPosition: mesh.position.clone(), explodeWithParent: Boolean(mesh.userData.explodeWithParent) })),
  };
  return { root, ram, control, contact, upper, openRamY: 0, closedRamY: -u(120) };
}
