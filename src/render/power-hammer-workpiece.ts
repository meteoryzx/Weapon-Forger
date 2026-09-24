import { Box3, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Triangle, Vector3 } from "three";
import { HAMMER_HOME, hammerContact, hammerFrame, hammerSurface, placedHammerSurface, toAnvil, type ForgeSnapshot, type HammerPose, type HammerTriangle, type WorkpieceGeometry } from "../forge/index.ts";
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
  private readonly displayGroup = new Group();
  readonly item = new Mesh(new BufferGeometry(), new MeshStandardMaterial({metalness:0.65,roughness:0.47,side:DoubleSide}));
  readonly preview = new Mesh(new BufferGeometry(), new MeshBasicMaterial({color:0x9de6c6,transparent:true,opacity:0.38,depthWrite:false,side:DoubleSide,polygonOffset:true,polygonOffsetFactor:-2}));
  surface: readonly HammerTriangle[] = [];
  pose: HammerPose = {...HAMMER_HOME};
  private snapshot: ForgeSnapshot | null = null;
  private readonly placementCorners = new WeakMap<WorkpieceGeometry, readonly Vector3[]>();
  contact: ReturnType<typeof hammerContact> = null;
  contactHeight = 0;

  constructor(private readonly setup = { name:"power", dieZ:POWER_HAMMER.dieZ as number, obstacles:OBSTACLES }) {
    this.group.position.set(0,WORKSHOP_SURFACE_Y,u(setup.dieZ));
    this.group.scale.setScalar(u(1));
    this.group.add(this.displayGroup);
    this.displayGroup.matrixAutoUpdate=false;
    this.displayGroup.add(this.item,this.preview);
    this.item.name=`${setup.name}-workpiece`;
    this.preview.name=`${setup.name}-contact-preview`;
    this.preview.position.y=0.5;
  }
  update(snapshot: ForgeSnapshot, pose: HammerPose): void {
    const sameShape=this.snapshot?.geometry===snapshot.geometry && this.snapshot.averageTemperatureC===snapshot.averageTemperatureC;
    const samePose=sameShape && ["x","z","yaw","roll"].every(k=>this.pose[k as keyof HammerPose]===pose[k as keyof HammerPose]);
    if(samePose)return;
    const previousFrame=sameShape?hammerFrame(snapshot.geometry,this.pose):null;
    const currentFrame=hammerFrame(snapshot.geometry,pose);
    this.snapshot=snapshot;this.pose={...pose};
    this.surface=placedHammerSurface(snapshot.geometry,currentFrame);
    if(sameShape&&previousFrame){
      const relative=frameMatrix(currentFrame).multiply(frameMatrix(previousFrame).invert());
      this.displayGroup.matrix.premultiply(relative);
      this.displayGroup.matrixWorldNeedsUpdate=true;
    }else{
      this.displayGroup.matrix.identity();
      this.displayGroup.matrixWorldNeedsUpdate=true;
      const positions=this.surface.flatMap(t=>t.points.flatMap(p=>[p.x,p.y,p.z]));
      this.item.geometry.dispose();this.item.geometry=new BufferGeometry();
      this.item.geometry.setAttribute("position",new Float32BufferAttribute(positions,3));
      this.item.geometry.computeVertexNormals();
    }
    const color=thermalSteelAppearance(snapshot.averageTemperatureC);
    this.item.material.color.copy(color.surface).multiplyScalar(0.42);
    this.item.material.emissive.copy(color.emissive);this.item.material.emissiveIntensity=color.emissiveIntensity*0.12;
    this.contact=hammerContact(this.surface,0,0);
    const footprint=hammerFootprint(this.surface,0,0);
    this.contactHeight=0;
    for(let i=1;i<footprint.length;i+=3)this.contactHeight=Math.max(this.contactHeight,footprint[i]!);
    if(!sameShape){
      this.preview.geometry.dispose();this.preview.geometry=new BufferGeometry();
      this.preview.geometry.setAttribute("position",new Float32BufferAttribute(footprint,3));
    }
    this.preview.visible=!!this.contact?.supported;
  }
  canPlace(snapshot: ForgeSnapshot, pose: HammerPose): boolean {
    const count=Math.ceil(Math.max(Math.abs(pose.x-this.pose.x)/4,Math.abs(pose.z-this.pose.z)/4,
      Math.abs(pose.yaw-this.pose.yaw)/0.05,Math.abs(pose.roll-this.pose.roll)/0.05,1));
    if (!Number.isFinite(count)||count>180) return false;
    const corners=this.cornersFor(snapshot.geometry),triangle=new Triangle();
    // Reuse the triangle vertices for the whole sweep. Placement runs in the
    // keyboard/pointer event path, so allocating three new Vector3 objects
    // for every face and every interpolation step creates avoidable GC stalls.
    const trianglePoints=[new Vector3(),new Vector3(),new Vector3()] as const;
    // Reject an obstructed destination before sampling its swept path.
    for(let index=0;index<count;index++) {
      const step=index===0?count:index;
      const t=step/count, p={x:this.pose.x+(pose.x-this.pose.x)*t,z:this.pose.z+(pose.z-this.pose.z)*t,
        yaw:this.pose.yaw+(pose.yaw-this.pose.yaw)*t,roll:this.pose.roll+(pose.roll-this.pose.roll)*t};
      const bounds=new Box3();
      const frame=hammerFrame(snapshot.geometry,p);
      for(const corner of corners){const point=toAnvil({x:corner.x,y:corner.y,z:corner.z},frame);bounds.expandByPoint(new Vector3(point.x,point.y,point.z));}
      const obstacles=this.setup.obstacles.filter(b=>b.intersectsBox(bounds));
      if(!obstacles.length)continue;
      const surface=placedHammerSurface(snapshot.geometry,frame);
      for(const face of surface) {
        for(let pointIndex=0;pointIndex<3;pointIndex++) {
          const point=face.points[pointIndex]!;
          trianglePoints[pointIndex]!.set(point.x,point.y,point.z);
        }
        triangle.set(trianglePoints[0]!,trianglePoints[1]!,trianglePoints[2]!);
        if(obstacles.some(b=>b.intersectsTriangle(triangle)))return false;
      }
    }
    return true;
  }
  /** Conservative workpiece bounds in anvil-local millimetres for placement checks. */
  placementBounds(snapshot: ForgeSnapshot, pose: HammerPose): Box3 {
    const frame=hammerFrame(snapshot.geometry,pose),bounds=new Box3();
    for(const corner of this.cornersFor(snapshot.geometry)) {
      const point=toAnvil({x:corner.x,y:corner.y,z:corner.z},frame);
      bounds.expandByPoint(new Vector3(point.x,point.y,point.z));
    }
    return bounds;
  }
  private cornersFor(geometry: WorkpieceGeometry): readonly Vector3[] {
    const cached=this.placementCorners.get(geometry);
    if(cached)return cached;
    const bounds=new Box3();
    for(const triangle of hammerSurface(geometry)) for(const point of triangle.points)
      bounds.expandByPoint(new Vector3(point.x,point.y,point.z));
    const {min,max}=bounds;
    const corners=[
      new Vector3(min.x,min.y,min.z),new Vector3(min.x,min.y,max.z),new Vector3(min.x,max.y,min.z),new Vector3(min.x,max.y,max.z),
      new Vector3(max.x,min.y,min.z),new Vector3(max.x,min.y,max.z),new Vector3(max.x,max.y,min.z),new Vector3(max.x,max.y,max.z),
    ];
    this.placementCorners.set(geometry,corners);
    return corners;
  }
  dispose():void {
    this.item.geometry.dispose();this.item.material.dispose();this.preview.geometry.dispose();this.preview.material.dispose();
  }
}

function frameMatrix(frame: ReturnType<typeof hammerFrame>): Matrix4 {
  const matrix=new Matrix4().makeRotationX(frame.pose.roll);
  // `hammerFrame` and `rotateHammerPoint` use the physical convention
  // R_yaw * R_roll. The incremental display transform must use that same
  // convention; the old negative yaw mirrored the station frame and made a
  // later roll rotate around a world axis instead of the billet's long axis.
  matrix.premultiply(new Matrix4().makeRotationY(frame.pose.yaw));
  const center=new Vector3(frame.center.x,frame.center.y,frame.center.z).applyMatrix4(matrix);
  matrix.setPosition(new Vector3(frame.pose.x,frame.lift,frame.pose.z).sub(center));
  return matrix;
}
