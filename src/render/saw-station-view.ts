import { BoxGeometry, BufferGeometry, CylinderGeometry, DoubleSide, Group, Line, LineDashedMaterial,
  Mesh, MeshStandardMaterial, Raycaster, Vector3 } from "three";
import type { ForgeSnapshot, ForgeSnapshotWorkpiece } from "../forge/index.ts";
import { CUT_TABLE, SAW_PATH, cutBounds, type CutPose } from "../app/cut-placement.ts";

export const SAW_ORIGIN = new Vector3(-500, 0, 420);
export function sawCameraFrame(aspect: number) {
  const target = new Vector3(0, 103, 8).add(SAW_ORIGIN);
  const position = new Vector3(16, 244, 366).add(SAW_ORIGIN);
  position.sub(target).multiplyScalar(Math.max(1, 1.35 / aspect)).add(target);
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
  private readonly guide = new Line(new BufferGeometry(), new LineDashedMaterial({ color: "#bddfcb", dashSize: 4, gapSize: 3, depthTest: true }));
  private snapshot: ForgeSnapshot | null = null;
  private trayPieces: readonly ForgeSnapshotWorkpiece[] | null = null;
  private trayPage = -1;
  private animationStart: number | null = null;
  private active = false;
  private readonly metal = new MeshStandardMaterial({ color: "#63717b", metalness: 0.5, roughness: 0.55 });
  private readonly wood = new MeshStandardMaterial({ color: "#785137", roughness: 0.85 });

  constructor(private readonly geometryOf: (piece: ForgeSnapshotWorkpiece) => BufferGeometry) {
    this.group.position.copy(SAW_ORIGIN);
    this.group.rotation.y = Math.PI / 2;
    this.group.scale.set(0.82, 1, 0.82);
    this.table = this.box([204.2, 16, 250], [-102.9, 63, 0], this.wood);
    this.box([204.2,16,250],[102.9,63,0],this.wood);
    this.table.userData.station = "cut";
    for (const x of [-98.5,98.5]) this.box([196, 2, 234], [x,71,0], this.metal);
    for (const x of [-180,180]) for (const z of [-98,98]) this.box([18,92,18],[x,10,z],this.wood);
    this.box([385,14,14],[0,25,102],this.wood);
    this.box([74,8,38],[0,76,-100],this.metal);
    for(const x of [-24,24]) this.box([12,158,18],[x,154,-100],this.metal);
    this.box([68,14,152],[0,226,-37],this.metal);
    for(const x of [-30,30]) for(const z of [-111,-89]) {
      const bolt = new Mesh(new CylinderGeometry(4,4,3,6),this.metal);
      bolt.position.set(x,81,z); this.group.add(bolt);
    }
    this.group.add(this.head);
    this.box([26,52,27],[0,193,0],this.metal,this.head);
    const guard = new Mesh(new CylinderGeometry(57,57,17,32,1,false,0,Math.PI),this.metal);
    guard.rotation.z=Math.PI/2; guard.position.y=139;
    this.head.add(guard);
    this.head.add(this.blade);
    this.blade.name="saw-blade";
    this.guide.name="finite-cut-guide";
    this.blade.position.y=139;
    const steel = new MeshStandardMaterial({color:"#a2adb2",metalness:0.82,roughness:0.3});
    const disk = new Mesh(new CylinderGeometry(51,51,1,64),steel);
    disk.rotation.z=Math.PI/2; this.blade.add(disk);
    for(let i=0;i<48;i++) {
      const angle=i/48*Math.PI*2;
      const tooth=new Mesh(new BoxGeometry(1.2,4.5,3),steel);
      tooth.position.set(0,Math.cos(angle)*52,Math.sin(angle)*52);
      tooth.rotation.x=angle; this.blade.add(tooth);
    }
    const hub=new Mesh(new CylinderGeometry(8,8,25,12),this.metal);
    hub.rotation.z=Math.PI/2; this.blade.add(hub);
    this.box([14,12,40],[23,166,24],this.wood,this.head);
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
      points.push(new Vector3(0,CUT_TABLE.surface+0.55,z));
    }
    this.guide.geometry=new BufferGeometry().setFromPoints(points);
    this.guide.computeLineDistances();
    (this.guide.material as LineDashedMaterial).color.set(valid===true?"#b8efcb":valid===false?"#ed8668":"#d8c997");
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
      mesh.position.set(-(bounds.min.x+bounds.max.x)/2*scale,72.05-bounds.min.y*scale,-60-(bounds.min.z+bounds.max.z)/2*scale);
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
    this.head.position.y=-14*Math.sin(Math.min(t*4,1)*Math.PI/2)*Math.min(1,(1-t)*5);
    this.head.position.z=SAW_PATH.startZ+(SAW_PATH.endZ-SAW_PATH.startZ)*Math.min(1,Math.max(0,(t-0.2)/0.6));
    this.blade.rotation.x=now*0.024;
    if(t===1){this.animationStart=null;this.head.position.set(0,0,SAW_PATH.startZ);this.guide.visible=this.active;}
    return true;
  }
  get busy(): boolean {return this.animationStart!==null;}

  dispose(): void {
    const geometries=new Set<BufferGeometry>(), materials=new Set<MeshStandardMaterial|LineDashedMaterial>();
    this.group.traverse(object=>{if(object instanceof Mesh || object instanceof Line){geometries.add(object.geometry);if(!Array.isArray(object.material))materials.add(object.material as MeshStandardMaterial);}});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
  }
  private box(size:[number,number,number],position:[number,number,number],material:MeshStandardMaterial,parent=this.group): Mesh {
    const mesh=new Mesh(new BoxGeometry(...size),material);mesh.position.set(...position);parent.add(mesh);return mesh;
  }
}
