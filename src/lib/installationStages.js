/**
 * Data-driven stage table (spec s12/s13). One reusable shell reads this —
 * no per-page markup.
 *
 * `clip` maps onto the Blender NLA animation names already in the GLB;
 * `camera` maps onto the studio anchors in camera_studio_manifest.json.
 */
export const STAGES = [
  {
    id: 'overview', title: 'Pole Assembly', activePart: 'pole-bands',
    action: 'Begin Installation', status: 'Assembly History',
    clip: null, camera: 'CAM_01_FULL_POLE',
    tracker: { top: 10, height: 80 },
    wireframe: '/lp12/wireframes/00_overview.png',
    cards: ['pole-bands', 'mounting-rail', 'pivot-bracket'],
  },
  {
    id: 'bands', title: 'Install Pole Bands', activePart: 'pole-bands',
    action: 'Install Pole Bands', status: 'Step 1 of 6',
    clip: 'ANIM_01_Bands_Attach', camera: 'CAM_02_BANDS',
    tracker: { top: 29, height: 35 },
    wireframe: '/lp12/wireframes/01_pole_bands.png',
    cards: ['pole-bands', 'mounting-rail', 'pivot-bracket'],
  },
  {
    id: 'rail', title: 'Fit Mounting Rail', activePart: 'mounting-rail',
    action: 'Install Mounting Rail', status: 'Pole Bands Installed',
    clip: 'ANIM_02_Rail_Attach', camera: 'CAM_04_RAIL',
    tracker: { top: 29, height: 35 },
    wireframe: '/lp12/wireframes/02_mounting_rail.png',
    cards: ['mounting-rail', 'pivot-bracket', 'antenna-unit'],
  },
  {
    id: 'pivot', title: 'Fit Pivot Bracket', activePart: 'pivot-bracket',
    action: 'Install Pivot Bracket', status: 'Mounting Rail Installed',
    clip: 'ANIM_03_Pivot_Attach', camera: 'CAM_05_PIVOT',
    tracker: { top: 38, height: 20 },
    wireframe: '/lp12/wireframes/03_pivot_bracket.png',
    cards: ['pivot-bracket', 'antenna-unit', 'fastener-set'],
  },
  {
    id: 'antenna', title: 'Mount Antenna Unit', activePart: 'antenna-unit',
    action: 'Install Antenna', status: 'Pivot Bracket Installed',
    clip: 'ANIM_04_Antenna_Mount', camera: 'CAM_06_ANTENNA',
    tracker: { top: 28, height: 38 },
    wireframe: '/lp12/wireframes/04_antenna_unit.png',
    cards: ['antenna-unit', 'fastener-set', 'connector-set'],
  },
  {
    id: 'fasteners', title: 'Secure Antenna', activePart: 'fastener-set',
    action: 'Secure Fasteners', status: 'Antenna Positioned',
    clip: 'ANIM_05_Antenna_Secure', camera: 'CAM_07_FASTENERS',
    tracker: { top: 32, height: 28 },
    wireframe: '/lp12/wireframes/05_fasteners.png',
    cards: ['fastener-set', 'connector-set', 'pivot-bracket'],
  },
  {
    id: 'connectors', title: 'Connect Signal Cables', activePart: 'connector-set',
    action: 'Connect Cables', status: 'Antenna Secured',
    clip: 'ANIM_06_Connectors_Attach', camera: 'CAM_08_CONNECTORS',
    tracker: { top: 51, height: 24 },
    wireframe: '/lp12/wireframes/06_connectors.png',
    cards: ['connector-set'],
  },
  {
    // Mount height and downtilt. These are rig settings, not parts, so they
    // carry no clip and are not numbered as install steps.
    //
    // The model has always supported them - Height_Rig.position.y and
    // Tilt_Rig.rotation.x are both driven in LP12BuildCanvas, and the store has
    // setHeight/setDowntilt with heightOk/tiltOk validators. What was missing
    // was any way to reach them: the only controls ever built lived in a HUD
    // component keyed to the old buildStage ids, which App.jsx imported but
    // never rendered. The capability was complete and unreachable. That file
    // has since been deleted; these stages are the way in.
    id: 'height', title: 'Set Mount Height', activePart: null,
    action: 'Confirm Height', status: 'Signal Cables Connected',
    clip: null, camera: 'CAM_01_FULL_POLE', control: 'height',
    tracker: { top: 10, height: 80 },
    wireframe: '/lp12/wireframes/00_overview.png',
    cards: [],
  },
  {
    id: 'downtilt', title: 'Set Downtilt', activePart: null,
    action: 'Confirm Downtilt', status: 'Mount Height Set',
    clip: null, camera: 'CAM_05_PIVOT', control: 'downtilt',
    tracker: { top: 28, height: 38 },
    wireframe: '/lp12/wireframes/03_pivot_bracket.png',
    cards: [],
  },
  {
    // Coverage review. No clip, so it does not count as an install step - the
    // "Step n of 6" counter derives its denominator from stages that carry a
    // clip, and this one deliberately does not.
    //
    // It exists because the coverage dome cannot be read from any of the
    // assembly anchors: at the correct rig settings it reaches ~86 m, so every
    // close-in camera is inside it. CAM_10_COVERAGE pulls back ~200 m to frame
    // the footprint, which leaves the hardware small - right for this screen,
    // wrong for the completion shot, hence a screen of its own.
    id: 'coverage', title: 'Network Coverage', activePart: null,
    action: 'Continue', status: 'Downtilt Set',
    clip: null, camera: 'CAM_10_COVERAGE',
    tracker: { top: 10, height: 80 },
    wireframe: '/lp12/wireframes/07_complete.png',
    cards: [],
  },
  {
    id: 'complete', title: 'Installation Complete', activePart: null,
    action: 'Continue to Network Tuning', status: 'Review Assembly',
    clip: null, camera: 'CAM_09_COMPLETE',
    tracker: { top: 10, height: 80 },
    wireframe: '/lp12/wireframes/07_complete.png',
    cards: [],
  },
]

/** Selectable downtilt values — model manifest downtilt.allowedDegrees. */
export const DOWNTILT_STEPS = [0, 2, 5, 8, 10]

export const PART_LABELS = {
  'pole-bands': 'Pole Bands', 'mounting-rail': 'Mounting Rail',
  'pivot-bracket': 'Pivot Bracket', 'antenna-unit': 'Antenna Unit',
  'fastener-set': 'Fastener Set', 'connector-set': 'Connector Set',
}

/** Prerequisite ordering, used for the wrong-order feedback in s8. */
export const PART_ORDER = ['pole-bands', 'mounting-rail', 'pivot-bracket',
                           'antenna-unit', 'fastener-set', 'connector-set']

/**
 * Preview copy: what the component is, and where it goes. Labels only — no
 * behaviour reads these, so adding a part here cannot change the assembly.
 */
export const PART_DESCRIPTION = {
  'pole-bands': 'Stainless steel bands that clamp the assembly to the pole.',
  'mounting-rail': 'Load-bearing rail the antenna assembly hangs from.',
  'pivot-bracket': 'Hinged bracket that sets and holds the downtilt angle.',
  'antenna-unit': 'The LP12 radio unit itself, with its radome and ports.',
  'fastener-set': 'Bolts and washers that lock the antenna to the bracket.',
  'connector-set': 'Weather-sealed RF jumpers and the earth bond.',
}

export const PART_PLACEMENT = {
  'pole-bands': 'Around the pole, at mount height.',
  'mounting-rail': 'Across the fitted pole bands.',
  'pivot-bracket': 'On the face of the mounting rail.',
  'antenna-unit': 'Onto the pivot bracket.',
  'fastener-set': 'Through the antenna and bracket lugs.',
  'connector-set': 'Into the antenna ports underneath.',
}

export const PART_PREREQ_MESSAGE = {
  'mounting-rail': 'Install the pole bands first.',
  'pivot-bracket': 'Install the mounting rail first.',
  'antenna-unit': 'Fit the pivot bracket first.',
  'fastener-set': 'Mount the antenna first.',
  'connector-set': 'Secure the antenna first.',
}

export const stageIndex = (id) => STAGES.findIndex((s) => s.id === id)
export const stageById = (id) => STAGES.find((s) => s.id === id) || STAGES[0]

/** Parts installed once a given stage has been completed. */
export const COMPLETED_PART_BY_STAGE = {
  bands: 'pole-bands', rail: 'mounting-rail', pivot: 'pivot-bracket',
  antenna: 'antenna-unit', fasteners: 'fastener-set', connectors: 'connector-set',
}


/** Studio anchor per installation stage (studio manifest camera names). */
export const STAGE_CAMERA = Object.fromEntries(STAGES.map((s) => [s.id, s.camera]))

/**
 * One-line instruction shown under the stage title. Labels only — the stage
 * table above still owns every behavioural field.
 */
export const STAGE_INSTRUCTION = {
  overview: 'Review the site, then begin the assembly.',
  bands: 'Drag the pole bands onto the pole.',
  rail: 'Drag the mounting rail onto the bands.',
  pivot: 'Drag the pivot bracket onto the rail.',
  antenna: 'Drag the antenna unit onto the bracket.',
  fasteners: 'Drag the fastener set onto the antenna.',
  connectors: 'Drag the connector set onto the antenna ports.',
  height: 'Set the mount height for this site.',
  downtilt: 'Turn the knob to the correct downtilt.',
  coverage: 'Check the resulting network coverage.',
  complete: 'All components installed and secured.',
}
