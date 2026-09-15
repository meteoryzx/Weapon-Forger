import { Box3, BoxGeometry, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PointLight, Vector3 } from "three";
import type { ForgeSnapshot } from "../forge/index.ts";
import { thermalSteelAppearance } from "./thermal-color.ts";
import { FURNACE_BODY_SCALE_Y, FURNACE_HEARTH_Y, WORKSHOP_FLOOR_Y, WORKSHOP_UNITS_PER_MM, WORKSHOP_LAYOUT } from "../app/workshop-scale.ts";
import { WorkshopModelKit } from "./workshop-model-kit.ts";

export const FURNACE_ORIGIN = new Vector3(...WORKSHOP_LAYOUT.furnace!.origin);
export const FURNACE = { floor:WORKSHOP_FLOOR_Y,hearth:FURNACE_HEARTH_Y,front:24,rear:-48,halfOpening:24,ceiling:72,scale:WORKSHOP_UNITS_PER_MM } as const;
export function furnaceCameraFrame(aspect:number, origin = FURNACE_ORIGIN) {
  const target=new Vector3(0,48,30),offset=new Vector3(44,50,105).multiplyScalar(Math.max(1,1.2/aspect));
  return {position:target.clone().add(offset).add(origin).toArray(),target:target.add(origin).toArray()};
}
export class FurnaceStationView {
  readonly group=new Group();
  readonly body=new Group();
  readonly item=new Mesh(new BufferGeometry(),new MeshStandardMaterial({vertexColors:true,metalness:0.6,roughness:0.5,side:DoubleSide}));
  readonly itemRig=new Group();
  readonly temperControl:Mesh<BufferGeometry,MeshStandardMaterial>;
  readonly target=new Mesh(new BoxGeometry(76,42,75),new MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));
  private readonly kit=new WorkshopModelKit();
  private desiredZ=0;
  private outsideZ=0;
  private lastLocation:string|null=null;
  private lastId:string|null=null;
  private lastGeometryFingerprint:number|null=null;
  private lastTick:number|null=null;
  private manualPositioned=false;
  constructor(private readonly geometryFor:(snapshot:ForgeSnapshot)=>BufferGeometry, origin = FURNACE_ORIGIN, name = "heating-station") {
    this.group.position.copy(origin);this.group.name=name;this.body.name="open-forge";
    this.body.scale.set(0.72,FURNACE_BODY_SCALE_Y,1.22);this.body.position.y=WORKSHOP_FLOOR_Y*(1-FURNACE_BODY_SCALE_Y);
    const k=this.kit;
    for(const x of [-400,400])for(const z of [-535,565]) {
      k.box(this.body,"support-leg",[70,830,70],[x,415,z],"iron");
      k.box(this.body,"foot",[120,30,120],[x,15,z],"steel");
    }
    k.box(this.body,"hearth-base",[1000,65,1200],[0,815,0],"iron");
    k.box(this.body,"hearth-lining",[700,40,900],[0,855,-150],"brick",0);
    k.box(this.body,"front-table",[900,30,300],[0,860,450],"steel",0);
    for(const x of [-415,415]){
      k.box(this.body,"side-shell",[170,500,900],[x,1125,-150],"iron");
      k.box(this.body,"side-lining",[45,400,900],[x>0?327.5:-327.5,1075,-150],"brick");
      for(const z of [-570,270]){
        k.box(this.body,"mouth-upright",[80,520,45],[x,1115,z],"steel");
        for(const h of [960,1280])k.cylinder(this.body,"rivet",9,6,[x,h,z+25],"steel","z",6);
      }
      k.box(this.body,"lower-brace",[45,50,1100],[x,260,0],"iron");
    }
    k.box(this.body,"roof-lining",[660,40,900],[0,1295,-150],"brick");
    k.box(this.body,"roof",[1000,65,940],[0,1360,-150],"iron");
    for(const z of [-430,-150,130]){
      const burner=k.cylinder(this.body,"burner",42,330,[0,1557.5,z],"iron");burner.userData.keepMesh=true;
      k.cylinder(this.body,"burner-collar",70,40,[0,1410,z],"steel");
    }
    k.batch(this.body);
    this.temperControl=k.cylinder(this.body,"temperature-dial",32,18,[440,1040,300],"brass","z");
    k.box(this.body,"dial-pointer",[4,38,3],[440,1040,311],"dark",0);
    const glow=new PointLight("#ff8538",2200,125,2);glow.position.set(0,57,-10);this.group.add(glow);
    const liner=k.materials.brick;liner.emissive.set("#db5b15");liner.emissiveIntensity=0.55;
    this.target.position.set(0,56,-10);this.target.userData.station="furnace";
    this.itemRig.rotation.y=Math.PI/2;this.item.scale.setScalar(FURNACE.scale);this.item.castShadow=true;
    this.itemRig.add(this.item);this.group.add(this.body,this.target,this.itemRig);
  }
  update(snapshot:ForgeSnapshot) {
    const geometryFingerprint=fingerprintGeometry(snapshot.geometry);
    if (this.lastGeometryFingerprint !== geometryFingerprint) {
      this.item.geometry.dispose();this.item.geometry=this.geometryFor(snapshot);this.item.geometry.computeBoundingBox();
      this.lastGeometryFingerprint=geometryFingerprint;
    }
    const b=this.item.geometry.boundingBox!,c=b.getCenter(new Vector3()),length=(b.max.x-b.min.x)*FURNACE.scale;
    this.item.position.set(-c.x*FURNACE.scale,-b.min.y*FURNACE.scale,-c.z*FURNACE.scale);this.itemRig.position.y=FURNACE.hearth;
    // The rig rotates the billet's long axis into Z. Center its transformed
    // bounds inside the actual chamber span; the old front-relative offset
    // deliberately left the leading end outside the mouth.
    this.outsideZ=FURNACE.front+3+length/2;
    if(this.lastId!==snapshot.workpieceId||this.lastLocation===null){
      this.desiredZ=this.outsideZ;
      this.itemRig.position.z=this.desiredZ;
    }
    if(snapshot.billetLocation==="furnace" && this.lastLocation!=="furnace" && !this.manualPositioned){
      this.desiredZ=FURNACE.rear+length/2+4;
      this.itemRig.position.z=this.desiredZ;
    }
    this.lastId=snapshot.workpieceId;this.lastLocation=snapshot.billetLocation;
    const appearance=thermalSteelAppearance(snapshot.averageTemperatureC);
    this.item.material.emissive.copy(appearance.emissive);this.item.material.emissiveIntensity=appearance.emissiveIntensity;
  }
  setInsertionZ(z:number): void { this.manualPositioned=true;this.desiredZ=Math.max(-180,Math.min(120,z));this.itemRig.position.z=this.desiredZ; }
  insertionZ(): number { return this.desiredZ; }
  setManualOffset(offsetZ:number): void { this.setInsertionZ(this.outsideZ + Math.max(-70,Math.min(70,offsetZ))); }
  manualOffset(): number { return this.desiredZ - this.outsideZ; }
  clearManualOffset(): void { this.manualPositioned=false;this.desiredZ=this.outsideZ;this.itemRig.position.z=this.desiredZ; }
  isFullyInside(): boolean {
    this.group.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(this.item);
    const minZ = bounds.min.z - this.group.position.z;
    const maxZ = bounds.max.z - this.group.position.z;
    const minX = bounds.min.x - this.group.position.x;
    const maxX = bounds.max.x - this.group.position.x;
    return minZ > FURNACE.rear + 1 && maxZ < FURNACE.front - 1
      && minX > -FURNACE.halfOpening + 1 && maxX < FURNACE.halfOpening - 1;
  }
  isFullyOutside(): boolean {
    this.group.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(this.item);
    const minZ = bounds.min.z - this.group.position.z;
    const maxZ = bounds.max.z - this.group.position.z;
    return maxZ < FURNACE.rear - 1 || minZ > FURNACE.front + 1;
  }
  tick(now:number) {
    const dt=this.lastTick===null?0:Math.min(0.05,(now-this.lastTick)/1000);this.lastTick=now;
    const delta=this.desiredZ-this.itemRig.position.z;
    if(Math.abs(delta)<0.05){this.itemRig.position.z=this.desiredZ;return false;}
    this.itemRig.position.z+=delta*(1-Math.exp(-12*dt));return true;
  }
  dispose() {
    this.group.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});
    this.kit.woodTexture.dispose();this.kit.mineralTexture.dispose();
  }
}

function fingerprintGeometry(geometry:ForgeSnapshot["geometry"]):number {
  let hash=2166136261;
  const add=(value:number) => {
    hash^=Math.round(value*1000);
    hash=Math.imul(hash,16777619);
  };
  add(geometry.nodes.length);add(geometry.grid.widthBlocks);add(geometry.grid.heightBlocks);
  for(const node of geometry.nodes){add(node.axialPosition);add(node.lateralOffset);add(node.verticalOffset);}
  for(const solid of geometry.solids??[]){
    add(solid.vertices.length);add(solid.faces.length);
    for(const face of solid.faces)add(face.length);
  }
  return hash>>>0;
}
