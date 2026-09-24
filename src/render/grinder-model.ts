import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, DataTexture, ExtrudeGeometry,
  Float32BufferAttribute, Group, InstancedMesh, LinearMipmapLinearFilter, Matrix4,
  Mesh, MeshStandardMaterial, Object3D, RepeatWrapping, RGBAFormat, Shape, SRGBColorSpace,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WORKSHOP_FLOOR_Y, WORKSHOP_UNITS_PER_MM } from '../app/workshop-scale.ts';

export const GRINDER = {
  upperY:1160, lowerY:300, wheelRadius:120, beltThickness:3, beltWidth:120,
  restY:875, frontX:-123, restFrontX:-361, restBackX:-126, restWidth:440,
  speedMmPerSecond:700,
} as const;
export type GrinderPass = 'blockout' | 'structure' | 'form' | 'material';

// A single path drives the abrasive surface, UV motion and wheel animation.
export function beltPath(distance:number, radius:number=GRINDER.wheelRadius+GRINDER.beltThickness) {
  const straight=GRINDER.upperY-GRINDER.lowerY,arc=Math.PI*radius;
  const length=2*straight+2*arc;
  const s=((distance%length)+length)%length;
  if(s<straight)return {x:-radius,y:GRINDER.upperY-s,nx:-1,ny:0};
  if(s<straight+arc){
    const a=Math.PI+(s-straight)/radius;
    return {x:radius*Math.cos(a),y:GRINDER.lowerY+radius*Math.sin(a),nx:Math.cos(a),ny:Math.sin(a)};
  }
  if(s<2*straight+arc)return {x:radius,y:GRINDER.lowerY+s-straight-arc,nx:1,ny:0};
  const a=(s-2*straight-arc)/radius;
  return {x:radius*Math.cos(a),y:GRINDER.upperY+radius*Math.sin(a),nx:Math.cos(a),ny:Math.sin(a)};
}

export function createAbrasiveGeometry() {
  const r=GRINDER.wheelRadius+GRINDER.beltThickness;
  const straight=GRINDER.upperY-GRINDER.lowerY,arc=Math.PI*r,length=2*(straight+arc);
  const distances=[0,straight];
  for(let i=1;i<=32;i++)distances.push(straight+arc*i/32);
  distances.push(2*straight+arc);
  for(let i=1;i<=32;i++)distances.push(2*straight+arc+arc*i/32);
  const positions:number[]=[],normals:number[]=[],uv:number[]=[],index:number[]=[];
  for(const s of distances){
    const p=beltPath(s);
    for(const z of [-GRINDER.beltWidth/2,GRINDER.beltWidth/2]){
      positions.push(p.x,p.y,z);normals.push(p.nx,p.ny,0);uv.push(z/GRINDER.beltWidth+0.5,s/length);
    }
  }
  for(let i=0;i<distances.length-1;i++){const a=i*2;index.push(a,a+2,a+1,a+1,a+2,a+3);}
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));
  g.setAttribute('normal',new Float32BufferAttribute(normals,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.setIndex(index);
  return g;
}

function maps(abrasive:boolean) {
  const size=256,albedo=new Uint8Array(size*size*4),rough=new Uint8Array(size*size*4),bump=new Uint8Array(size*size*4);
  let seed=47;
  const base=new Color(abrasive?'#925545':'#625852').convertLinearToSRGB();
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const n=(seed>>>16)/65535, broad=Math.sin(x*.031+Math.sin(y*.017))*Math.sin(y*.045)*.06;
    const wear=!abrasive && ((x+3*y)%137<2);
    const seam=abrasive && Math.abs(y-60-x*.12)<1.4;
    const tone=(abrasive?.86:.90)+broad+n*.17+(wear?.24:0)-(seam?.20:0);
    const i=(y*size+x)*4;
    albedo.set([base.r*255*tone,base.g*255*tone,base.b*255*tone,255],i);
    const rv=Math.round((abrasive?.81:.63)*255+n*22-(wear?48:0));
    rough.set([rv,rv,rv,255],i);
    const h=abrasive?90+n*140:120+broad*50+(wear?-35:n*12);
    bump.set([h,h,h,255],i);
  }
  const make=(data:Uint8Array,color=false)=>{
    const t=new DataTexture(data,size,size,RGBAFormat);t.wrapS=t.wrapT=RepeatWrapping;
    t.minFilter=LinearMipmapLinearFilter;t.generateMipmaps=true;t.anisotropy=4;
    if(color)t.colorSpace=SRGBColorSpace;t.needsUpdate=true;return t;
  };
  return {map:make(albedo,true),roughnessMap:make(rough),bumpMap:make(bump)};
}

export class GrinderModel {
  readonly root=new Group();
  readonly assembly=new Group();
  readonly parts=new Map<string,Mesh>();
  readonly pivots=new Map<string,Object3D>();
  private readonly rotors:Group[]=[];
  private readonly beltMaps=maps(true);
  private readonly ironMaps=maps(false);
  private readonly materials={
    iron:new MeshStandardMaterial({color:'#938c83',metalness:.68,roughness:.92,...this.ironMaps,bumpScale:.3}),
    steel:new MeshStandardMaterial({color:'#a79c91',metalness:.80,roughness:.62,...this.ironMaps,bumpScale:.12}),
    abrasive:new MeshStandardMaterial({color:'#ffffff',metalness:0,roughness:1,...this.beltMaps,bumpScale:.38}),
    drive:new MeshStandardMaterial({color:'#39322c',metalness:0,roughness:.88}),
    cavity:new MeshStandardMaterial({color:'#242321',metalness:.35,roughness:.85}),
  };
  constructor(pass:GrinderPass='material'){
    this.root.name='belt-grinder';this.assembly.name='grinder-mm';
    this.assembly.scale.setScalar(WORKSHOP_UNITS_PER_MM);this.assembly.position.y=WORKSHOP_FLOOR_Y;this.root.add(this.assembly);
    const formed=pass==='form'||pass==='material';
    const detailed=pass!=='blockout';
    const add=(id:string,g:BufferGeometry,at:readonly number[],mat:keyof GrinderModel['materials']='iron',parent:Group=this.assembly)=>{
      const m=new Mesh(g,this.materials[mat]);m.name=id;m.position.fromArray(at);m.castShadow=m.receiveShadow=true;
      m.userData.componentId=id;parent.add(m);this.parts.set(id,m);return m;
    };
    const box=(id:string,size:number[],at:number[],mat:keyof GrinderModel['materials']='iron',bevel=2)=>{
      return add(id,formed?new RoundedBoxGeometry(size[0]!,size[1]!,size[2]!,1,Math.min(bevel,...size.map(x=>x/4))):new BoxGeometry(...size as [number,number,number]),at,mat);
    };
    const profile=(id:string,points:number[][],depth:number,at:number[],mat:keyof GrinderModel['materials']='iron')=>{
      const s=new Shape();points.forEach((p,i)=>i?s.lineTo(p[0]!,p[1]!):s.moveTo(p[0]!,p[1]!));s.closePath();
      const g=new ExtrudeGeometry(s,{depth,bevelEnabled:formed,bevelSize:2,bevelThickness:2,bevelSegments:1});g.translate(0,0,-depth/2);
      return add(id,g,at,mat);
    };
    const cylinder=(id:string,r:number,depth:number,at:number[],mat:keyof GrinderModel['materials']='iron',segments=32,parent=this.assembly)=>{
      const g=new CylinderGeometry(r,r,depth,segments);g.rotateX(Math.PI/2);
      return add(id,g,at,mat,parent);
    };
    box('base',[660,85,400],[20,75,0],'iron',5);
    box('spine',[74,1000,140],[109,628,0],'iron',4);
    for(const side of [-1,1]){
      if(detailed){
        profile('cheek-'+side,[[18,0],[140,0],[140,965],[108,1140],[-10,1140],[-105,1040],[-108,947],[-60,947],[-58,1020],[8,1086],[38,1086],[52,921],[18,860]],32,[0,140,side*98]);
        for(const y of [GRINDER.lowerY,GRINDER.upperY]){
          box('bearing-'+side+'-'+y,[78,84,44],[0,y,side*111],'iron',4);
          cylinder('hub-'+side+'-'+y,25,26,[0,y,side*145],'steel',6);
        }
      }
      for(const x of [-280,320])profile('foot-'+side+'-'+x,[[-68,0],[68,0],[42,112],[-40,112]],104,[x,2,side*190]);
    }
    const belt=add('abrasive-loop',createAbrasiveGeometry(),[0,0,0],'abrasive');
    this.pivots.set('abrasive-loop',belt);
    for(const [id,y] of [['upper-wheel',GRINDER.upperY],['lower-wheel',GRINDER.lowerY]] as const){
      const pivot=new Group();pivot.name=id+'-pivot';pivot.position.set(0,y,0);this.assembly.add(pivot);
      this.pivots.set(id,pivot);this.rotors.push(pivot);
      cylinder(id,119.8,128,[0,0,0],'iron',48,pivot);
      if(formed)for(const side of [-1,1]){
        cylinder(id+'-rim-'+side,113,9,[0,0,side*69],'steel',24,pivot);
        cylinder(id+'-recess-'+side,96,10,[0,0,side*74],'cavity',12,pivot);
        cylinder(id+'-boss-'+side,37,16,[0,0,side*79],'iron',8,pivot);
        for(let i=0;i<6;i++){
          const a=i*Math.PI/3,spoke=add(id+'-spoke-'+side+'-'+i,new BoxGeometry(60,15,10),[Math.cos(a)*64,Math.sin(a)*64,side*79],'iron',pivot);spoke.rotation.z=a;
        }
      }
    }
    box('work-rest',[235,22,440],[-243.5,864,0],'steel',2);
    box('rest-arm',[194,30,332],[-168,838,0],'iron',2);
    box('rest-support',[60,270,320],[-53,733,0],'iron',3);
    box('platen',[26,440,114],[-103,866,0],'steel',1);
    box('upper-guard',[224,26,216],[30,1296,0],'iron',4);
    if(detailed){
      box('tension-slide',[32,400,26],[33,920,-126],'steel',2);
      for(const y of [770,1020])box('tension-block-'+y,[58,62,60],[35,y,-130],'iron',4);
      box('drive-pedestal',[84,330,200],[344,236,0],'iron',4);
      const drive=new Group();drive.name='drive-wheel-pivot';drive.position.set(344,461,-126);this.assembly.add(drive);
      this.pivots.set('drive-wheel',drive);this.rotors.push(drive);
      cylinder('drive-wheel',125,52,[0,0,0],'iron',32,drive);
      cylinder('drive-recess',106,56,[0,0,0],'cavity',24,drive);
      cylinder('drive-hub',29,64,[0,0,0],'steel',6,drive);
      for(let i=0;i<6;i++){const a=i*Math.PI/3,s=add('drive-spoke-'+i,new BoxGeometry(88,15,58),[Math.cos(a)*65,Math.sin(a)*65,0],'iron',drive);s.rotation.z=a;}
      cylinder('transmission-small',57,24,[0,300,-165],'iron',32);
      // Tangent spans and wraps share exactly the same two transmission pulley centres.
      const dx=344,dy=161,d=Math.hypot(dx,dy),angle=Math.atan2(dy,dx),alpha=Math.acos((57-128)/d);
      const a=angle+alpha,b=angle-alpha;
      const shape=new Shape();
      shape.absarc(0,300,57,a,b,false);shape.absarc(344,461,128,b,a,false);shape.closePath();
      const hole=new Shape();hole.absarc(0,300,52,a,b,false);hole.absarc(344,461,123,b,a,false);hole.closePath();shape.holes.push(hole);
      const g=new ExtrudeGeometry(shape,{depth:18,bevelEnabled:false,curveSegments:24});g.translate(0,0,-180);
      add('transmission-loop',g,[0,0,0],'drive');
    }
    if(formed){
      const geometry=new CylinderGeometry(9,9,8,6);geometry.rotateX(Math.PI/2);
      const bolts=new InstancedMesh(geometry,this.materials.steel,16);bolts.name='hex-fasteners';
      const points:number[][]=[];
      for(const side of [-1,1])for(const y of [275,325,1135,1185])points.push([27,y,side*141]);
      for(const side of [-1,1])for(const x of [-295,335])points.push([x,58,side*245]);
      for(const y of [755,785,1005,1035])points.push([22,y,-166]);
      points.forEach((p,i)=>bolts.setMatrixAt(i,new Matrix4().makeTranslation(...p as [number,number,number])));
      bolts.castShadow=true;this.assembly.add(bolts);
    }
    if(pass!=='material'){
      this.root.traverse(o=>{if(o instanceof Mesh)o.material=new MeshStandardMaterial({color:pass==='blockout'?'#858583':'#706e68',roughness:.85});});
    }
    const socket=new Object3D();socket.name='billet-home';socket.position.set(-149,GRINDER.restY,0);this.assembly.add(socket);
    this.root.userData.sculptRuntime={nodes:Object.fromEntries(this.pivots),meshes:Object.fromEntries(this.parts),sockets:{'billet-home':socket},colliders:{workingFace:{x:GRINDER.frontX,y:[GRINDER.lowerY,GRINDER.upperY],z:[-60,60]}},destructionGroups:{}};
    this.root.userData.source='artifacts/grinder-sculpt-spec.json';
  }
  tick(seconds:number){
    const travel=seconds*GRINDER.speedMmPerSecond,length=2*(GRINDER.upperY-GRINDER.lowerY)+2*Math.PI*(GRINDER.wheelRadius+GRINDER.beltThickness);
    for(const t of Object.values(this.beltMaps))t.offset.y=-travel/length;
    this.rotors.forEach((p,i)=>p.rotation.z=travel/(i===2?125:120));
  }
  dispose(){
    const geometries=new Set<BufferGeometry>(),materials=new Set<MeshStandardMaterial>();
    this.root.traverse(o=>{if(o instanceof Mesh){geometries.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m as MeshStandardMaterial));}});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
    Object.values(this.materials).forEach(m=>m.dispose());
    [...Object.values(this.beltMaps),...Object.values(this.ironMaps)].forEach(t=>t.dispose());
  }
}
