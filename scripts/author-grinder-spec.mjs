import { readFile, writeFile } from 'node:fs/promises';

const file = 'artifacts/grinder-sculpt-spec.json';
const spec = JSON.parse(await readFile(file, 'utf8'));
const assessment = JSON.parse(await readFile('artifacts/grinder-assessment.json', 'utf8'));
spec.sourceImage = 'artifacts/grinder-reference/hero.png';
const classified = {
  primaryType: 'manual vertical abrasive belt grinder', primaryDomain: 'object',
  formLanguage: ['hard-surface', 'faceted cast frame', 'narrow upright abrasive loop'],
  structureKind: ['assembled frame', 'rotating pulleys', 'continuous flexible belt'],
  motionPotential: ['pulley rotation', 'downward front belt travel', 'manual transmission'],
  materialFamilies: ['oxidized iron', 'worn steel', 'abrasive cloth'],
  notes: 'Reference sheet determines structure and finish; approved 875mm work rest determines scale. Hidden bearing construction is inferred.'
};
assessment.preSpecAssessment.objectClass = classified;
assessment.preSpecAssessment.sourceImage = spec.sourceImage;
assessment.preSpecAssessment.complexity = {
  tier: 'complex',
  scores: { silhouetteComplexity: 2, componentCount: 3, hierarchyDepth: 2, repetitionDensity: 1, materialLayerCount: 2, localDetailDensity: 2, occlusionRisk: 1, actionReadinessNeed: 2 },
  estimatedCounts: { macroComponents: 5, mesoComponents: 18, microFeatureGroups: 12, materialLayers: 3, repetitionSystems: 1 },
  reasoning: ['Belt, frame, base, work rest and side drive define the machine.', 'Repeated hex fasteners, concentric wheel rims, chamfers and tensioning brackets require separate geometry.']
};
assessment.preSpecAssessment.specDepthDecision.rationale = 'Three view sheet resolves the exposed working face, wheel axes and side transmission. Named pivots preserve motion.';
assessment.preSpecAssessment.unknownsToResolveBeforeImplementation = [];
spec.preSpecAssessment = assessment.preSpecAssessment;
spec.coordinateFrame = {
  front: '-X; camera on -X looks along +X', up: '+Y', scaleReference: 'metres; 80 scene units/metre, translated once by floor=-30',
  pulleyAxis: '+Z', billetAxis: '+Z',
  dimensionsMm: { height: 1310, beltWidth: 120, wheelDiameter: 240, upperCenterY: 1160, lowerCenterY: 300, workRestY: 875, footprintX: 720, footprintZ: 520 },
  contact: { planeX: -0.123, minY: 0.30, maxY: 1.16, halfWidth: 0.06, restTopY: 0.875 }
};
spec.assumptions = ['Height shortened to the approved reach; no dimension text from generated reference is authoritative.', 'Wear is an inferred real-time approximation; extracted maps are low resolution evidence, not photogrammetry.'];
spec.scores = {object_isolation: 3, silhouette_readability: 3, depth_inference: 2, primitive_decomposition: 3, material_procedurality: 2, occlusion_risk: 2, interaction_fit: 3};
spec.suitability = 'conditional';
spec.silhouette = { boundingShape: 'narrow upright frame with rounded belt ends, projecting rest and triangular side transmission', aspectRatios: [ 'height / base width = 2.5', 'belt width / height = 0.092' ], symmetry: 'belt symmetric along Z; side drive asymmetric along X', dominantCurves: ['two semicircular belt wraps'], negativeSpaces: ['space between return and front runs', 'open triangle around drive'], landmarks: ['vertical front belt', 'upper and lower wheels', 'work rest', 'side pulley'] };
spec.viewEvidence = [
  {id:'hero', view:'front three-quarter', imageRegion:{x:0,y:0,width:1,height:1,units:'normalized'}, observations:['continuous abrasive belt','faceted iron frame','worn projecting rest'], confidence:0.9},
  {id:'front',view:'front',sourceImage:'artifacts/grinder-reference/front.png',observations:['narrow belt flanked by cheek plates'],confidence:0.85},
  {id:'side',view:'side',sourceImage:'artifacts/grinder-reference/side.png',observations:['triangular manual belt drive','work rest projects in front'],confidence:0.85},
  {id:'rear',view:'rear',sourceImage:'artifacts/grinder-reference/rear.png',observations:['back return and bearing blocks'],confidence:0.7}
];
const baseComponent = structuredClone(spec.componentTree[0]);
const components = [];
function part(id, level, primitive, size, position, material='iron', rotation=[0,0,0], parent=null) {
  const c = structuredClone(baseComponent);
  Object.assign(c, { id, name:id, level, role:id, parent, attachment:null, primitive, material, materialLayers:[material], localFeatures:[], evidenceRefs:['hero','front','side'], confidence:0.85, fidelityTier:level==='macro'?'blockout':'structural-pass' });
  c.topologyClass = 'assembled-solid';
  c.topologyRationale = 'A distinct manufactured mechanical component; its contacting joints remain independently named.';
  c.dimensions = {width:size[0],height:size[1],depth:size[2],units:'metres',confidence:0.85};
  c.transform = {position,rotation,scale:size};
  c.geometryDescriptor = {edgeTreatment:{type:'chamfer',bevelRadius:0.002,segments:1},deformationStack:[],uvStrategy:'object-space metres',normalStrategy:'flat bevels and smooth cylindrical faces'};
  c.actionProfile = {animationRole:id.includes('wheel')?'rotor':'static',pivot:{mode:'center',localPosition:[0,0,0],axis:[0,0,1],confidence:1},transformChannels:{translate:false,rotate:id.includes('wheel'),scale:false,visibility:true,materialState:true},sockets:[],collider:{type:'box',offset:[0,0,0],scale:size,isTrigger:false},constraints:[],destruction:{breakable:false,fractureGroup:id,seamRefs:[],detachableFragments:[],breakImpulse:0,debrisMaterial:material}};
  c.colorMaterialRecipe = {dominantAlbedo:material==='abrasive'?'rgba(118,62,52,1)':'rgba(75,65,60,1)',secondaryAlbedo:material==='abrasive'?'rgba(146,85,69,1)':'rgba(145,132,122,1)',materialClass:material==='abrasive'?'fabric':'metal',materialClassConfidence:0.9};
  components.push(c); return c;
}
part('base','macro','box',[0.66,0.085,0.40],[0.02,0.075,0]);
part('spine','macro','box',[0.10,1.02,0.18],[0.11,0.64,0]);
for(const side of [-1,1]) {
  part('cheek-'+side,'meso','box',[0.14,1.10,0.032],[0.08,0.72,side*0.096]);
  for(const y of [0.30,1.16]) {
    part('bearing-'+side+'-'+y,'meso','box',[0.08,0.095,0.052],[0,y,side*0.104]);
    const hub=part('hub-'+side+'-'+y,'meso','cylinder',[0.053,0.024,0.053],[0,y,side*0.142],'steel',[Math.PI/2,0,0]);
    hub.localFeatures.push({id:'hex-cap',kind:'fastener',segments:6,description:'raised hexagonal axle retaining cap'});
  }
  for(const x of [-0.28,0.32]) part('foot-'+side+'-'+x,'meso','box',[0.13,0.12,0.11],[x,0.06,side*0.20]);
}
part('upper-wheel','meso','cylinder',[0.24,0.13,0.24],[0,1.16,0],'iron',[Math.PI/2,0,0]);
part('lower-wheel','meso','cylinder',[0.24,0.13,0.24],[0,0.30,0],'iron',[Math.PI/2,0,0]);
const belt=part('abrasive-loop','macro','extrude',[1,1,1],[0,0,-0.06],'abrasive');
function outline(radius) {
  const pts=[];
  for(let i=0;i<=32;i++){const a=Math.PI*i/32;pts.push([Math.cos(a)*radius,1.16+Math.sin(a)*radius]);}
  for(let i=0;i<=32;i++){const a=Math.PI+Math.PI*i/32;pts.push([Math.cos(a)*radius,0.30+Math.sin(a)*radius]);}
  return pts;
}
belt.geometryDescriptor.profile2D={points:outline(0.123),holes:[outline(0.120).reverse()],depth:0.12};
belt.geometryDescriptor.topologyIntent='Closed constant-thickness strip over tangent straight runs and semicircular wraps; never separate top/bottom plates.';
belt.geometryDescriptor.edgeTreatment={type:'none',bevelRadius:0,segments:1};
belt.actionProfile.animationRole='belt-uv-translation';
const rest=part('work-rest','macro','box',[0.235,0.022,0.44],[-0.2435,0.864,0],'steel');
rest.actionProfile.sockets=[{id:'billet-home',localPosition:[0.0945,0.011,0],axis:[1,0,0]}];
part('rest-support','meso','box',[0.05,0.25,0.32],[-0.06,0.739,0]);
part('rest-arm','meso','box',[0.21,0.03,0.32],[-0.16,0.838,0]);
part('platen','meso','box',[0.026,0.44,0.115],[-0.103,0.86,0],'steel');
part('upper-guard','meso','box',[0.22,0.026,0.20],[0.032,1.294,0]);
part('drive-wheel','macro','cylinder',[0.25,0.056,0.25],[0.36,0.46,0.13],'iron',[Math.PI/2,0,0]);
part('drive-pedestal','meso','box',[0.08,0.33,0.20],[0.36,0.24,0]);
part('drive-hub','meso','cylinder',[0.055,0.025,0.055],[0.36,0.46,0.178],'steel',[Math.PI/2,0,0]);
const transmission=part('transmission-loop','meso','extrude',[1,1,1],[0,0,0.155],'iron');
transmission.geometryDescriptor.profile2D={points:[[0.415,0.576],[-0.026,0.359],[-0.038,0.241],[0.329,0.335],[0.472,0.409]],holes:[[[0.40,0.56],[-0.015,0.35],[-0.026,0.257],[0.33,0.349],[0.456,0.411]].reverse()],depth:0.016};
const detailRows=[
 ['abrasive-loop','belt-joint','seam','oblique joining seam on loop'],
 ['abrasive-loop','belt-grit','ridge','fine abrasive grains on front and wraps'],
 ['work-rest','rest-bevel','bevel','2mm exposed leading edge chamfer'],
 ['work-rest','working-scratches','scratch','directional metal contact scratches'],
 ['upper-wheel','wheel-rim','ridge','concentric flange proud of the hub'],
 ['lower-wheel','lower-rim','ridge','concentric lower wheel flange'],
 ['cheek--1','frame-chamfer','bevel','faceted outer plate corners'],
 ['cheek-1','frame-bevel','bevel','mirrored cheek edge bevel'],
 ['base','anchor-bolts','fastener','four hex anchoring heads'],
 ['drive-wheel','drive-rim','ridge','raised side transmission rim'],
 ['upper-guard','guard-wear','chip','small exposed worn corners'],
 ['spine','tension-slot','groove','recessed vertical adjustment slot']
];
assessment.preSpecAssessment.detailInventory={scanMethod:'component-zones',targetMinDetails:12,details:detailRows.map(([owner,id,kind,description])=>{
  components.find(c=>c.id===owner).localFeatures.push({id,kind,description,evidenceRefs:['hero']});
  return {id,kind,description,confidence:0.8,evidenceRef:'hero',mapsTo:{ref:owner+'/'+id}};
})};
spec.componentTree=components;
const materialTemplate=spec.materials[0];
spec.materials=[];
for(const id of ['iron','steel','abrasive']) {
  const m=structuredClone(materialTemplate),report=JSON.parse(await readFile('artifacts/grinder-reference/'+id+'-pbr.json','utf8'));
  Object.assign(m,{id,name:id,albedo:{dominant:report.palette[0],secondary:report.palette.slice(1),samplingNotes:'reference crop'},baseColor:report.palette[0],color:report.palette[0]});
  m.referencePbr={usable:true,version:'1',sourceImage:report.sourceImage,extractor:'extract_pbr_evidence.py',method:'independent channel inference',verdict:'pass',hardLimit:'single crop inference',confidence:report.confidence,estimatedFidelity:report.estimatedFidelity,targetThreshold:0.7,maps:report.maps};
  m.localOverrides=[{id:'contact-wear',mask:'exposed edges and contact regions',roughness:id==='abrasive'?0.91:0.32,evidenceRefs:['hero'],description:'localized contact wear; cavities stay rough'}];
  m.metalness={base:id==='abrasive'?0:0.72,variation:0.08};
  m.textureResolution=1024;
  m.notes='Pixel-derived inference from the named material crop. Small crops do not certify exact surface reconstruction.';
  spec.materials.push(m);
}
spec.repetitionSystems=[{id:'base-fasteners',componentRef:'base',type:'grid',count:4,spacing:[0.6,0,0.40],geometry:'hexagonal bolt heads',material:'steel',evidenceRefs:['hero']}];
spec.featureReviewTargets=[
 {id:'narrow-closed-belt',name:'Narrow continuous abrasive loop on two aligned wheels',tier:'critical',passIds:['blockout','structural-pass','form-refinement'],componentRefs:['abrasive-loop','upper-wheel','lower-wheel'],evidenceRefs:['hero','side'],minimumScore:0.8,mustPass:true},
 {id:'front-rest-and-frame',name:'Unobstructed vertical working face and supported projecting rest',tier:'critical',passIds:['blockout','structural-pass','interaction-pass'],componentRefs:['work-rest','spine'],evidenceRefs:['hero','front'],minimumScore:0.8,mustPass:true},
 {id:'manual-side-drive',name:'Side pulley transmission with no motor',tier:'important',passIds:['structural-pass','form-refinement'],componentRefs:['drive-wheel','transmission-loop'],evidenceRefs:['side'],minimumScore:0.7,mustPass:true},
 {id:'abrasive-iron-finish',name:'Red-brown abrasive and worn dark iron',tier:'critical',passIds:['material-pass','surface-pass','lighting-pass'],componentRefs:['abrasive-loop','spine','work-rest'],evidenceRefs:['hero'],minimumScore:0.75,mustPass:true}
];
spec.lightingFromPhoto=[{type:'key light',position:[-3,4,3],color:'#fff0df',intensity:3},{type:'fill light',position:[-2,1,-3],color:'#bac9df',intensity:1},{type:'rim light',position:[3,4,-1],color:'#fff0d8',intensity:2},{exposure:1.1,toneMapping:'ACESFilmic',background:'#353638',contactShadow:'soft ground shadow under base and feet'}];
spec.performanceBudget={targetTriangles:25000,maxDrawCalls:80,textureSize:1024,fpsTarget:60};
spec.buildPasses.forEach(p=>p.componentRefs=components.filter(c=>p.id==='blockout'?c.level==='macro':true).map(c=>c.id));
spec.risks=['Reference side/rear drawings are not mechanically exact; return belt follows the same two wheel axes.', 'Work rest raised relative to source proportions to honour 875mm approved height.'];
await writeFile(file,JSON.stringify(spec,null,2)+'\n');
await writeFile('artifacts/grinder-assessment.json',JSON.stringify(assessment,null,2)+'\n');
