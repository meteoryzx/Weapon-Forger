import { BufferGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from "three";
import { QUENCH_BODY_SCALE_Y, QUENCH_SURFACE_Y, WORKSHOP_FLOOR_Y, WORKSHOP_LAYOUT, WORKSHOP_UNITS_PER_MM } from "../app/workshop-scale.ts";
import { WorkshopModelKit } from "./workshop-model-kit.ts";
import { GrinderModel } from "./grinder-model.ts";

export interface StationAsset { root:Group; contact?:Mesh<BufferGeometry,MeshStandardMaterial>; control?:Mesh<BufferGeometry,MeshStandardMaterial> }

// The rendered room is the authority for wall clearance: its side walls are
// narrowed by ROOM_SCALE_X and its masonry has real thickness, so a station
// that fits the declared layout rectangle can still be inside the wall.
export const ROOM_SCALE_X = 0.72;
export const ROOM_SIDE_WALL_X_MM = 3460;
export const ROOM_WALL_THICKNESS_MM = 150;
export const ROOM_BACK_Z_MM = -2600;
export const ROOM_INTERIOR = {
  // Distance from the room centre to each finished interior wall face.
  halfWidthX: WORKSHOP_UNITS_PER_MM * (ROOM_SIDE_WALL_X_MM - ROOM_WALL_THICKNESS_MM / 2) * ROOM_SCALE_X,
  backZ: WORKSHOP_UNITS_PER_MM * (ROOM_BACK_Z_MM + ROOM_WALL_THICKNESS_MM / 2),
} as const;
export function basinAsset(k:WorkshopModelKit,oil:boolean):StationAsset {
  const root=new Group();root.name=oil?"oil-basin":"water-basin";
  root.scale.set(0.52,QUENCH_BODY_SCALE_Y,0.92);root.position.y=WORKSHOP_FLOOR_Y*(1-QUENCH_BODY_SCALE_Y);
  k.box(root,"basin-bottom",[800,50,850],[0,350,0],"iron");
  for(const x of [-375,375])k.box(root,"side-wall",[50,550,850],[x,650,0],"wood");
  for(const z of [-400,400])k.box(root,"end-wall",[700,550,50],[0,650,z],"wood");
  for(let i=-3;i<=3;i++)for(const z of [-425.5,425.5])k.box(root,"stave-joint",[2,510,1],[i*95,650,z],"endgrain",0);
  for(let i=-3;i<=3;i++)for(const x of [-400.5,400.5])k.box(root,"side-stave-joint",[1,510,2],[x,650,i*105],"endgrain",0);
  for(const x of [-375,375])for(const z of [-400,400])k.box(root,"corner-leg",[70,910,70],[x,455,z],"iron");
  for(const h of [410,830]){
    for(const x of [-400,400])k.box(root,"vertical-side-band",[18,42,850],[x,h,0],"iron");
    for(const z of [-425,425])k.box(root,"end-band",[800,42,18],[0,h,z],"iron");
  }
  for(const x of [-375,375])k.box(root,"rim-side",[70,35,850],[x,927.5,0],"steel");
  for(const z of [-400,400])k.box(root,"rim-end",[800,35,70],[0,927.5,z],"steel");
  for(const x of [-350,350])for(const h of [410,830])k.cylinder(root,"band-rivet",7,7,[x,h,438],"steel","z",6);
  k.cylinder(root,"drain",18,40,[230,380,440],"brass","z");
  k.batch(root);
  const water=new MeshStandardMaterial({color:oil?"#4f4530":"#367d83",metalness:0.1,roughness:oil?0.32:0.18,transparent:true,opacity:0.83,depthWrite:false});
  const contact=new Mesh(new PlaneGeometry(700*WORKSHOP_UNITS_PER_MM,800*WORKSHOP_UNITS_PER_MM),water);contact.rotation.x=-Math.PI/2;contact.position.y=(QUENCH_SURFACE_Y-root.position.y)/root.scale.y;contact.name="liquid-surface";root.add(contact);
  return {root,contact};
}
export function grindingAsset(_k:WorkshopModelKit):StationAsset {
  return {root:new GrinderModel().root};
}
export function powerHammerAsset(k:WorkshopModelKit):StationAsset {
  const root=new Group();root.name="power-hammer-reserved";
  k.box(root,"anchored-plinth",[820,100,960],[0,50,0],"stone");
  k.profile(root,"cast-base",[[-390,0],[390,0],[335,190],[-335,190]],780,[0,100,0],"iron");
  for(const x of [-275,275]){
    k.profile(root,"cast-frame",[[-90,0],[150,0],[140,1450],[60,1740],[-65,1720],[-100,1480]],110,[x,290,220],"iron");
    k.cylinder(root,"polished-guide",22,1350,[x,1100,-175],"steel");
    k.box(root,"guide-bearing",[120,95,120],[x,1500,-175],"iron");
  }
  k.box(root,"anvil-pedestal",[280,540,260],[0,560,-160],"iron");
  k.box(root,"lower-die",[200,45,145],[0,852.5,-160],"steel");
  k.box(root,"upper-die",[180,85,130],[0,1060,-160],"steel");
  k.box(root,"ram",[130,410,130],[0,1307.5,-160],"iron");
  k.box(root,"crosshead",[660,110,200],[0,1600,-140],"iron");
  k.ring(root,"eccentric-wheel",245,25,[0,2020,-140],"iron");
  for(let i=0;i<6;i++){
    const angle=i*Math.PI/3;
    k.beam(root,"wheel-spoke",[0,2020,-140],[Math.cos(angle)*235,2020+Math.sin(angle)*235,-140],35,40,"iron");
  }
  k.cylinder(root,"wheel-hub",65,150,[0,2020,-160],"brass","z");
  k.beam(root,"connecting-rod",[95,2100,-225],[0,1500,-225],55,30,"steel");
  k.cylinder(root,"rear-pulley",210,95,[0,1880,295],"iron","z",40);
  k.box(root,"belt-upper",[70,15,490],[0,2210,90],"endgrain");
  for(const x of [-335,335])for(const z of [-390,390])k.cylinder(root,"anchor-bolt",18,28,[x,125,z],"steel","y",6);
  k.batch(root);return {root};
}
export function roomAsset(k:WorkshopModelKit) {
  const root=new Group();root.name="continuous-workshop";
  root.scale.x=ROOM_SCALE_X;
  k.box(root,"floor-base",[7100,100,5300],[0,-66,0],"dark",0);
  for(let x=0;x<20;x++)for(let z=0;z<15;z++){
    k.box(root,"floor-paver",[346,16,342],[-3325+x*350,-8,-2420+z*346],"stone",3);
  }
  for(let row=0;row<10;row++)for(let col=0;col<20;col++){
    k.box(root,"north-masonry",[344,218,ROOM_WALL_THICKNESS_MM],[-3325+col*350,row*224+109,ROOM_BACK_Z_MM],"stone",6);
  }
  for(const x of [-ROOM_SIDE_WALL_X_MM,ROOM_SIDE_WALL_X_MM]){
    k.box(root,"low-side-wall",[ROOM_WALL_THICKNESS_MM,820,5200],[x,410,0],"stone");
    for(const z of [-2530,-1000,650,2400]){
      k.box(root,"wall-post",[150,2250,150],[x,1125,z],"endgrain");
    }
    k.box(root,"side-tie-beam",[165,150,5200],[x,2250,0],"wood");
  }
  for(const x of [-3400,-1700,0,1700,3400])k.box(root,"north-post",[150,2360,180],[x,1180,-2510],"wood");
  k.box(root,"north-tie-beam",[7000,160,180],[0,2320,-2510],"wood");
  // A window on the left is a shared room landmark, never a station-owned wall.
  for(const z of [-1800,-1300])for(const h of [1170,1620])k.box(root,"window-pane",[20,420,455],[-3420,h,z],"steel",0);
  for(const z of [-2050,-1550,-1050])k.box(root,"window-mullion",[65,1010,35],[-3380,1400,z],"wood");
  for(const h of [900,1400,1900])k.box(root,"window-crossbar",[65,40,1030],[-3380,h,-1550],"wood");
  k.batch(root);return root;
}
