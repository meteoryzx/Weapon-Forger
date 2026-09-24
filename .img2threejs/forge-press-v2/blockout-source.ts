import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Shape } from "three";
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
  function profile(parent: Group, name: string, points: readonly (readonly [number, number])[], depth: number, at: readonly [number, number, number], material = iron) {
    const shape = new Shape();
    points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
    shape.closePath();
    const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
    geometry.translate(0, 0, -depth / 2);
    return add(parent, name, geometry, at, material);
  }

  box(body, "base", [980, 100, 900], [0, 50, 0]);
  profile(body, "gate-frame", [
    [-460, 100], [-460, 1680], [-430, 1760], [-310, 1780],
    [310, 1780], [430, 1760], [460, 1680], [460, 100],
    [300, 100], [300, 1530], [260, 1580], [-260, 1580], [-300, 1530], [-300, 100],
  ], 480, [0, 0, 0]);
  profile(body, "pedestal", [[-190, 100], [190, 100], [155, 795], [-155, 795]], 330, [0, 0, 0]);
  cylinder(body, "cylinder-shell", 145, 330, [0, 1685, 0]);
  box(moving, "crosshead", [580, 160, 220], [0, 1200, 0]);
  cylinder(moving, "piston", 56, 440, [0, 1470, 0], steel);
  box(moving, "upper-holder", [150, 105, 135], [0, 1067.5, 0]);
  const upper = box(moving, "upper-die", [48, 20, 48], [0, 1005, 0], steel);
  box(body, "lower-holder", [270, 60, 155], [0, 825, 0]);
  const contact = box(body, "lower-support", [224, 20, 104], [0, 865, 0], steel);
  const control = box(body, "lever-valve", [30, 90, 65], [467, 1170, 80], brass);
  root.userData.referenceSource = "assets/concepts/forge-press-v2-main.png";
  root.userData.structureSource = ".img2threejs/forge-press-v2/object-sculpt-spec.json";
  root.userData.referenceMeshes = meshes;
  root.userData.sculptRuntime = { nodes: { root, body, ram, moving }, meshes };
  return { root, ram, control, contact, upper, openRamY: 0, closedRamY: -u(120) };
}
