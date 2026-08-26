/** Clip contract from the animation spec, sections 10 / 24 / 25. */

export const BUILD_STAGES = [
  'inspectPole', 'attachBands', 'attachRail', 'attachPivot',
  'mountAntenna', 'secureAntenna', 'attachConnectors',
  'height', 'downtilt', 'coverage', 'handover', 'complete',
]

export const ASSEMBLY_CLIPS = {
  attachBands:      'ANIM_01_Bands_Attach',
  attachRail:       'ANIM_02_Rail_Attach',
  attachPivot:      'ANIM_03_Pivot_Attach',
  mountAntenna:     'ANIM_04_Antenna_Mount',
  secureAntenna:    'ANIM_05_Antenna_Secure',
  attachConnectors: 'ANIM_06_Connectors_Attach',
}

/**
 * Pointing clips, added with the model's 7th and 8th animations.
 *
 * Deliberately NOT in ASSEMBLY_CLIPS or CLIP_ORDER. Those two drive the
 * numbered install sequence and the re-application pass, and the pointing
 * stages are not install steps — the existing `height` and `downtilt` stages
 * set Height_Rig and Tilt_Rig directly and carry no clip by design.
 *
 * What these add is the option of animating that set instead of snapping it.
 * Note the overlap before using them: ANIM_08 drives Tilt_Rig.rotation.x, which
 * is the same channel the downtilt stage writes, so play the clip or set the
 * value — never both in the same frame. ANIM_07 is safe alongside the height
 * stage: it drives Height_Rig.rotation.z (azimuth), while the stage writes
 * Height_Rig.position.y.
 */
export const POINTING_CLIPS = {
  azimuth:  'ANIM_07_Azimuth_Set',
  downtilt: 'ANIM_08_Downtilt_Set',
}

/** Manifest order — completed clips must be re-applied in this order (s34). */
export const CLIP_ORDER = [
  'ANIM_01_Bands_Attach', 'ANIM_02_Rail_Attach', 'ANIM_03_Pivot_Attach',
  'ANIM_04_Antenna_Mount', 'ANIM_05_Antenna_Secure', 'ANIM_06_Connectors_Attach',
]

export const NEXT_STAGE = {
  attachBands: 'attachRail',
  attachRail: 'attachPivot',
  attachPivot: 'mountAntenna',
  mountAntenna: 'secureAntenna',
  secureAntenna: 'attachConnectors',
  attachConnectors: 'height',
}

export const OBJECTIVES = {
  inspectPole:      'Inspect the pole mounting area.',
  attachBands:      'Attach the circular pole bands.',
  attachRail:       'Install the vertical mounting rail.',
  attachPivot:      'Fit the downtilt pivot bracket.',
  mountAntenna:     'Mount the n78 antenna enclosure.',
  secureAntenna:    'Secure the antenna fasteners.',
  attachConnectors: 'Attach the connectors and cables.',
  height:           'Set the mount height between 7 m and 8 m.',
  downtilt:         'Set the correct downtilt for the shadow zone.',
  coverage:         'Verify pedestrian-level coverage through the shadow zone.',
  handover:         'Validate the handover with LP11.',
  complete:         'Placement confirmed.',
}

/** Button label for each assembly action. */
export const ACTION_LABEL = {
  attachBands: 'Attach pole bands',
  attachRail: 'Install mounting rail',
  attachPivot: 'Fit pivot bracket',
  mountAntenna: 'Mount antenna',
  secureAntenna: 'Secure fasteners',
  attachConnectors: 'Attach connectors',
}

/**
 * Section 33 visibility policy: a component is revealed immediately BEFORE its
 * clip runs, while it still sits in its unassembled rest pose — so it never
 * pops into the middle of a motion. Names are the v2 GLB nodes.
 */
export const STAGE_PARTS = {
  attachBands: ['Band_Top_Front', 'Band_Top_Back', 'Band_Top_Bolt_L', 'Band_Top_Bolt_R',
                'Band_Bottom_Front', 'Band_Bottom_Back', 'Band_Bottom_Bolt_L', 'Band_Bottom_Bolt_R'],
  attachRail: ['Mounting_Rail', 'Rail_Bolt_01', 'Rail_Bolt_02', 'Rail_Bolt_03', 'Rail_Bolt_04'],
  attachPivot: ['Pivot_Fixed', 'Pivot_Bolt_01', 'Pivot_Bolt_02'],
  mountAntenna: ['Antenna_Body', 'Cooling_Fins', 'Connector_Bank',
                 'Pivot_Bracket', 'Pivot_Hardware'],
  secureAntenna: ['Antenna_Fastener_01', 'Antenna_Fastener_02',
                  'Antenna_Fastener_03', 'Antenna_Fastener_04'],
  attachConnectors: ['Antenna_Cables'],
}

/** Everything that starts hidden — the pole is the only part visible at first. */
export const ALL_STAGED_PARTS = Object.values(STAGE_PARTS).flat()

/** Amber outline selection per stage. */
export const STAGE_SELECTION = {
  inspectPole: ['Pole_Shaft'],
  attachBands: STAGE_PARTS.attachBands,
  attachRail: ['Mounting_Rail'],
  attachPivot: ['Pivot_Fixed', 'Pivot_Bracket'],
  mountAntenna: ['Antenna_Body'],
  secureAntenna: STAGE_PARTS.secureAntenna,
  attachConnectors: ['Connector_Bank', 'Antenna_Cables'],
  height: ['Height_Rig'],
  downtilt: ['Pivot_Bracket', 'Pivot_Hardware'],
  coverage: [],
  handover: [],
  complete: [],
}
