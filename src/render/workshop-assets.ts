import { BufferGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from "three";
import { QUENCH_BODY_SCALE_Y, QUENCH_SURFACE_Y, WORKSHOP_FLOOR_Y, WORKSHOP_LAYOUT, WORKSHOP_UNITS_PER_MM } from "../app/workshop-scale.ts";
import { WorkshopModelKit } from "./workshop-model-kit.ts";
import { GrinderModel } from "./grinder-model.ts";

export interface StationAsset { root:Group; contact?:Mesh<BufferGeometry,MeshStandardMaterial>; control?:Mesh<BufferGeometry,MeshStandardMaterial> }
export interface PoweredForgingAsset extends StationAsset {
  ram: Group;
  control: Mesh<BufferGeometry, MeshStandardMaterial>;
  readonly openRamY: number;
  readonly closedRamY: number;
}

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
export function powerHammerAsset(k:WorkshopModelKit):PoweredForgingAsset {
  const root=new Group();root.name="power-hammer-low-poly";
  k.profile(root,"flared-base",[[-390,0],[390,0],[330,160],[-330,160]],650,[0,3,0],"painted-iron");
  // The approved reference is an enclosed C-frame. These three masses preserve
  // the load path and throat while deliberately omitting belt/flywheel detail.
  k.profile(root,"rear-cast-column",[[-310,0],[-40,0],[-15,1180],[-85,1510],[-285,1510]],480,[-40,145,115],"painted-iron");
  k.profile(root,"upper-drive-housing",[[-120,0],[390,0],[345,360],[-40,430],[-170,300]],500,[-15,1330,65],"painted-iron");
  k.profile(root,"lower-horn",[[-140,0],[300,0],[240,330],[-105,390]],420,[10,145,-10],"painted-iron");
  k.box(root,"rear-service-cover",[26,330,300],[-322,930,140],"iron",8);
  k.cylinder(root,"service-cap",105,34,[-338,1160,-35],"iron","x",12);
  k.box(root,"anvil-seat",[320,320,330],[115,660,-50],"iron",10);
  k.box(root,"lower-die",[250,55,210],[115,847.5,-50],"steel",5);
  for(const x of [-315,315])for(const z of [-250,250])k.cylinder(root,"anchor-bolt",18,34,[x,177,z],"steel","y",6);
  k.batch(root);

  const ram=new Group();ram.name="power-hammer-ram";ram.userData.keepMesh=true;
  k.cylinder(ram,"ram-guide",82,330,[115,0,-50],"steel","y",10);
  k.box(ram,"upper-die",[230,100,200],[115,-210,-50],"steel",5);
  const openRamY=1320*WORKSHOP_UNITS_PER_MM,closedRamY=1100*WORKSHOP_UNITS_PER_MM;ram.position.y=openRamY;root.add(ram);

  const control=k.cylinder(root,"power-control",18,360,[365,520,-250],"steel","z",8);
  control.userData.keepMesh=true;control.rotation.x=Math.PI/2;control.rotation.z=-0.18;
  const contact=k.box(root,"power-contact",[280,18,240],[115,885,-50],"steel",2);
  contact.userData.keepMesh=true;contact.material.transparent=true;contact.material.opacity=0;contact.material.depthWrite=false;
  return {root,ram,control,contact,openRamY,closedRamY};
}

export function forgingPressAsset(k:WorkshopModelKit):PoweredForgingAsset {
  const root=new Group();root.name="forging-press-low-poly";
  k.profile(root,"press-base",[[-470,0],[470,0],[410,170],[-410,170]],650,[0,3,0],"iron");
  k.box(root,"left-upright",[190,1150,310],[-330,735,40],"iron",10);
  k.box(root,"right-upright",[190,1150,310],[330,735,40],"iron",10);
  k.profile(root,"top-housing",[[-470,0],[470,0],[405,330],[-345,410],[345,410]],560,[0,1310,20],"iron");
  k.box(root,"left-joint-plate",[250,220,36],[-330,1370,-265],"iron",5);
  k.box(root,"right-joint-plate",[250,220,36],[330,1370,-265],"iron",5);
  k.box(root,"lower-pedestal",[420,390,380],[0,640,-30],"iron",8);
  k.box(root,"lower-die",[360,65,300],[0,867.5,-30],"steel",4);
  for(const x of [-400,400])for(const z of [-250,250])k.cylinder(root,"anchor-bolt",18,34,[x,187,z],"steel","y",6);
  k.batch(root);

  const ram=new Group();ram.name="forging-press-ram";ram.userData.keepMesh=true;
  k.cylinder(ram,"press-cylinder",92,360,[0,0,-30],"steel","y",10);
  k.box(ram,"upper-platen",[430,105,350],[0,-235,-30],"iron",6);
  k.box(ram,"upper-die",[340,75,285],[0,-325,-30],"steel",4);
  const openRamY=1460*WORKSHOP_UNITS_PER_MM,closedRamY=1260*WORKSHOP_UNITS_PER_MM;ram.position.y=openRamY;root.add(ram);

  const control=k.cylinder(root,"manual-pressure-switch",17,260,[480,710,-160],"steel","y",8);
  control.userData.keepMesh=true;control.rotation.z=-0.55;
  const contact=k.box(root,"press-contact",[390,18,330],[0,905,-30],"steel",2);
  contact.userData.keepMesh=true;contact.material.transparent=true;contact.material.opacity=0;contact.material.depthWrite=false;
  return {root,ram,control,contact,openRamY,closedRamY};
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
