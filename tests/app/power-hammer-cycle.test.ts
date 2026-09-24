import { describe, expect, it } from "vitest";
import { PowerHammerCycle } from "../../src/app/power-hammer-cycle.ts";

describe("one contact per power-hammer stroke",()=>{
  it("finishes an already started stroke without creating the next one",()=>{
    const cycle=new PowerHammerCycle();
    expect(cycle.begin(0,8)).toBe(true);
    expect(cycle.gap(0)).toBe(120);
    expect(cycle.tick(99)).toBe(false);
    expect(cycle.tick(100)).toBe(true);
    expect(cycle.tick(101)).toBe(false);
    expect(cycle.gap(101)).toBe(8);
    cycle.release(150,7);
    expect(cycle.gap(150)).toBe(7);
    cycle.tick(250);
    expect(cycle.phase).toBe("idle");
    expect(cycle.begin(299,7)).toBe(false);
    expect(cycle.begin(300,7)).toBe(true);
  });
  it("starts contact every 300 ms when calculation fits within the stroke budget",()=>{
    const cycle=new PowerHammerCycle(),hits:number[]=[];
    for(let now=0;now<=1000;now++){
      if(!cycle.busy)cycle.begin(now,8);
      if(cycle.tick(now))hits.push(now);
      if(cycle.phase==="contact"&&now===hits.at(-1)!+20)cycle.release(now,8);
    }
    expect(hits).toEqual([100,400,700,1000]);
  });
  it("does not catch up missed strikes after a slow calculation or suspended tab",()=>{
    const cycle=new PowerHammerCycle();cycle.begin(0,8);
    expect(cycle.tick(5000)).toBe(true);
    expect(cycle.tick(9000)).toBe(false);
    expect(cycle.begin(9000,8)).toBe(false);
    cycle.release(9000,7);cycle.tick(20000);
    expect(cycle.gap(20000)).toBe(120);
    expect(cycle.begin(20000,7)).toBe(true);
    expect(cycle.tick(20000)).toBe(false);
  });
});
