import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, MeshBasicMaterial,
  CylinderGeometry, Euler, Vector3, DoubleSide } from "three";
import { HAMMER_HOME, HAMMER_RULES, hammerFrame, hammerSurface, placedHammerSurface, hammerContact, type HammerPose,
  type ForgeSnapshot, type HammerTriangle, type HammerContact } from "../forge/index.ts";
import { WORKSHOP_UNITS_PER_MM } from "../app/workshop-scale.ts";
import { thermalSteelAppearance } from "./thermal-color.ts";

export const ANVIL = { surface:72,scale:WORKSHOP_UNITS_PER_MM } as const;
export function hammerCameraFrame(aspect:number) {
  const distance=aspect<1.35?245:180;
  return {position:[0,72+distance*0.6,distance] as const,target:[0,73,0] as const};
}
export class HammerStationView {
  readonly group=new Group();
  readonly target:Mesh;
  readonly item=new Mesh(new BufferGeometry(),new MeshStandardMaterial({metalness:0.65,roughness:0.47,vertexColors:true,side:DoubleSide}));
  readonly tool=new Group();
  private readonly footprint=new Mesh(new BufferGeometry(),new MeshBasicMaterial({color:0x9de6c6,transparent:true,opacity:0.38,side:DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));
  private surface:readonly HammerTriangle[]=[];
  private snapshot:ForgeSnapshot|null=null;
  private aim:HammerContact|null=null;
  private strikeAt=-Infinity;
  private releaseAt=-Infinity;
  private animating=false;
  private energy=HAMMER_RULES.defaultEnergy as number;

  constructor() {
    const steel=new MeshStandardMaterial({color:0x434e54,metalness:0.72,roughness:0.5});
    const face=new MeshStandardMaterial({color:0x8d9699,metalness:0.65,roughness:0.38});
    const wood=new MeshStandardMaterial({color:0x59412d,roughness:0.9});
    const stone=new MeshStandardMaterial({color:0x4b5356,roughness:0.98});
    const ironBase=new MeshStandardMaterial({color:0x343d42,metalness:0.68,roughness:0.7});
    const box=(x:number,y:number,z:number,px:number,py:number,pz:number,material=steel)=>{
      const m=new Mesh(new BoxGeometry(x,y,z),material);m.position.set(px,py,pz);this.group.add(m);return m;
    };
    // The anvil is grounded on a heavy stone/iron foundation; it no longer
    // reads as a tabletop prop or as wood floating above the workshop floor.
    box(112,28,88,0,-16,0,stone);box(92,8,68,0,2,0,ironBase);box(43,31,32,0,21.5,0);box(67,20,43,0,47,0);
    this.target=box(224*ANVIL.scale,15,104*ANVIL.scale,0,64.5,0,face);
    this.target.userData.station="anvil";
    for(const side of [-1,1]){
      const horn=new Mesh(new CylinderGeometry(1,9,40,4),steel);
      horn.rotation.z=-side*Math.PI/2;horn.position.set(side*65,62,0);this.group.add(horn);
      for(const z of [-23,23])box(7,4,7,side*31,0,z,face);
    }
    const head=new Mesh(new BoxGeometry(HAMMER_RULES.face*ANVIL.scale,28,HAMMER_RULES.face*ANVIL.scale),steel);
    head.position.y=14;this.tool.add(head);
    const handle=new Mesh(new CylinderGeometry(2.4,3,66,10),wood);
    handle.rotation.z=-Math.PI/2+0.18;handle.position.set(35,22,0);this.tool.add(handle);
    this.group.add(this.item,this.tool,this.footprint);
    this.tool.visible=false;this.footprint.visible=false;
  }
  update(snapshot:ForgeSnapshot,pose:HammerPose):void {
    if(this.snapshot?.geometry!==snapshot.geometry || this.snapshot?.averageTemperatureC!==snapshot.averageTemperatureC){
      const positions:number[]=[],colors:number[]=[],color=thermalSteelAppearance(snapshot.averageTemperatureC).surface.multiplyScalar(0.42);
      for(const t of hammerSurface(snapshot.geometry))for(const p of t.points){positions.push(p.x,p.y,p.z);colors.push(color.r,color.g,color.b);}
      this.item.geometry.dispose();this.item.geometry=new BufferGeometry();
      this.item.geometry.setAttribute("position",new Float32BufferAttribute(positions,3));
      this.item.geometry.setAttribute("color",new Float32BufferAttribute(colors,3));this.item.geometry.computeVertexNormals();
    }
    this.snapshot=snapshot;
    const frame=hammerFrame(snapshot.geometry,pose);
    this.item.scale.setScalar(ANVIL.scale);
    this.item.rotation.set(pose.roll,pose.yaw,0,"YXZ");
    const center=new Vector3(frame.center.x,0,frame.center.z).applyEuler(new Euler(pose.roll,pose.yaw,0,"YXZ"));
    this.item.position.set((pose.x-center.x)*ANVIL.scale,ANVIL.surface+(frame.lift-center.y)*ANVIL.scale,(pose.z-center.z)*ANVIL.scale);
    const appearance=thermalSteelAppearance(snapshot.averageTemperatureC);
    this.item.material.emissive.copy(appearance.emissive);this.item.material.emissiveIntensity=appearance.emissiveIntensity*0.12;
    this.surface=placedHammerSurface(snapshot.geometry,frame);
    this.setAim(this.aim?.point ?? null,this.energy);
    this.group.updateMatrixWorld(true);
  }
  setActive(active:boolean):void {this.item.visible=active;this.tool.visible=active;this.footprint.visible=active&&this.aim!==null;}
  contact(x:number,z:number):HammerContact|null{return hammerContact(this.surface,x,z);}
  setAim(point:{x:number;z:number}|null,energy:number):HammerContact|null {
    this.energy=energy;this.aim=point?this.contact(point.x,point.z):null;
    this.footprint.visible=this.aim!==null;
    if(this.aim){
      const position:number[]=[],r=HAMMER_RULES.face/2,{x,z}=this.aim.point;
      // Clip real surface triangles to the square footprint, preserving all voids.
      for(const triangle of this.surface){
        let polygon=[...triangle.points];
        for(const [axis,edge,sign] of [["x",x-r,-1],["x",x+r,1],["z",z-r,-1],["z",z+r,1]] as const){
          const next:typeof polygon=[];
          for(let i=0;i<polygon.length;i++){
            const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,da=sign*(a[axis]-edge),db=sign*(b[axis]-edge);
            if(da<=0)next.push(a);
            if((da<0&&db>0)||(da>0&&db<0)){const t=da/(da-db);next.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});}
          }polygon=next;if(polygon.length<3)break;
        }
        for(let i=1;i+1<polygon.length;i++)for(const p of [polygon[0]!,polygon[i]!,polygon[i+1]!])position.push(p.x*ANVIL.scale,ANVIL.surface+p.y*ANVIL.scale+0.05,p.z*ANVIL.scale);
      }
      this.footprint.geometry.dispose();this.footprint.geometry=new BufferGeometry();
      this.footprint.geometry.setAttribute("position",new Float32BufferAttribute(position,3));
      this.footprint.material.color.set(this.aim.supported?0x9de6c6:0xf49b6b);
    }
    this.positionTool(performance.now());return this.aim;
  }
  strike(now:number):void {this.strikeAt=now;this.releaseAt=Infinity;this.animating=true;}
  finishStrike(now:number):void {this.releaseAt=Math.max(now,this.strikeAt+96);}
  dispose():void {
    const geometries=new Set<BufferGeometry>(),materials=new Set<MeshStandardMaterial|MeshBasicMaterial>();
    this.group.traverse(object=>{if(object instanceof Mesh){geometries.add(object.geometry);for(const m of Array.isArray(object.material)?object.material:[object.material])materials.add(m);}});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
  }
  get busy():boolean {return performance.now()-this.releaseAt<150;}
  tick(now:number):boolean {
    if(!this.animating)return false;
    this.positionTool(now);
    // A suspended tab or a slow frame can skip the entire recovery interval.
    // Render the final raised pose once before stopping animation updates.
    if(now-this.releaseAt>=150)this.animating=false;
    return true;
  }
  private positionTool(now:number):void {
    const p=this.aim?.point ?? {x:70,y:8,z:0};
    const rest=22+this.energy*18;
    const lift=now-this.strikeAt<96?rest*(1-(now-this.strikeAt)/96):
      now<this.releaseAt?0:rest*Math.min(1,(now-this.releaseAt)/150);
    this.tool.position.set(p.x*ANVIL.scale,ANVIL.surface+p.y*ANVIL.scale+lift,p.z*ANVIL.scale);
  }
}
