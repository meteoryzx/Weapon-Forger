import { describe, expect, it } from "vitest";
import { Box3, BoxGeometry, Group, Mesh, Vector3 } from "three";
import { QUENCH_SURFACE_Y, WORKSHOP_FLOOR_Y, WORKSHOP_LAYOUT, WORKSHOP_STANDARD, WORKSHOP_SURFACE_Y, workshopUnits as u } from "../../src/app/workshop-scale.ts";
import { MaterialsStationView } from "../../src/render/materials-station-view.ts";
import { SawStationView } from "../../src/render/saw-station-view.ts";
import { FurnaceStationView } from "../../src/render/furnace-station-view.ts";
import { HammerStationView } from "../../src/render/hammer-station-view.ts";
import { WorkshopModelKit } from "../../src/render/workshop-model-kit.ts";
import { basinAsset, forgingPressAsset, grindingAsset, powerHammerAsset, ROOM_INTERIOR } from "../../src/render/workshop-assets.ts";

function solidBounds(root:Group) {
  root.updateMatrixWorld(true);
  const result=new Box3();
  root.traverse(o=>{
    if(!(o instanceof Mesh) || o.geometry.getAttribute("position")?.count===0)return;
    const materials=Array.isArray(o.material)?o.material:[o.material];
    if(materials.every(m=>m.transparent && m.opacity===0))return;
    result.union(new Box3().setFromObject(o));
  });
  return result;
}

describe("authored workshop geometry",()=>{
  it("grounds real station meshes inside their reserved footprint and room, without station overlaps",()=>{
    const k=new WorkshopModelKit(),geometry=()=>new BoxGeometry(336,8,48);
    const selection=new MaterialsStationView(geometry),saw=new SawStationView(geometry),furnace=new FurnaceStationView(geometry),temper=new FurnaceStationView(geometry,new Vector3(...WORKSHOP_LAYOUT.temper!.origin),"tempering-station","temper"),hammer=new HammerStationView();
    const roots:Record<string,Group>={materials:selection.group,cut:saw.group,furnace:furnace.body,temper:temper.body,anvil:hammer.group};
    // Dynamic hand tools are excluded from the static furniture envelope.
    hammer.tool.removeFromParent();
    for(const [name,asset] of Object.entries({quench:basinAsset(k,false),"quench-oil":basinAsset(k,true),grind:grindingAsset(k),power:powerHammerAsset(k),press:forgingPressAsset(k)})){
      asset.root.position.set(...WORKSHOP_LAYOUT[name]!.origin);
      if(name.startsWith("quench"))asset.root.position.y=WORKSHOP_FLOOR_Y*(1-0.55);
      roots[name]=asset.root;
    }
    furnace.group.updateMatrixWorld(true);
    temper.group.updateMatrixWorld(true);
    const measured=Object.entries(roots).map(([name,root])=>({name,bounds:solidBounds(root)}));
    for(const {name,bounds} of measured){
      const spec=WORKSHOP_LAYOUT[name]!,[x,,z]=spec.origin,[width,depth]=spec.footprint;
      expect(bounds.min.y,`${name} floor`).toBeCloseTo(WORKSHOP_FLOOR_Y,1);
      expect(bounds.min.x,`${name} left`).toBeGreaterThanOrEqual(x-width/2-0.1);
      expect(bounds.max.x,`${name} right`).toBeLessThanOrEqual(x+width/2+0.1);
      expect(bounds.min.z,`${name} back`).toBeGreaterThanOrEqual(z-depth/2-0.1);
      expect(bounds.max.z,`${name} front`).toBeLessThanOrEqual(z+depth/2+0.1);
      // Wall interior includes masonry thickness, not just the floor rectangle.
      expect(Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x)),`${name} room width`).toBeLessThan(u(WORKSHOP_STANDARD.room.width/2-120));
      expect(Math.max(Math.abs(bounds.min.z),Math.abs(bounds.max.z)),`${name} room depth`).toBeLessThan(u(WORKSHOP_STANDARD.room.depth/2-150));
      // The rendered room is narrower than the declared rectangle, so measure
      // against its actual finished interior faces as well.
      expect(bounds.min.x,`${name} interior left wall`).toBeGreaterThan(-ROOM_INTERIOR.halfWidthX);
      expect(bounds.max.x,`${name} interior right wall`).toBeLessThan(ROOM_INTERIOR.halfWidthX);
      expect(bounds.min.z,`${name} interior back wall`).toBeGreaterThan(ROOM_INTERIOR.backZ);
    }
    for(let i=0;i<measured.length;i++)for(let j=i+1;j<measured.length;j++){
      const a=measured[i]!,b=measured[j]!;
      expect(a.bounds.intersectsBox(b.bounds),`${a.name} overlaps ${b.name}`).toBe(false);
    }
    selection.dispose();saw.dispose();furnace.dispose();temper.dispose();hammer.dispose();
  });

  it("authors an 800 mm deep bench with an 875 mm work surface and an open basin",()=>{
    const k=new WorkshopModelKit(),root=new Group();
    const table=k.bench(root,1600,800);
    const bounds=new Box3().setFromObject(table),size=bounds.getSize(new Vector3());
    expect(size.z).toBeCloseTo(u(800),4);
    expect(bounds.max.y-WORKSHOP_FLOOR_Y).toBeCloseTo(u(875),4);
    const basin=basinAsset(k,false);
    basin.root.updateMatrixWorld(true);
    expect(basin.contact!.getWorldPosition(new Vector3()).y).toBeCloseTo(QUENCH_SURFACE_Y);
    expect(new Box3().setFromObject(basin.contact!).getSize(new Vector3()).x).toBeGreaterThan(u(200));
  });
});
