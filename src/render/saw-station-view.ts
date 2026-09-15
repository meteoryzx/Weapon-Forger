import { BoxGeometry, BufferGeometry, CylinderGeometry, DoubleSide, Group, Line, LineBasicMaterial,
  Mesh, MeshStandardMaterial, Raycaster, Vector3 } from "three";
import type { ForgeSnapshot, ForgeSnapshotWorkpiece } from "../forge/index.ts";
import { CUT_TABLE, SAW_PATH, cutBounds, type CutPose } from "../app/cut-placement.ts";
import { WORKSHOP_LAYOUT, WORKSHOP_SURFACE_Y } from "../app/workshop-scale.ts";
import { WorkshopModelKit } from "./workshop-model-kit.ts";

export const SAW_ORIGIN = new Vector3(...WORKSHOP_LAYOUT.cut!.origin);
export function sawCameraFrame(aspect: number) {
  const target = new Vector3(0, WORKSHOP_SURFACE_Y + 4, 0).add(SAW_ORIGIN);
  const position = new Vector3(92, 100, 0).add(SAW_ORIGIN);
  position.sub(target).multiplyScalar(Math.max(1, 1.05 / aspect)).add(target);
  return { position: position.toArray(), target: target.toArray() };
}

export class SawStationView {
  readonly group = new Group();
  readonly table: Mesh;
  readonly item = new Mesh(new BufferGeometry(), new MeshStandardMaterial({ color: "#c7cdd0", vertexColors: true, metalness: 0.7, roughness: 0.43, side: DoubleSide }));
  readonly stock = new Group();
  readonly tray = new Group();
  private readonly head = new Group();
  private readonly blade = new Group();
  private readonly guide = new Line(new BufferGeometry(), new LineBasicMaterial({ color: "#bddfcb", depthTest: true }));
  private snapshot: ForgeSnapshot | null = null;
  private trayPieces: readonly ForgeSnapshotWorkpiece[] | null = null;
  private trayPage = -1;
  private animationStart: number | null = null;
  private active = false;
  private readonly metal = new MeshStandardMaterial({ color: "#63717b", metalness: 0.5, roughness: 0.55 });
  private readonly wood = new MeshStandardMaterial({ color: "#785137", roughness: 0.85 });
  private readonly kit = new WorkshopModelKit();

  constructor(private readonly geometryOf: (piece: ForgeSnapshotWorkpiece) => BufferGeometry) {
    this.group.position.copy(SAW_ORIGIN);
    this.group.rotation.y = Math.PI / 2;
    this.table = this.kit.bench(this.group,1200,800,0,871);
    this.table.userData.station = "cut";
    this.table.userData.keepMesh=true;
    this.kit.box(this.group,"cutting-plate",[1060,4,740],[0,873,0],"steel",0);
    this.kit.ruler(this.group,500,[0,875,350]);
    this.kit.box(this.group,"saw-base",[340,45,200],[0,897.5,-270],"iron");
    for(const x of [-120,120])this.kit.box(this.group,"guide-upright",[55,510,60],[x,1175,-270],"iron");
    this.kit.box(this.group,"cantilever",[320,75,520],[0,1420,-100],"iron");
    for(const x of [-125,125])for(const z of [-335,-205])this.kit.cylinder(this.group,"base-bolt",12,8,[x,924,z],"steel","y",6);
    this.kit.batch(this.group);
    this.group.add(this.head);
    this.box([14,14,14],[0,78,0],this.metal,this.head);
    const guard = new Mesh(new CylinderGeometry(18.5,18.5,7,32,1,false,0,Math.PI),this.kit.materials.iron);
    guard.rotation.z=Math.PI/2; guard.position.y=WORKSHOP_SURFACE_Y + 23;
    this.head.add(guard);
    this.head.add(this.blade);
    this.blade.name="saw-blade";
    this.guide.name="finite-cut-guide";
    this.blade.position.y=WORKSHOP_SURFACE_Y + 23;
    const steel = this.kit.materials.steel;
    const disk = new Mesh(new CylinderGeometry(17.5,17.5,0.18,64),steel);
    disk.rotation.z=Math.PI/2; this.blade.add(disk);
    for(let i=0;i<48;i++) {
      const angle=i/48*Math.PI*2;
      const tooth=new Mesh(new BoxGeometry(0.2,0.9,0.65),steel);
      tooth.position.set(0,Math.cos(angle)*17.7,Math.sin(angle)*17.7);
      tooth.rotation.x=angle; this.blade.add(tooth);
    }
    const hub=new Mesh(new CylinderGeometry(3.5,3.5,8,12),this.metal);
    hub.rotation.z=Math.PI/2; this.blade.add(hub);
    this.kit.batch(this.blade);
    this.box([3,3,25],[5,75,14],this.wood,this.head);
    this.head.position.z=SAW_PATH.startZ;
    this.stock.add(this.item); this.group.add(this.stock,this.guide,this.tray);
  }

  update(snapshot: ForgeSnapshot, pose: CutPose, valid: boolean | null): void {
    const changed = this.snapshot?.workpieceId !== snapshot.workpieceId || this.snapshot?.geometry !== snapshot.geometry;
    if (changed) { this.item.geometry.dispose(); this.item.geometry=this.geometryOf(snapshot); }
    this.snapshot=snapshot;
    const b=cutBounds(snapshot), scale=CUT_TABLE.scale;
    this.item.scale.setScalar(scale);
    this.item.position.set(-(b.minX+b.maxX)/2*scale,-b.minY*scale,-(b.minZ+b.maxZ)/2*scale);
    this.stock.position.set(pose.x,CUT_TABLE.surface+0.05,pose.z);
    this.stock.rotation.y=pose.angle;
    this.guide.geometry.dispose();
    // One finite guide in the blade's YZ plane. Drape it over the actual top
    // surface with a short vertical ray, never draw an infinite screen line.
    this.stock.updateMatrixWorld(true);
    const points: Vector3[]=[];
    const ray=new Raycaster();
    this.group.updateMatrixWorld(true);
    for(let i=0;i<=40;i++) {
      const z=SAW_PATH.startZ+(SAW_PATH.endZ-SAW_PATH.startZ)*i/40;
      const origin=this.group.localToWorld(new Vector3(0,CUT_TABLE.surface+100,z));
      ray.set(origin,new Vector3(0,-1,0));
      const hit=ray.intersectObject(this.item,false)[0];
      points.push(new Vector3(0,(hit?.point.y??CUT_TABLE.surface)+0.08,z));
    }
    this.guide.geometry=new BufferGeometry().setFromPoints(points);
    (this.guide.material as LineBasicMaterial).color.set(valid===true?"#b8efcb":valid===false?"#ed8668":"#d8c997");
    this.guide.visible=this.active && this.animationStart===null;
  }

  updateTray(pieces: readonly ForgeSnapshotWorkpiece[], page: number): void {
    if(this.trayPieces===pieces && this.trayPage===page)return;
    this.trayPieces=pieces;this.trayPage=page;
    for(const child of [...this.tray.children]) { this.tray.remove(child); if(child instanceof Mesh) {child.geometry.dispose(); (child.material as MeshStandardMaterial).dispose();} }
    pieces.slice(page,page+1).forEach((piece)=>{
      const geometry=this.geometryOf(piece); geometry.computeBoundingBox();
      const bounds=geometry.boundingBox!;
      const mesh=new Mesh(geometry,new MeshStandardMaterial({color:"#8f9ca2",vertexColors:true,metalness:0.6,roughness:0.5,side:DoubleSide}));
      const scale=CUT_TABLE.scale;
      mesh.scale.setScalar(scale);
      mesh.position.set(28-(bounds.min.x+bounds.max.x)/2*scale,WORKSHOP_SURFACE_Y+0.05-bounds.min.y*scale,24-(bounds.min.z+bounds.max.z)/2*scale);
      mesh.userData.workpieceId=piece.workpieceId;
      this.tray.add(mesh);
    });
  }

  beginCut(now: number): void { this.animationStart=now; this.guide.visible=false; }
  setActive(active: boolean): void {
    this.active=active;this.stock.visible=active;this.tray.visible=active;
    this.guide.visible=active && this.animationStart===null;
  }
  tick(now: number): boolean {
    if(this.animationStart===null)return false;
    const t=Math.min(1,(now-this.animationStart)/1100);
    this.head.position.y=-6.2*Math.sin(Math.min(t*4,1)*Math.PI/2)*Math.min(1,(1-t)*5);
    this.head.position.z=SAW_PATH.startZ+(SAW_PATH.endZ-SAW_PATH.startZ)*Math.min(1,Math.max(0,(t-0.2)/0.6));
    this.blade.rotation.x=now*0.024;
    if(t===1){this.animationStart=null;this.head.position.set(0,0,SAW_PATH.startZ);this.guide.visible=this.active;}
    return true;
  }
  get busy(): boolean {return this.animationStart!==null;}

  dispose(): void {
    const geometries=new Set<BufferGeometry>(), materials=new Set<MeshStandardMaterial|LineBasicMaterial>();
    this.group.traverse(object=>{if(object instanceof Mesh || object instanceof Line){geometries.add(object.geometry);if(!Array.isArray(object.material))materials.add(object.material as MeshStandardMaterial);}});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
    this.kit.woodTexture.dispose();this.kit.mineralTexture.dispose();
  }
  private box(size:[number,number,number],position:[number,number,number],material:MeshStandardMaterial,parent=this.group): Mesh {
    const mesh=new Mesh(new BoxGeometry(...size),material);mesh.position.set(...position);parent.add(mesh);return mesh;
  }
}
