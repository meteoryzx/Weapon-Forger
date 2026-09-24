import { Box3, Vector3 } from "three";
import { PowerHammerWorkpiece } from "./power-hammer-workpiece.ts";

const box = (lo: number[], hi: number[]) => new Box3(new Vector3(...lo), new Vector3(...hi));
// Die-centred millimetres: fixed uprights, table and the open upper tooling.
export class ForgePressWorkpiece extends PowerHammerWorkpiece {
  constructor() {
    super({name:"press",dieZ:0,obstacles:[
      box([-460,-875,-310],[-300,900,310]), box([300,-875,-310],[460,900,310]),
      box([-302,-60,-45],[-272,740,45]), box([272,-60,-45],[302,740,45]),
      box([-300,675,-310],[300,1025,310]),
      box([-270,-700,-250],[270,-80,250]),
      box([-160,-80,-110],[160,-20,110]),
      box([-112,-20,-52],[112,-0.05,52]),
      box([-24,120.05,-24],[24,150,24]),
      box([-75,140,-67.5],[75,175,67.5]),
      box([-330,155,-67],[-250,355,67]), box([250,155,-67],[330,355,67]),
      box([-270,175,-130],[270,295,130]),
    ]});
  }
}
