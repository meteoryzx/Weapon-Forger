import { readFileSync, writeFileSync } from "node:fs";

const fixtures = [
  {
    path: "artifacts/power-hammer-sculpt-spec.json",
    type: "compact power hammer",
    form: ["geometric", "cast C-frame", "enclosed drive"],
    structure: ["assembled-solid", "vertical impact train"],
    motion: ["vertical ram translation", "operator control rotation"],
    materials: ["painted cast iron", "exposed tool steel"],
    features: [
      ["c-frame-silhouette", "C-frame silhouette and open throat", "critical", ["root", "frame", "head"]],
      ["enclosed-drive", "Enclosed upper drive housing", "critical", ["head"]],
      ["ram-die-alignment", "Vertical ram and opposed die alignment", "critical", ["ram", "upper-die", "lower-die"]],
      ["operator-control", "Simple operator-side control", "important", ["control"]],
    ],
    components: [
      ["root", "Power Hammer", "macro", "box", null, "iron", [1.0, 1.0, 1.0], [0, 0, 0], "static-root"],
      ["base", "Flared floor base", "macro", "box", "root", "iron", [1.0, 0.14, 0.82], [0, 0.07, 0], "static"],
      ["frame", "Cast C-frame", "macro", "box", "root", "iron", [0.62, 1.35, 0.58], [-0.12, 0.79, 0.08], "static"],
      ["head", "Enclosed drive head", "meso", "box", "frame", "iron", [0.72, 0.46, 0.62], [0.08, 1.48, 0.02], "static"],
      ["ram", "Vertical ram", "meso", "cylinder", "head", "steel", [0.16, 0.46, 0.16], [0.19, 1.1, -0.12], "moving-ram"],
      ["upper-die", "Upper die", "meso", "box", "ram", "steel", [0.28, 0.12, 0.25], [0.19, 0.84, -0.12], "moving-die"],
      ["lower-die", "Lower die", "meso", "box", "base", "steel", [0.34, 0.12, 0.28], [0.19, 0.42, -0.12], "contact-die"],
      ["control", "Operator control", "meso", "box", "frame", "steel", [0.08, 0.28, 0.08], [0.38, 0.58, -0.31], "control"],
      ["service-cover", "Large service cover", "micro", "box", "frame", "iron", [0.24, 0.24, 0.04], [-0.44, 1.06, 0.02], "static"],
      ["anchor-bolts", "Anchor bolt group", "micro", "box", "base", "steel", [0.08, 0.05, 0.08], [0, 0.15, 0], "static"],
    ],
    details: [
      ["base-bevel", "bevel", "base/base-bevel"],
      ["frame-contour", "contour", "frame/frame-contour"],
      ["head-seam", "seam", "head/head-seam"],
      ["die-gloss", "gloss", "steel/die-polish"],
      ["cover-line", "linework", "service-cover/cover-line"],
      ["anchor-fasteners", "fastener", "anchor-bolts/anchor-fasteners"],
    ],
  },
  {
    path: "artifacts/forging-press-sculpt-spec.json",
    type: "compact forging press",
    form: ["geometric", "portal frame", "short working gap"],
    structure: ["assembled-solid", "vertical pressure train"],
    motion: ["vertical platen translation", "manual switch rotation"],
    materials: ["dark cast iron", "exposed tool steel"],
    features: [
      ["portal-load-path", "Heavy portal frame and direct load path", "critical", ["left-upright", "right-upright", "top-housing", "base"]],
      ["short-working-gap", "Short working gap between broad dies", "critical", ["upper-die", "lower-die"]],
      ["ram-die-alignment", "Vertical ram and opposed die alignment", "critical", ["ram", "upper-die", "lower-die"]],
      ["manual-switch", "Single manual operator switch", "important", ["control"]],
    ],
    components: [
      ["root", "Forging Press", "macro", "box", null, "iron", [1.0, 1.0, 1.0], [0, 0, 0], "static-root"],
      ["base", "Heavy floor base", "macro", "box", "root", "iron", [1.05, 0.18, 0.8], [0, 0.09, 0], "static"],
      ["left-upright", "Left upright", "macro", "box", "base", "iron", [0.18, 1.18, 0.24], [-0.39, 0.73, 0.04], "static"],
      ["right-upright", "Right upright", "macro", "box", "base", "iron", [0.18, 1.18, 0.24], [0.39, 0.73, 0.04], "static"],
      ["top-housing", "Enclosed pressure housing", "macro", "box", "root", "iron", [0.96, 0.36, 0.62], [0, 1.42, 0], "static"],
      ["ram", "Vertical press ram", "meso", "cylinder", "top-housing", "steel", [0.18, 0.44, 0.18], [0, 1.08, -0.09], "moving-ram"],
      ["upper-die", "Upper platen and die", "meso", "box", "ram", "steel", [0.42, 0.14, 0.34], [0, 0.81, -0.09], "moving-die"],
      ["lower-die", "Lower platen and die", "meso", "box", "base", "steel", [0.48, 0.15, 0.38], [0, 0.43, -0.09], "contact-die"],
      ["control", "Manual pressure switch", "meso", "box", "right-upright", "steel", [0.08, 0.3, 0.08], [0.53, 0.72, -0.18], "control"],
      ["joint-plates", "Upright joint plates", "micro", "box", "top-housing", "iron", [0.24, 0.2, 0.05], [0, 1.33, 0.33], "static"],
      ["anchor-bolts", "Anchor bolt group", "micro", "box", "base", "steel", [0.08, 0.05, 0.08], [0, 0.18, 0], "static"],
    ],
    details: [
      ["base-bevel", "bevel", "base/base-bevel"],
      ["upright-contour", "contour", "left-upright/upright-contour"],
      ["housing-seam", "seam", "top-housing/housing-seam"],
      ["die-gloss", "gloss", "steel/die-polish"],
      ["plate-line", "linework", "joint-plates/plate-line"],
      ["anchor-fasteners", "fastener", "anchor-bolts/anchor-fasteners"],
    ],
  },
];

const recipe = (material) => ({
  dominantAlbedo: material === "steel" ? "rgba(122, 128, 126, 1.0)" : "rgba(41, 49, 47, 1.0)",
  secondaryAlbedo: material === "steel" ? "rgba(74, 79, 78, 1.0)" : "rgba(24, 30, 29, 1.0)",
  materialClass: "metal",
  materialClassConfidence: 0.95,
});

const attachment = (parent, position) => ({
  parentId: parent,
  parentSocket: `${parent}-surface`,
  localStart: position,
  localEnd: [position[0], position[1] + 0.05, position[2]],
  contactType: "overlap",
  overlap: 0.02,
  gapTolerance: 0.01,
  evidenceRefs: ["full-object"],
});

for (const fixture of fixtures) {
  const spec = JSON.parse(readFileSync(fixture.path, "utf8"));
  spec.suitability = "pass";
  spec.scores = {
    object_isolation: 3,
    silhouette_readability: 3,
    depth_inference: 2,
    primitive_decomposition: 3,
    material_procedurality: 3,
    occlusion_risk: 2,
    interaction_fit: 3,
  };
  Object.assign(spec.preSpecAssessment.objectClass, {
    primaryType: fixture.type,
    primaryDomain: "object",
    formLanguage: fixture.form,
    structureKind: fixture.structure,
    motionPotential: fixture.motion,
    materialFamilies: fixture.materials,
    notes: "Approved stylized low-poly procedural game prop; hidden internals remain enclosed and inferred.",
  });
  Object.assign(spec.preSpecAssessment.complexity, {
    estimatedCounts: { macroComponents: 5, mesoComponents: 4, microFeatureGroups: 2, materialLayers: 2, repetitionSystems: 1 },
    reasoning: ["Moderate mechanical assembly with a small action-ready hierarchy and deliberately low surface-detail density."],
  });
  spec.preSpecAssessment.unknownsToResolveBeforeImplementation = [];
  spec.preSpecAssessment.detailInventory.details = fixture.details.map(([id, kind, ref]) => ({
    id,
    kind,
    description: id.replaceAll("-", " "),
    mapsTo: { ref },
    evidenceRefs: ["full-object"],
  }));
  spec.assumptions = [
    "Rear and internal mechanisms are represented by enclosed low-poly housings because the approved reference provides one exterior view.",
    "Exact manufacturing dimensions are subordinate to the project's workshop millimetre scale contract.",
  ];
  spec.silhouette = {
    boundingShape: "compact upright industrial forging machine",
    aspectRatios: ["height approximately 1.7 times body width", "depth approximately 0.8 times width"],
    symmetry: fixture.type.includes("press") ? "bilateral portal-frame balance" : "asymmetric C-frame",
    dominantCurves: ["large throat opening", "flared floor base"],
    negativeSpaces: ["working gap between opposed dies"],
    landmarks: ["heavy base", "enclosed upper housing", "vertical ram", "opposed dies", "operator control"],
  };
  spec.viewEvidence[0].observations = ["Approved three-quarter concept view", "Clear silhouette and primary load path", "Hidden rear inferred conservatively"];
  spec.viewEvidence[0].confidence = 0.9;

  const rootTemplate = spec.componentTree[0];
  spec.componentTree = fixture.components.map(([id, name, level, primitive, parent, material, dims, position, animationRole]) => {
    const component = structuredClone(rootTemplate);
    Object.assign(component, {
      id,
      name,
      level,
      role: animationRole,
      importance: level === "macro" ? 1 : level === "meso" ? 0.85 : 0.55,
      confidence: 0.9,
      primitive,
      topologyClass: "assembled-solid",
      topologyRationale: "Visible as a discrete rigid metal volume with planar or cylindrical boundaries in the approved reference.",
      parent,
      attachment: parent ? attachment(parent, position) : null,
      dimensions: { width: dims[0], height: dims[1], depth: dims[2], units: "relative", confidence: 0.9 },
      transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
      material,
      materialLayers: [material],
      colorMaterialRecipe: recipe(material),
      fidelityTier: "low-poly-game-prop",
      localFeatures: [],
      evidenceRefs: ["full-object"],
    });
    component.geometryDescriptor = {
      topologyIntent: "low-poly rigid machine part with bevel-ready silhouette edges",
      edgeTreatment: { type: "chamfer", bevelRadius: 0.015, segments: 1 },
      deformationStack: [],
      uvStrategy: "generated procedural coordinates",
      normalStrategy: "flat or area-weighted vertex normals",
    };
    component.actionProfile.animationRole = animationRole;
    component.actionProfile.pivot.localPosition = position;
    component.actionProfile.pivot.axis = [0, 1, 0];
    component.actionProfile.sockets = [{ id: `${id}-surface`, localPosition: [0, 0, 0], localRotation: [0, 0, 0] }];
    component.actionProfile.transformChannels = {
      translate: animationRole.includes("moving"),
      rotate: animationRole === "control",
      scale: false,
      bend: false,
      twist: false,
      detach: false,
      visibility: true,
      materialState: true,
    };
    component.localFeatures = fixture.details
      .filter(([, , ref]) => ref.startsWith(`${id}/`))
      .map(([featureId, kind]) => ({ id: featureId, kind, description: featureId.replaceAll("-", " "), evidenceRefs: ["full-object"] }));
    return component;
  });

  const materialTemplate = spec.materials[0];
  spec.materials = [
    {
      ...structuredClone(materialTemplate),
      id: "iron",
      name: "Aged dark cast iron",
      baseColor: "#29312f",
      color: "#29312f",
      albedo: { dominant: "#29312f", secondary: ["#171d1c", "#3c4743"], samplingNotes: "Dark enclosed ferrous body from the approved reference." },
      roughness: { base: 0.62, variation: 0.08, map: "independent-procedural-field", localResponse: "slightly lower roughness on broad worn edges" },
      metalness: { base: 0.72, variation: 0.05 },
      localOverrides: [{ id: "edge-wear", region: "exposed silhouette edges", baseColor: "#4a5350", roughness: 0.48, evidenceRefs: ["full-object"] }],
      wear: { edgeWear: 0.12, scratches: [], chips: [] },
      dirt: { amount: 0.08, cavityBias: 0.6, color: "#121615" },
    },
    {
      ...structuredClone(materialTemplate),
      id: "steel",
      name: "Worked tool steel",
      baseColor: "#7a807e",
      color: "#7a807e",
      albedo: { dominant: "#7a807e", secondary: ["#4a4f4e", "#9ba19f"], samplingNotes: "Exposed ram, dies, control, and anchor hardware." },
      roughness: { base: 0.3, variation: 0.06, map: "independent-procedural-field", localResponse: "working die faces are smoother than collars" },
      metalness: { base: 0.88, variation: 0.03 },
      localOverrides: [{ id: "die-polish", region: "opposed working faces", baseColor: "#9ca3a1", roughness: 0.2, evidenceRefs: ["full-object"] }],
      wear: { edgeWear: 0.16, scratches: ["short directional work scratches"], chips: [] },
      dirt: { amount: 0.03, cavityBias: 0.35, color: "#242827" },
    },
  ];
  spec.repetitionSystems = [{
    id: "anchor-fastener-pattern",
    name: "Four simplified base anchor fasteners",
    realization: "geometry",
    buildsGeometry: true,
    geometry: { primitive: "cylinder", count: 4, radialSegments: 6 },
    componentRef: "anchor-bolts",
    evidenceRefs: ["full-object"],
  }];
  spec.featureReviewTargets = fixture.features.map(([id, name, tier, componentRefs]) => ({
    id,
    name,
    tier,
    passIds: tier === "critical" ? ["blockout", "structural-pass", "form-refinement"] : ["structural-pass", "interaction-pass"],
    minimumScore: tier === "critical" ? 0.72 : 0.65,
    mustPass: tier === "critical",
    componentRefs,
    evidenceRefs: ["full-object"],
  }));
  const componentIds = spec.componentTree.map((component) => component.id);
  for (const pass of spec.buildPasses) pass.componentRefs = componentIds;
  spec.performanceBudget = {
    qualityPriority: "low-poly-real-time-readability",
    targetTriangles: 6000,
    maxDrawCalls: 24,
    textureSize: 256,
    fpsTarget: 60,
    optimizationPolicy: "Preserve silhouette, ram, dies, and control; omit micro surface geometry and merge static material groups.",
  };
  spec.lightingFromPhoto = [
    "Warm upper-left key light at moderate intensity for readable planar facets.",
    "Cool low-intensity fill light from the operator side to preserve the throat opening.",
    "Neutral environment rim, ACES filmic tone mapping, exposure 1.0, and soft ground contact shadow.",
  ];
  spec.proceduralStrategy = [
    "Use low-segment boxes, cylinders, and extruded side profiles for the approved silhouette.",
    "Keep the ram and operator control as named pivot groups; merge only static same-material meshes.",
    "Use solid PBR materials with restrained procedural value variation; do not project source pixels.",
  ];
  spec.risks = ["Single-view rear geometry is inferred.", "Low-poly simplification intentionally omits small fasteners and casting texture."];
  writeFileSync(fixture.path, `${JSON.stringify(spec, null, 2)}\n`);
}
