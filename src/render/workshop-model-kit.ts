import { BoxGeometry, BufferGeometry, CylinderGeometry, DataTexture, ExtrudeGeometry, Group, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, RepeatWrapping, RGBAFormat, Shape, SRGBColorSpace, TorusGeometry, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { WORKSHOP_FLOOR_Y, workshopUnits as u } from "../app/workshop-scale.ts";

export type MaterialRole = "wood" | "endgrain" | "iron" | "steel" | "stone" | "brick" | "brass" | "belt" | "dark";

// Small deterministic bitmap surfaces also work without DOM/canvas on WeChat.
function surfaceTexture(wood: boolean) {
  const size=128, data=new Uint8Array(size*size*4);
  let seed=173;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const noise=(seed>>>24)/255;
    const grain=wood ? Math.sin(x*0.35+Math.sin(y*0.045)*2)*0.05+Math.sin(x*1.7)*0.012 : 0;
    const v=Math.round((0.84+noise*0.045+grain)*255), i=(y*size+x)*4;
    data.set([v,v,v,255],i);
  }
  const texture=new DataTexture(data,size,size,RGBAFormat);
  texture.wrapS=texture.wrapT=RepeatWrapping;
  texture.magFilter=LinearFilter;texture.minFilter=LinearMipmapLinearFilter;
  texture.generateMipmaps=true;texture.anisotropy=4;
  texture.colorSpace=SRGBColorSpace;texture.needsUpdate=true;
  return texture;
}

export class WorkshopModelKit {
  readonly woodTexture=surfaceTexture(true);
  readonly mineralTexture=surfaceTexture(false);
  readonly materials: Record<MaterialRole,MeshStandardMaterial>;
  constructor() {
    const make=(color:string,metalness:number,roughness:number,wood=false)=>new MeshStandardMaterial({color,metalness,roughness,map:wood?this.woodTexture:this.mineralTexture});
    this.materials={wood:make("#8b6541",0,0.85,true),endgrain:make("#513e30",0,0.93,true),iron:make("#252a2a",0.72,0.58),steel:make("#a3a9a6",0.85,0.32),stone:make("#85877f",0,0.93),brick:make("#ad9275",0,0.98),brass:make("#b59755",0.72,0.44),belt:make("#c64d29",0.15,0.7),dark:make("#171c1c",0.25,0.9)};
  }
  mesh(parent:Group,name:string,geometry:BufferGeometry,at:readonly number[],role:MaterialRole) {
    const m=new Mesh(geometry,this.materials[role]);m.name=name;
    m.position.set(u(at[0]!),WORKSHOP_FLOOR_Y+u(at[1]!),u(at[2]!));
    m.castShadow=m.receiveShadow=true;parent.add(m);return m;
  }
  box(parent:Group,name:string,size:readonly number[],at:readonly number[],role:MaterialRole="iron",bevel=4) {
    const dims=size.map(u);
    const geo=bevel>0?new RoundedBoxGeometry(dims[0]!,dims[1]!,dims[2]!,1,u(Math.min(bevel,...size.map(v=>v/4)))):new BoxGeometry(dims[0],dims[1],dims[2]);
    return this.mesh(parent,name,geo,at,role);
  }
  cylinder(parent:Group,name:string,radius:number,length:number,at:readonly number[],role:MaterialRole="steel",axis:"x"|"y"|"z"="y",segments=24) {
    const mesh=this.mesh(parent,name,new CylinderGeometry(u(radius),u(radius),u(length),segments),at,role);
    if(axis==="x")mesh.rotation.z=Math.PI/2;
    if(axis==="z")mesh.rotation.x=Math.PI/2;
    return mesh;
  }
  beam(parent:Group,name:string,a:readonly number[],b:readonly number[],width:number,depth:number,role:MaterialRole="iron") {
    const av=new Vector3(...a as [number,number,number]),bv=new Vector3(...b as [number,number,number]);
    const center=av.clone().add(bv).multiplyScalar(0.5), delta=bv.sub(av);
    const m=this.box(parent,name,[width,delta.length(),depth],center.toArray(),role);
    m.quaternion.setFromUnitVectors(new Vector3(0,1,0),delta.normalize());return m;
  }
  ring(parent:Group,name:string,radius:number,tube:number,at:readonly number[],role:MaterialRole="iron",axis:"x"|"z"="z") {
    const mesh=this.mesh(parent,name,new TorusGeometry(u(radius),u(tube),8,48),at,role);
    if(axis==="x")mesh.rotation.y=Math.PI/2;
    return mesh;
  }
  ruler(parent:Group,length:number,at:readonly [number,number,number]) {
    this.box(parent,"steel-rule",[length,2,28],[at[0],at[1]+1,at[2]],"steel",0);
    for(let i=0;i<=length/10;i++)this.box(parent,"rule-tick",[0.7,0.2,i%10===0?22:i%5===0?15:8],[at[0]-length/2+i*10,at[1]+2.2,at[2]-2],"dark",0);
  }
  profile(parent:Group,name:string,points:readonly (readonly [number,number])[],depth:number,at:readonly number[],role:MaterialRole="iron") {
    const shape=new Shape();points.forEach(([x,y],i)=>i?shape.lineTo(u(x),u(y)):shape.moveTo(u(x),u(y)));shape.closePath();
    const g=new ExtrudeGeometry(shape,{depth:u(depth),bevelEnabled:true,bevelSize:u(3),bevelThickness:u(3),bevelSegments:2,steps:1});g.translate(0,0,-u(depth/2));
    return this.mesh(parent,name,g,at,role);
  }
  bench(parent:Group,width:number,depth:number,centerZ=0,surface=875) {
    const deck=this.box(parent,"worktop",[width,60,depth],[0,surface-30,centerZ],"wood");
    for(let i=1;i<6;i++)this.box(parent,"plank-joint",[width-6,1,2],[0,surface+0.1,centerZ-depth/2+i*depth/6],"endgrain",0);
    for(const x of [-width/2+65,width/2-65]) for(const z of [-depth/2+65,depth/2-65]){
      this.box(parent,"leg",[85,surface-60,85],[x,(surface-60)/2,centerZ+z],"endgrain");
      this.cylinder(parent,"deck-bolt",10,5,[x,surface+2.5,centerZ+z],"iron","y",6);
    }
    this.box(parent,"under-shelf",[width-120,35,depth-120],[0,220,centerZ],"wood");
    for(const z of [-depth/2+50,depth/2-50])this.box(parent,"apron",[width-80,110,40],[0,surface-110,centerZ+z],"endgrain");
    return deck;
  }
  // Batch only static, non-interactive geometry; interaction meshes stay separate.
  batch(group:Group) {
    group.updateMatrixWorld(true);
    const byMaterial=new Map<MeshStandardMaterial,BufferGeometry[]>();
    const children=[...group.children];
    for(const child of children) if(child instanceof Mesh && child.material instanceof MeshStandardMaterial && !child.userData.keepMesh){
      child.updateMatrix();let g=child.geometry.clone();if(g.index){const unindexed=g.toNonIndexed();g.dispose();g=unindexed;}
      g.applyMatrix4(child.matrix);const list=byMaterial.get(child.material)??[];list.push(g);byMaterial.set(child.material,list);
      group.remove(child);child.geometry.dispose();
    }
    for(const [mat,list] of byMaterial){const g=mergeGeometries(list,false);list.forEach(g=>g.dispose());if(g){const mesh=new Mesh(g,mat);mesh.name="static-"+mat.color.getHexString();mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);}}
  }
}
