/**
 * Authoritative stage -> visual/control mapping (brief section 7).
 * Kept as data so no component invents its own booleans.
 *
 * NOTE ON FOCUS NODES: the brief's Focus_* empties do not exist in the shipped
 * GLB (audited: Focus_LP12/Mount/Antenna/Height/Pivot/Coverage all absent).
 * Rather than rename GLB nodes, each stage names a real node whose world
 * position is used as the focus point. Documented in nodeAliases.js.
 */
export const STAGE_CONFIG = {
  inspectPole:      { view: 'inspect',  selected: ['Pole_Shaft'],
                      focusNode: 'Pole_Shaft', focusMode: true,
                      dimOpacity: 0.14, userOrbit: false },
  attachBands:      { view: 'inspect',  selected: ['Band_Top_Front', 'Band_Bottom_Front'],
                      focusNode: 'Pole_Shaft', focusMode: true,
                      dimOpacity: 0.14, userOrbit: false },
  attachRail:       { view: 'inspect',  selected: ['Mounting_Rail'],
                      focusNode: 'Mounting_Rail', focusMode: true,
                      dimOpacity: 0.14, userOrbit: false },
  attachPivot:      { view: 'inspect',  selected: ['Pivot_Fixed'],
                      focusNode: 'Pivot_Fixed', focusMode: true,
                      dimOpacity: 0.14, userOrbit: false },
  mountAntenna:     { view: 'install',  selected: ['Antenna_Body'],
                      focusNode: 'Antenna_Body', focusMode: true,
                      dimOpacity: 0.14, userOrbit: false },
  secureAntenna:    { view: 'install',  selected: ['Antenna_Body'],
                      focusNode: 'Antenna_Body', focusMode: true,
                      dimOpacity: 0.14, userOrbit: false },
  attachConnectors: { view: 'install',  selected: ['Connector_Bank'],
                      focusNode: 'Connector_Bank', focusMode: true,
                      dimOpacity: 0.14, userOrbit: false },
  handover:         { view: 'coverage', selected: [], focusNode: 'Beam_Origin',
                      focusMode: false, dimOpacity: 0, userOrbit: false },
  inspect: {
    view: 'inspect',
    selected: ['Mounting_Rail', 'Pivot_Fixed'],
    focusNode: 'Pivot_Fixed',       // stands in for Focus_Mount
    focusMode: true,
    dimOpacity: 0.14,
    userOrbit: false,
  },
  install: {
    view: 'install',
    selected: ['Antenna_Body'],
    focusNode: 'Antenna_Body',      // stands in for Focus_Antenna
    focusMode: true,
    dimOpacity: 0.14,
    userOrbit: false,
  },
  height: {
    view: 'height',
    selected: ['Height_Rig'],       // group -> outline uses mesh descendants
    focusNode: 'Mounting_Rail',     // stands in for Focus_Height
    focusMode: true,
    dimOpacity: 0.14,
    userOrbit: false,
  },
  downtilt: {
    view: 'downtilt',
    selected: ['Pivot_Bracket', 'Pivot_Hardware'],
    focusNode: 'Pivot_Hardware',    // stands in for Focus_Pivot
    focusMode: true,
    dimOpacity: 0.14,
    userOrbit: false,
  },
  coverage: {
    view: 'coverage',
    selected: [],
    focusNode: 'Beam_Origin',       // stands in for Focus_Coverage
    focusMode: false,
    dimOpacity: 0,
    userOrbit: false,
  },
  complete: {
    view: 'complete',
    selected: [],
    focusNode: null,
    focusMode: false,
    dimOpacity: 0,
    userOrbit: true,
  },
}

/** Every node the runtime hard-depends on; missing ones are reported together. */
export const REQUIRED_NODES = [
  'LP12_ROOT', 'Pole_Shaft', 'Mounting_Rail', 'Antenna_Body',
  'Height_Rig', 'Tilt_Rig', 'Pivot_Bracket', 'Pivot_Hardware',
  'Pivot_Fixed', 'Connector_Bank', 'Beam_Origin', 'Install_Target',
  'Coverage_Target',
]

export function detectPerformanceTier() {
  if (typeof navigator === 'undefined') return 'high'
  const mem = navigator.deviceMemory ?? 8
  const cores = navigator.hardwareConcurrency ?? 8
  const coarse = window.matchMedia?.('(pointer: coarse)').matches
  if (mem <= 4 || cores <= 4) return 'low'
  return coarse && mem <= 6 ? 'low' : 'high'
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}
