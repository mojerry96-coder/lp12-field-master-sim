/**
 * Documented alias map between the names the hybrid brief assumes and the names
 * that actually exist in lp12_interactive_assembly.glb.
 *
 * The brief forbids renaming working GLB nodes without a documented alias
 * (rule 10), so the aliasing lives here rather than in a Blender re-export.
 * Audited against the shipped GLB — these 11 brief-assumed nodes do not exist:
 *
 *   Rear_Cooling_Fins, Antenna_Height_Group, Antenna_Tilt_Group,
 *   Interaction_Targets, Hotspot_LP12, Focus_LP12, Focus_Mount,
 *   Focus_Antenna, Focus_Height, Focus_Pivot, Focus_Coverage
 */
export const NODE_ALIASES = {
  Rear_Cooling_Fins: 'Cooling_Fins',
  Interaction_Targets: 'Interaction_Anchors',
  // The brief names Pivot_Bracket as the downtilt manipulator. In the real
  // asset Pivot_Bracket is a MESH parented under Tilt_Rig; rotating it would
  // swing the bracket alone and leave the antenna behind. Tilt_Rig is the
  // actual hinge node and is what must be driven.
  Pivot_Bracket_RIG: 'Tilt_Rig',
  Antenna_Height_Group: 'Height_Rig',
  Antenna_Tilt_Group: 'Tilt_Rig',
}

/** Meshes highlighted per build stage (real node names). */
export const STAGE_SELECTION = {
  inspect: ['Mounting_Rail', 'Pivot_Fixed', 'Band_Top', 'Band_Bottom'],
  install: ['Antenna_Body', 'Cooling_Fins', 'Connector_Bank'],
  height: ['Height_Rig'],
  downtilt: ['Pivot_Bracket', 'Pivot_Hardware'],
  coverage: ['Antenna_Body'],
  complete: [],
}

/**
 * The brief's Focus_* nodes do not exist. Camera poses instead come from
 * camera_flow.json, which was authored with LP12 at the world origin and is
 * therefore already model-relative — no conversion needed now the environment
 * is gone.
 */
export const STAGE_TO_VIEW = {
  inspectPole: 'inspect', attachBands: 'inspect', attachRail: 'inspect',
  attachPivot: 'inspect', mountAntenna: 'install', secureAntenna: 'install',
  attachConnectors: 'install', handover: 'coverage',
  inspect: 'inspect', install: 'install', height: 'height',
  downtilt: 'downtilt', coverage: 'coverage', complete: 'complete',
}

export function resolveNode(root, name) {
  return root.getObjectByName(NODE_ALIASES[name] ?? name) ?? root.getObjectByName(name) ?? null
}
