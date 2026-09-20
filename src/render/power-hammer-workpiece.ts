import { Box3, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Triangle, Vector3 } from "three";
import { HAMMER_HOME, hammerContact, hammerFrame, placedHammerSurface, type ForgeSnapshot, type HammerPose, type HammerTriangle } from "../forge/index.ts";
import { WORKSHOP_SURFACE_Y, workshopUnits as u } from "../app/workshop-scale.ts";
import { POWER_HAMMER } from "./power-hammer-model.ts";
import { hammerFootprint } from "./hammer-footprint.ts";
import { thermalSteelAppearance } from "./thermal-color.ts";

const box = (lo: number[], hi: number[]) => new Box3(new Vector3(...lo), new Vector3(...hi));
// Conservative solid regions of the actual model in die-centred millimetres.
const OBSTACLES = [
  box([-250,-440,-1150],[250,750,-545]),
  box([-250,405,-545],[250,1050,275]),
  box([-150,-715,-170],[150,-100,170]),
  box([-130,-100,-135],[130,-60,135]),
  box([-90,-80,-90],[90,-20,90]),
  box([-112,-20,-52],[112,-0.05,52]),
  box([-90,144,-90],[90,200,90]),
  box([-105,180,-105],[105,230,105]),
  box([-24,POWER_HAMMER.openGap+0.05,-24],[24,144,24]),
];

export class PowerHammerWorkpiece {
  readonly group = new Group();
  readonly item = new Mesh(new BufferGeometry(), new MeshStandardMaterial({metalness:0.65,roughness:0.47,side:DoubleSide}));
  readonly preview = new Mesh(new BufferGeometry(), new MeshBasicMaterial({color:0x9de6c6,transparent:true,opacity:0.38,depthWrite:false,side:DoubleSide,polygonOffset:true,polygonOffsetFactor:-2}));
  surface: readonly HammerTriangle[] = [];
  pose: HammerPose = {...HAMMER_HOME};
  private snapshot: ForgeSnapshot | null = null;
  contact: ReturnType<typeof hammerContact> = null;
  contactHeight = 0;

  constructor() {
    this.group.position.set(0,WORKSHOP_SURFACE_Y,u(POWER_HAMMER.dieZ));
    this.group.scale.setScalar(u(1));
    this.group.add(this.item,this.preview);
    this.item.name="power-workpiece";
    this.preview.name="power-contact-preview";
    this.preview.position.y=0.5;
  }
  update(snapshot: ForgeSnapshot, pose: HammerPose): void {
    if (this.snapshot?.geometry===snapshot.geometry && this.snapshot.averageTemperatureC===snapshot.averageTemperatureC &&
      ["x","z","yaw","roll"].every(k=>this.pose[k as keyof HammerPose]===pose[k as keyof HammerPose])) return;
    this.snapshot=snapshot;this.pose={...pose};
    this.surface=placedHammerSurface(snapshot.geometry,hammerFrame(snapshot.geometry,pose));
    const positions=this.surface.flatMap(t=>t.points.flatMap(p=>[p.x,p.y,p.z]));
    this.item.geometry.dispose();this.item.geometry=new BufferGeometry();
    this.item.geometry.setAttribute("position",new Float32BufferAttribute(positions,3));
    this.item.geometry.computeVertexNormals();
    const color=thermalSteelAppearance(snapshot.averageTemperatureC);
    this.item.material.color.copy(color.surface).multiplyScalar(0.42);
    this.item.material.emissive.copy(color.emissive);this.item.material.emissiveIntensity=color.emissiveIntensity*0.12;
    this.contact=hammerContact(this.surface,0,0);
    const footprint=hammerFootprint(this.surface,0,0);
    this.contactHeight=0;
    for(let i=1;i<footprint.length;i+=3)this.contactHeight=Math.max(this.contactHeight,footprint[i]!);
    this.preview.geometry.dispose();this.preview.geometry=new BufferGeometry();
    this.preview.geometry.setAttribute("position",new Float32BufferAttribute(footprint,3));
    this.preview.visible=!!this.contact?.supported;
  }
  canPlace(snapshot: ForgeSnapshot, pose: HammerPose): boolean {
    const count=Math.ceil(Math.max(Math.abs(pose.x-this.pose.x)/4,Math.abs(pose.z-this.pose.z)/4,
      Math.abs(pose.yaw-this.pose.yaw)/0.05,Math.abs(pose.roll-this.pose.roll)/0.05,1));
    if (!Number.isFinite(count)||count>180) return false;
    const triangle=new Triangle();
    // Reject an obstructed destination before sampling its swept path.
    for(let index=0;index<count;index++) {
      const step=index===0?count:index;
      const t=step/count, p={x:this.pose.x+(pose.x-this.pose.x)*t,z:this.pose.z+(pose.z-this.pose.z)*t,
        yaw:this.pose.yaw+(pose.yaw-this.pose.yaw)*t,roll:this.pose.roll+(pose.roll-this.pose.roll)*t};
      const surface=placedHammerSurface(snapshot.geometry,hammerFrame(snapshot.geometry,p));
      const bounds=new Box3();
      for(const face of surface)for(const q of face.points)bounds.expandByPoint(new Vector3(q.x,q.y,q.z));
      const obstacles=OBSTACLES.filter(b=>b.intersectsBox(bounds));
      if(!obstacles.length)continue;
      for(const face of surface) {
        triangle.set(...face.points.map(q=>new Vector3(q.x,q.y,q.z)) as [Vector3,Vector3,Vector3]);
        if(obstacles.some(b=>b.intersectsTriangle(triangle)))return false;
      }
    }
    return true;
  }
  dispose():void {
    this.item.geometry.dispose();this.item.material.dispose();this.preview.geometry.dispose();this.preview.material.dispose();
  }
}
