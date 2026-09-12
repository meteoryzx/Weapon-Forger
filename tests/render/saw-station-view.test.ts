import { describe,expect,it } from "vitest";
import { Box3,BufferGeometry,Vector3 } from "three";
import { createForgeState,createForgeSnapshot,applyForgeIntent } from "../../src/forge/index.ts";
import { createBilletGeometry } from "../../src/render/forge-billet-view.ts";
import { SawStationView,SAW_ORIGIN } from "../../src/render/saw-station-view.ts";
import { CUT_HOME,CUT_TABLE,SAW_PATH } from "../../src/app/cut-placement.ts";

describe("saw station spatial relationships",()=>{
  it("rests both the active cut piece and its stored counterpart on the table at identical scale",()=>{
    const state=applyForgeIntent(createForgeState({sectionCount:8}),{kind:"cut",path:{id:"test",
      start:{axialPosition:8,lateralOffset:-30},end:{axialPosition:8,lateralOffset:30},kerfWidth:1}});
    const snapshot=createForgeSnapshot(state);
    const view=new SawStationView(piece=>createBilletGeometry(piece,null));
    view.update(snapshot,CUT_HOME,true);view.updateTray(snapshot.bench,0);view.group.updateMatrixWorld(true);
    const active=new Box3().setFromObject(view.item),stored=new Box3().setFromObject(view.tray);
    expect(active.min.y).toBeCloseTo(CUT_TABLE.surface+0.05,6);
    expect(stored.min.y).toBeCloseTo(active.min.y,6);
    expect(active.max.x-active.min.x).toBeCloseTo(stored.max.x-stored.min.x,6);
    expect(active.intersectsBox(stored)).toBe(false);
    view.dispose();
  });
  it("orients the saw edge toward the player and limits its guide to the finite travel",()=>{
    const view=new SawStationView(piece=>createBilletGeometry(piece,null));
    view.update(createForgeSnapshot(createForgeState({sectionCount:8})),CUT_HOME,true);
    view.group.updateMatrixWorld(true);
    const size=new Box3().setFromObject(view.group.getObjectByName("saw-blade")!).getSize(new Vector3());
    // Hub is wider than the cutting disk, but the full assembly remains edge-on.
    expect(size.z).toBeLessThan(size.x/3);expect(size.y).toBeGreaterThan(100);
    const guide=view.group.getObjectByName("finite-cut-guide")! as unknown as {geometry:BufferGeometry};
    const positions=guide.geometry.getAttribute("position");
    expect(positions.getZ(0)).toBeCloseTo(SAW_PATH.startZ,5);
    expect(positions.getZ(positions.count-1)).toBeCloseTo(SAW_PATH.endZ,5);
    for(let i=0;i<positions.count;i++)expect(positions.getX(i)).toBe(0);
    expect(new Box3().setFromObject(view.table).max.y).toBeLessThan(CUT_TABLE.surface+SAW_ORIGIN.y);
    view.dispose();
  });
});
