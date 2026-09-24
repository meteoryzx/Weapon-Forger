import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { FORGE_RULES, HAMMER_RULES } from "../forge/index.ts";
import { POWER_OPEN_GAP_MM } from "../app/power-hammer-cycle.ts";
import { WORKSHOP_FLOOR_Y, workshopUnits as u } from "../app/workshop-scale.ts";
import type { WorkshopModelKit } from "./workshop-model-kit.ts";
import { createEarlyIndustrialPneumaticPowerHammerModel, type ProceduralModelRuntime } from "./power-hammer-reference.generated.ts";

export const POWER_HAMMER = { dieZ: 500, surfaceY: 875, openGap: POWER_OPEN_GAP_MM } as const;

// Keep img2threejs geometry and pivots; this adapter only supplies workshop units,
// shared materials, the reference spec's major covers, travel and solver-sized tooling.
export function createPowerHammer(k: WorkshopModelKit) {
  const root=new Group(),ram=new Group(),moving=new Group();
  root.name="power-hammer-v2-img2threejs";
  const iron=k.materials.iron.clone();
  iron.color.set("#555f60");iron.roughness=0.72;iron.flatShading=true;
  const steel=k.materials.steel.clone();steel.flatShading=true;
  const brass=k.materials.brass.clone();brass.flatShading=true;
  const body=createEarlyIndustrialPneumaticPowerHammerModel({materialOverrides:{iron,steel,brass,container:iron}});
  const runtime=body.userData.sculptRuntime as ProceduralModelRuntime;
  // The reference blockout left the top oil cup 35 mm above the cap.
  runtime.nodes["lubricator-top"]!.position.y=392;
  // Structural parts from object-sculpt-spec.json, omitted by its blockout emitter.
  // The author approved this reduced-detail pass; the old fidelity gate stays failed.
  const coverMaterial=iron.clone();coverMaterial.color.set("#444d4e");
  const covers=[
    {id:"service-tall",size:[30,430,190],at:[263,1330,-245]},
    {id:"service-low",size:[30,320,300],at:[263,590,-300]},
    {id:"small-service-cover",size:[28,130,150],at:[262,300,-280]},
  ] as const;
  const attach=(id:string,mesh:Mesh,at:readonly [number,number,number])=>{
    const node=new Group();node.name=id;node.position.set(...at);node.add(mesh);
    mesh.name=id;mesh.castShadow=mesh.receiveShadow=true;
    runtime.nodes.root!.add(node);runtime.nodes[id]=node;runtime.meshes[id]=mesh;
  };
  for(const cover of covers)attach(cover.id,new Mesh(new RoundedBoxGeometry(...cover.size,1,3),coverMaterial),cover.at);
  const round=new Mesh(new CylinderGeometry(130,130,50,16),coverMaterial);
  round.rotation.z=Math.PI/2;
  // Embed 2 mm into the 250 mm half-width frame instead of leaving a 5 mm gap.
  attach("service-round",round,[273,1210,-485]);
  attach("lubricator-front",new Mesh(new CylinderGeometry(25,25,130,12),brass),[245,1640,500]);
  body.scale.setScalar(u(1));moving.scale.setScalar(u(1));
  body.position.y=moving.position.y=WORKSHOP_FLOOR_Y;
  root.add(body,ram);ram.add(moving);
  moving.add(runtime.nodes.ram!);
  runtime.meshes.root!.visible=false;
  // The reference holders remain; only the replaceable working faces change.
  const upperHolder=runtime.meshes["upper-die"]!,lowerHolder=runtime.meshes["lower-die"]!;
  upperHolder.geometry.scale(1,56/80,1);upperHolder.position.y=12;
  lowerHolder.geometry.scale(1,60/80,1);lowerHolder.position.y=-10;
  const upper=new Mesh(new BoxGeometry(HAMMER_RULES.face,24,HAMMER_RULES.face),steel);
  upper.name="power-contact-insert";upper.position.y=-28;runtime.nodes["upper-die"]!.add(upper);
  const lower=new Mesh(new BoxGeometry(FORGE_RULES.anvilFaceLength,20,FORGE_RULES.anvilFaceWidth),steel);
  lower.name="power-support-insert";lower.position.y=30;runtime.nodes["lower-die"]!.add(lower);
  upper.castShadow=upper.receiveShadow=lower.castShadow=lower.receiveShadow=true;
  root.userData.referenceSource=".img2threejs/power-hammer-v2/preview/createPowerHammerModel.ts";
  root.userData.structureSource=".img2threejs/power-hammer-v2/object-sculpt-spec.json";
  root.userData.referenceMeshes=runtime.meshes;
  return {root,ram,control:runtime.meshes["lubricator-rear"] as Mesh<BoxGeometry,MeshStandardMaterial>,
    contact:lower,upper,openRamY:0,closedRamY:-u(POWER_OPEN_GAP_MM)};
}
