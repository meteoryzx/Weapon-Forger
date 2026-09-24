import { HAMMER_RULES, type HammerTriangle } from "../forge/index.ts";

export function hammerFootprint(surface: readonly HammerTriangle[], x: number, z: number): number[] {
  const positions: number[] = [], r = HAMMER_RULES.face / 2;
  for (const triangle of surface) {
    let polygon = [...triangle.points];
    for (const [axis, edge, sign] of [["x", x-r, -1], ["x", x+r, 1], ["z", z-r, -1], ["z", z+r, 1]] as const) {
      const next: typeof polygon = [];
      for (let i=0; i<polygon.length; i++) {
        const a=polygon[i]!, b=polygon[(i+1)%polygon.length]!, da=sign*(a[axis]-edge), db=sign*(b[axis]-edge);
        if (da<=0) next.push(a);
        if ((da<0&&db>0)||(da>0&&db<0)) {
          const t=da/(da-db);
          next.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
        }
      }
      polygon=next;
      if (polygon.length<3) break;
    }
    for (let i=1; i+1<polygon.length; i++) for (const p of [polygon[0]!,polygon[i]!,polygon[i+1]!]) positions.push(p.x,p.y,p.z);
  }
  return positions;
}
