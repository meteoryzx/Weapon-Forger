// Reduced held-strip bending, in mm / N / N mm. This is a plastic increment
// from sampled transverse loading, not an elastic or dynamic contact solver.
export interface BendingSample { readonly distance:number; readonly force:number }
export interface TorsionSample extends BendingSample { readonly eccentricity:number }
export interface TorsionProfile {
  readonly step:number;
  readonly length:number;
  readonly angle:number;
  readonly rotations:readonly number[];
}
export interface BendingIntegral {
  readonly rotation:number;
  readonly deflection:number;
  readonly shortening:number;
}
export interface BendingProfile {
  readonly step:number;
  readonly length:number;
  readonly angle:number;
  readonly integrals:readonly BendingIntegral[];
}

export function bendingProfile(samples:readonly BendingSample[],capacity:number,work:number,
  maximumTravel:number,maximumAngle:number,cellSize:number):BendingProfile {
  const length=Math.max(cellSize,...samples.map(sample=>sample.distance));
  const count=Math.max(8,Math.ceil(length/cellSize)),step=length/count;
  // M(s) = sum F_i * max(d_i-s, 0). No load beyond s means no new curvature.
  const excess=Array.from({length:count},(_,i)=>Math.max(0,
    samples.reduce((sum,sample)=>sum+sample.force*Math.max(0,sample.distance-(i+0.5)*step),0)-capacity));
  const total=excess.reduce((sum,value)=>sum+value*step,0);
  const integrals:BendingIntegral[]=[{rotation:0,deflection:0,shortening:0}];
  for(const value of excess){
    const previous=integrals.at(-1)!,rotation=previous.rotation+(total>0?value*step/total:0);
    integrals.push({rotation,deflection:previous.deflection+step*(previous.rotation+rotation)/2,
      shortening:previous.shortening+step*(previous.rotation**2+previous.rotation*rotation+rotation**2)/3});
  }
  const peakMoment=samples.reduce((sum,sample)=>sum+sample.force*sample.distance,0);
  const angle=total>0?Math.min(maximumAngle,maximumTravel/Math.max(integrals.at(-1)!.deflection,1e-9),
    work/Math.max(capacity,1)*Math.max(0,1-capacity/Math.max(peakMoment,1))):0;
  return {step,length,angle,integrals};
}

export function bendingIntegral(profile:BendingProfile,distance:number):BendingIntegral {
  const s=Math.max(0,Math.min(distance,profile.length));
  const index=Math.min(profile.integrals.length-2,Math.floor(s/profile.step));
  const before=profile.integrals[index]!,after=profile.integrals[index+1]!;
  const ds=s-index*profile.step,k=(after.rotation-before.rotation)/profile.step;
  const rotation=before.rotation+k*ds,tail=Math.max(0,distance-profile.length);
  return {rotation,
    deflection:before.deflection+before.rotation*ds+k*ds*ds/2+tail*rotation,
    shortening:before.shortening+before.rotation**2*ds+before.rotation*k*ds*ds+k*k*ds**3/3+tail*rotation**2};
}

/** Saint-Venant rectangular-section approximation; stress units match capacity. */
export function torsionalCapacity(width:number,thickness:number,yieldStress:number):number {
  const a=Math.max(width,thickness),b=Math.min(width,thickness),ratio=b/a;
  const torsionConstant=a*b**3/3*(1-0.63*ratio+0.052*ratio**5);
  return yieldStress/Math.sqrt(3)*torsionConstant/b;
}

export function torsionProfile(samples:readonly TorsionSample[],capacity:number,work:number,
  maximumTravel:number,maximumAngle:number,sectionRadius:number,cellSize:number):TorsionProfile {
  const length=Math.max(cellSize,...samples.map(sample=>sample.distance));
  const count=Math.max(8,Math.ceil(length/cellSize)),step=length/count;
  // T(s) is the torque of loads outboard of s, about the section centroid.
  const torques=Array.from({length:count},(_,i)=>samples.reduce((sum,sample)=>
    sum+(sample.distance>(i+0.5)*step?sample.force*sample.eccentricity:0),0));
  const excess=torques.map(torque=>Math.sign(torque)*Math.max(0,Math.abs(torque)-capacity));
  const total=excess.reduce((sum,value)=>sum+Math.abs(value)*step,0);
  const rotations=[0];
  for(const value of excess)rotations.push(rotations.at(-1)!+(total>0?value*step/total:0));
  const peakTorque=Math.max(0,...torques.map(Math.abs));
  const angle=total>0?Math.min(maximumAngle,maximumTravel/Math.max(sectionRadius,1e-9),
    work/Math.max(capacity,1)*Math.max(0,1-capacity/Math.max(peakTorque,1))):0;
  return {length,step,angle,rotations};
}

export function torsionRotation(profile:TorsionProfile,distance:number):number {
  const s=Math.max(0,Math.min(distance,profile.length));
  const index=Math.min(profile.rotations.length-2,Math.floor(s/profile.step));
  const a=profile.rotations[index]!,b=profile.rotations[index+1]!;
  return profile.angle*(a+(b-a)*(s-index*profile.step)/profile.step);
}
