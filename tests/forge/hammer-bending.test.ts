import { describe, expect, it } from "vitest";
import { bendingIntegral, bendingProfile, torsionalCapacity, torsionProfile, torsionRotation } from "../../src/forge/hammer-bending.ts";

describe("held-strip bending moment",()=>{
  it("has no plastic response below section capacity",()=>{
    const p=bendingProfile([{distance:10,force:100}],1001,10000,0.45,0.04,2);
    expect(p.angle).toBe(0);
  });
  it("stops accumulating curvature when moment falls below yield, without returning the tail upwards",()=>{
    // M(s)=100*(10-s), M_p=500: only 0 <= s < 5 can yield.
    const p=bendingProfile([{distance:10,force:100}],500,10000,0.45,0.04,0.5);
    const near=bendingIntegral(p,6),far=bendingIntegral(p,100);
    expect(near.rotation).toBeCloseTo(1,12);
    expect(far.rotation).toBeCloseTo(near.rotation,12);
    expect(far.deflection-near.deflection).toBeCloseTo(94,10);
    expect(bendingIntegral(p,0)).toEqual({rotation:0,deflection:0,shortening:0});
    expect(p.angle*500).toBeLessThanOrEqual(10000);
    expect(p.angle*bendingIntegral(p,10).deflection).toBeLessThanOrEqual(0.45);
  });
  it("responds to actual load distance and strength without a prescribed target curve",()=>{
    const make=(distance:number,force:number)=>bendingProfile([{distance,force}],500,10,0.2,0.04,0.5);
    expect(make(4,100).angle).toBe(0);
    expect(make(10,100).angle).toBeGreaterThan(0);
    expect(make(10,200).angle).toBeGreaterThan(make(10,100).angle);
  });
});

describe("eccentric section torque",()=>{
  const profile=(eccentricity:number,capacity=500)=>torsionProfile(
    [{distance:10,force:100,eccentricity}],capacity,10,0.2,0.04,24,0.5);
  it("does not twist under centered, balanced or sub-yield loads",()=>{
    expect(profile(0).angle).toBe(0);
    expect(profile(4).angle).toBe(0);
    expect(torsionProfile([{distance:10,force:100,eccentricity:-10},{distance:10,force:100,eccentricity:10}],
      500,10,0.2,0.04,24,0.5).angle).toBe(0);
  });
  it("reverses with eccentricity and stops accumulating twist beyond the load",()=>{
    const positive=profile(10),negative=profile(-10);
    expect(torsionRotation(positive,0)).toBe(0);
    expect(torsionRotation(positive,5)).toBeGreaterThan(0);
    expect(torsionRotation(negative,5)).toBeCloseTo(-torsionRotation(positive,5),12);
    expect(torsionRotation(positive,100)).toBe(torsionRotation(positive,10));
    expect(positive.angle*24).toBeLessThanOrEqual(0.2);
    expect(positive.angle*500).toBeLessThanOrEqual(10);
  });
  it("uses section geometry and yield strength rather than the hammer coverage",()=>{
    expect(torsionalCapacity(48,8,100)).toBeCloseTo(torsionalCapacity(8,48,100),10);
    expect(torsionalCapacity(48,8,200)).toBeCloseTo(2*torsionalCapacity(48,8,100),10);
    expect(torsionalCapacity(48,4,100)).toBeLessThan(torsionalCapacity(48,8,100)/3);
  });
});
