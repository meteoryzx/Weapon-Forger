import fs from 'node:fs';
import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const file = path.join(decodeURIComponent(dir), 'object-sculpt-spec.json');
const s = JSON.parse(fs.readFileSync(file, 'utf8'));
const template = structuredClone(s.componentTree[0]);
const material = structuredClone(s.materials[0]);
s.suitability = 'conditional';
s.scores = {object_isolation:3,silhouette_readability:3,depth_inference:2,primitive_decomposition:3,material_procedurality:2,occlusion_risk:1,interaction_fit:3};
s.preSpecAssessment.objectClass = {primaryType:'hydraulic gate-frame forge press',primaryDomain:'object',formLanguage:['hard-surface','mechanical'],structureKind:['articulated assembly'],motionPotential:['articulated'],materialFamilies:['metal'],notes:'Two accepted concept views; simplified geometry and shared workshop palette explicitly requested.'};
s.preSpecAssessment.complexity.scores = {silhouetteComplexity:2,componentCount:2,hierarchyDepth:1,repetitionDensity:1,materialLayerCount:1,localDetailDensity:1,occlusionRisk:1,actionReadinessNeed:2};
s.preSpecAssessment.complexity.estimatedCounts = {macroComponents:6,mesoComponents:12,microFeatureGroups:9,materialLayers:4,repetitionSystems:1};
s.preSpecAssessment.complexity.reasoning = ['Moderate after user-directed removal of dense rust, scratches, embossed lettering and micro fasteners. Identity still depends on integrated profiled gate, moving guided crosshead, fixed cylinder, pedestal, gauge and lever.'];
s.preSpecAssessment.specDepthDecision.rationale = 'Shallow mechanical assemblies, hard edged extrusions and discrete tooling; rigid translation only.';
s.preSpecAssessment.unknownsToResolveBeforeImplementation = [];
s.qualityContract.definitionOfDone = ['Low-poly reference-faithful gate press with chamfered shoulders, braced feet, visibly guided crosshead, fixed cylinder shell, pedestal, analog dial and side lever.', 'Actual bounds at most 1000 x 925 mm and approximately 1900 mm tall. Iron opening 600 mm. Tool center z=0. Support top=875 mm, upper bottom=995 mm, 120 mm rigid stroke.', 'Gray cast iron and steel share power-hammer palette; small brass accents; no generated images or repeated texture/micro passes.'];
s.qualityContract.featureGroups = s.qualityContract.featureGroups.filter(f => f.id !== 'reference-lookdev');
s.qualityContract.featureGroups.find(f=>f.id==='surface-material-response').qualityCriteria = ['Shared workshop iron #555f60 roughness .72, steel #a3a9a6 roughness .32, brass #b59755 roughness .44. Existing low-amplitude mineral albedo only. No claimed extracted PBR or corrosion fidelity.'];
s.materials = [['iron','#555f60',.72,.72],['steel','#a3a9a6',.32,.85],['brass','#b59755',.44,.72],['dial','#e3dfcf',.85,0]].map(([id,color,rough,metal])=>({...structuredClone(material),id,name:id,baseColor:color,color,albedo:{dominant:color,secondary:[color],samplingNotes:'User-authorized shared palette from power-hammer-model.ts / workshop-model-kit.ts, not inverse-rendered albedo.'},roughness:{base:rough,variation:0},metalness:{base:metal,variation:0},normal:{pattern:'none',strength:0,scale:1,space:'tangent'},surfaceFrequencyBands:[],notes:'Reduced-detail scope: no extracted textures, rust, scratches or normal maps.',colorVariation:{palette:[color],pattern:'none',amplitude:0},localOverrides:[]}));
const components = [
 ['base','macro','box',[980,100,900],[0,50,0],'iron'],
 ['gate-frame','macro','extrude',[920,1720,480],[0,960,0],'iron'],
 ['pedestal','macro','extrude',[380,695,330],[0,447.5,0],'iron'],
 ['cylinder-shell','macro','cylinder',[290,330,290],[0,1685,0],'iron'],
 ['crosshead','macro','extrude',[650,160,220],[0,1200,0],'iron'],
 ['piston','meso','cylinder',[112,440,112],[0,1470,0],'steel'],
 ['upper-holder','meso','box',[150,105,135],[0,1067.5,0],'iron'],
 ['upper-die','meso','box',[48,20,48],[0,1005,0],'steel'],
 ['lower-holder','meso','box',[270,60,155],[0,825,0],'iron'],
 ['lower-support','meso','box',[224,20,104],[0,865,0],'steel'],
 ['guide-left','meso','box',[30,800,90],[-285,1215,0],'steel'],
 ['guide-right','meso','box',[30,800,90],[285,1215,0],'steel'],
 ['shoe-left','meso','box',[80,200,135],[-290,1200,0],'iron'],
 ['shoe-right','meso','box',[80,200,135],[290,1200,0],'iron'],
 ['gauge','meso','cylinder',[120,28,120],[470,1420,90],'brass'],
 ['lever','meso','cylinder',[22,185,22],[476,1200,100],'brass'],
 ['foot-braces','meso','extrude',[130,310,205],[0,255,0],'iron'],
 ['service-panel','meso','box',[14,310,245],[462,885,-5],'iron'],
 ['cap-fasteners','micro','cylinder',[34,20,34],[0,1860,0],'steel'],
 ['dial-marks','micro','box',[4,12,2],[0,0,0],'steel']
];
s.componentTree = components.map(([id,level,primitive,size,position,mat])=>{
 const c = structuredClone(template);
 Object.assign(c,{id,name:id,parentId:null,level,role:id,primitive,topologyClass:'assembled-solid',topologyRationale:primitive==='extrude'?'Connected cast profile with planar faces and explicitly open negative space.':'Discrete rigid mechanical part with flat faces or circular section.',material:mat,materialLayers:[mat],dimensions:{width:size[0],height:size[1],depth:size[2],units:'mm',confidence:1},transform:{position,rotation:[0,0,0],scale:[1,1,1]},fidelityTier:'structural',evidenceRefs:['full-object','accepted-views'],localFeatures:[],geometryDescriptor:{notes:'Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract.'}});
 const color = s.materials.find(m=>m.id===mat).color;
 const rgba=`rgba(${parseInt(color.slice(1,3),16)}, ${parseInt(color.slice(3,5),16)}, ${parseInt(color.slice(5,7),16)}, 1)`;
 c.colorMaterialRecipe={dominantAlbedo:rgba,secondaryAlbedo:rgba,materialClass:'metal',materialClassConfidence:.9,roughnessRange:[.3,.8],metalnessRange:[.7,.85],evidenceRefs:['full-object'],notes:'Shared workshop palette requested by user; not pixel sampling.'};
 c.actionProfile.animationRole=['piston','crosshead','upper-holder','upper-die','shoe-left','shoe-right'].includes(id)?'rigid-moving':'static';
 return c;
});
const details=[['gate-frame','bevel'],['foot-braces','contour'],['cylinder-shell','contour'],['piston','gloss'],['guide-left','gloss'],['crosshead','contour'],['gauge','linework'],['lever','contour'],['cap-fasteners','fastener']];
s.preSpecAssessment.detailInventory={scanMethod:'component-zones',targetMinDetails:9,details:details.map(([id,kind])=>({id:`detail-${id}`,kind,description:id,evidenceRefs:['full-object','accepted-views'],mapsTo:{ref:`${id}/identity`}}))};
for(const [id] of details)s.componentTree.find(c=>c.id===id).localFeatures=[{id:'identity',type:'geometry',description:`Reference ${id} silhouette/response`,evidenceRefs:['full-object']}];
s.qualityTargets.reviewViewpoints=['reference','front','right','rear','left','mobile'];
s.performanceBudget={qualityPriority:'user-approved-low-poly',targetTriangles:6000,maxDrawCalls:100,textureSize:128,fpsTarget:60,optimizationPolicy:'12/16-sided cylinders, hard-edged extruded profiles, limited fasteners; no repeated surface refinement.'};
s.referenceCamera={solved:false,orientation:{yaw:24,pitch:8,roll:0},positionHint:[.42,.14,1],note:'Approximate main concept view; orthographic studio camera. No exact camera solve claimed.'};
s.geometryContract={units:'mm',sceneScale:.08,floorY:-30,front:'+Z',bounds:{width:1000,depth:925,height:1900},ironOpeningWidth:600,toolCenterZ:0,lowerSupport:{size:[224,20,104],topY:875},upperFace:{size:[48,20,48],openBottomY:995},ramTravel:[0,-120],frame:{outer:[[-460,100],[460,100],[460,1680],[430,1760],[310,1780],[-310,1780],[-430,1760],[-460,1680]],opening:[[-300,795],[-300,1530],[-260,1580],[260,1580],[300,1530],[300,795]],depth:480},joints:['base/pedestal and base/frame overlap/contact','guide rails embedded in iron inward faces x=+-300','crosshead ends join guide shoes which slide around fixed rails','piston top remains inside cylinder at full 120 mm stroke','upper holder joins crosshead bottom1120 and insert top1015','pedestal top795 / holder bottom795 / support bottom855','gauge, service plate and lever mount against right iron side x460'],inferred:'Rear casting and hydraulic interiors simplified. Work-height and usable opening override picture proportions.'};
s.scopeDeviation={authorizedBy:'Current user request: simplify detail; get completed asset soon without repeated texture/micro passes.',omitted:['corrosion maps','micro scratches','text labels','internal hydraulics','gameplay controls owned by lead'],stagePolicy:'Preserve standard gate outcomes exactly. Separate reduced-detail stage evidence records direct implementation if standard pixel gate does not admit changed user dimensions; never synthesize a standard continue.'};
s.risks=['Concept views are not manufacturing drawings. User dimensions intentionally change work gap and pedestal ratio.','Raw photo-vs-render scores may fail; preserve those results and report scope honestly.'];
for(const p of s.buildPasses)p.componentRefs=s.componentTree.map(c=>c.id);
s.lookDevTargets.qualityPriority='user-approved-shared-palette';
for(const m of s.materials)delete m.roughness.variation;
s.materials[0].localOverrides=[{id:'service-panel-tone',componentRefs:['service-panel'],color:'#444d4e',roughness:.72,evidenceRefs:['full-object'],notes:'Dark cover like power-hammer-model.ts.'}];
s.lightingFromPhoto=['Key upper front left, directional white intensity 3; broad top highlights.', 'Hemisphere fill gray intensity 1.5 and right fill .8; environment reflections from RoomEnvironment.', 'ACES tone mapping exposure1, neutral #d5d6d8 background, ground contact shadow; no baked lighting.'];
s.featureReviewTargets=[['cast-gate-negative-space',['gate-frame','base','foot-braces']],['guided-hydraulic-head',['cylinder-shell','piston','crosshead']],['working-dies-pedestal',['upper-die','lower-support','pedestal']],['analog-side-controls',['gauge','lever']]].map(([id,refs])=>({id,name:id,tier:'critical',passIds:s.buildPasses.map(p=>p.id),minimumScore:.7,mustPass:true,componentRefs:refs,evidenceRefs:['full-object']}));
fs.writeFileSync(file,JSON.stringify(s,null,2).replaceAll('"accepted-views"','"full-object"')+'\n');
fs.writeFileSync(path.join(path.dirname(file),'assessment.json'),JSON.stringify({preSpecAssessment:s.preSpecAssessment,qualityContract:s.qualityContract,localSpecSearch:s.localSpecSearch},null,2)+'\n');
