import { DataTexture, Group, LinearFilter, Mesh, MeshBasicMaterial, RingGeometry, RGBAFormat, Sprite, SpriteMaterial, Vector3 } from "three";
import { WORKSHOP_SURFACE_Y } from "../app/workshop-scale.ts";

export class QuenchEffects {
  readonly group=new Group();
  private readonly texture:DataTexture;
  private readonly steam:Sprite[]=[];
  private readonly rings:Mesh<RingGeometry,MeshBasicMaterial>[]=[];
  constructor() {
    const size=32,data=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const r=Math.hypot((x-15.5)/15.5,(y-15.5)/15.5);
      data.set([225,237,235,Math.round(Math.max(0,1-r)**2*150)],(y*size+x)*4);
    }
    this.texture=new DataTexture(data,size,size,RGBAFormat);
    this.texture.magFilter=this.texture.minFilter=LinearFilter;this.texture.needsUpdate=true;
    for(let i=0;i<14;i++){
      const sprite=new Sprite(new SpriteMaterial({map:this.texture,transparent:true,depthWrite:false,opacity:0}));
      this.steam.push(sprite);this.group.add(sprite);
    }
    for(let i=0;i<4;i++){
      const ring=new Mesh(new RingGeometry(0.96,1,48),new MeshBasicMaterial({color:0xc7e3dc,transparent:true,depthWrite:false,opacity:0}));
      ring.rotation.x=-Math.PI/2;this.rings.push(ring);this.group.add(ring);
    }
    this.group.visible=false;
  }
  update(now:number,contact:Vector3,immersion:number,temperature:number):boolean {
    const wasVisible=this.group.visible;
    this.group.visible=immersion>0;
    if(!this.group.visible)return wasVisible;
    const time=now/1000,heat=Math.min(1,Math.max(0,(temperature-100)/500));
    this.group.position.set(contact.x,WORKSHOP_SURFACE_Y+0.08,contact.z);
    this.steam.forEach((sprite,i)=>{
      const t=(time*0.55+i/14)%1,angle=i*2.399;
      sprite.position.set(Math.sin(angle)*4+Math.sin(time+i)*t*3,t*22,Math.cos(angle)*7+t*2);
      sprite.scale.setScalar(3+t*10);sprite.material.opacity=Math.sin(t*Math.PI)*heat*0.6;
    });
    this.rings.forEach((ring,i)=>{
      const t=(time*0.7+i/4)%1;
      ring.scale.set(2+t*15,2+t*20,1);ring.material.opacity=(1-t)*0.23;
    });
    return true;
  }
  hide():boolean {const visible=this.group.visible;this.group.visible=false;return visible;}
  dispose() {this.texture.dispose();this.steam.forEach(s=>s.material.dispose());this.rings.forEach(r=>{r.geometry.dispose();r.material.dispose();});}
}
