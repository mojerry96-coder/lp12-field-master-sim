import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import * as THREE from 'three'
import StudioEnvironment from './StudioEnvironment'
import SiteLighting from './SiteLighting'
import PartCallouts, { CalloutBridge } from './PartCallouts'
import SiteEnvironment from './SiteEnvironment'
import ComponentHighlight from './ComponentHighlight'
import { STAGE_TO_VIEW } from '../lib/nodeAliases'
import { STAGE_CONFIG, REQUIRED_NODES } from '../lib/stageConfig'
import { CLIP_ORDER, ALL_STAGED_PARTS, STAGE_PARTS, ASSEMBLY_CLIPS } from '../lib/assemblyClips'
import { createLP12AnimationController } from '../lib/lp12AnimationController'
import { effectiveCoverageRadiusM } from '../lib/coverage'
import CoverageDomeFX from './CoverageDomeFX'

import { LP12_MODEL_URL } from '../store'
useGLTF.preload(LP12_MODEL_URL)

/* --- camera: poses come from camera_flow.json, already model-relative ------ */
const toThree = (v) => new THREE.Vector3(v[0], v[2], -v[1])
const vFovFromLens = (lens, aspect = 16 / 9) =>
  2 * Math.atan(36 / aspect / 2 / lens) * (180 / Math.PI)


/** Aspect the studio anchors were composed against (Blender 1400x1000). */
const STUDIO_AUTHORED_ASPECT = 1400 / 1000

/**
 * Vertical FOV for an authored Blender anchor.
 *
 * Earlier this did an object-fit: contain against the authored 1400x1000 frame,
 * widening vertically whenever the viewport was narrower. That is exactly wrong
 * for this subject: the pole is tall and thin, so preserving HORIZONTAL extent
 * in a tall pane blew the vertical FOV open and left the pole tiny.
 *
 * Holding the authored vertical FOV instead keeps the pole filling the frame at
 * any aspect — a narrow pane simply sees less to the sides, which costs nothing
 * for a vertical subject. Only widen when the pane is so wide that the authored
 * vertical would crop the subject horizontally.
 */
const fitFovToViewport = (lensMM, authoredAspect, viewportAspect) => {
  const halfH = Math.atan(36 / 2 / lensMM)                 // horizontal half-angle
  const authoredV = 2 * Math.atan(Math.tan(halfH) / authoredAspect)
  return authoredV * (180 / Math.PI)
}
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

const WORLD_UP = new THREE.Vector3(0, 1, 0)

/**
 * Spec section 9: sit the subject slightly left of viewport centre.
 *
 * The anchor's `bias` is a fraction of FRAME WIDTH, not a world distance,
 * because the canvas is the right-hand column of the layout and its aspect is
 * nothing like the 1400x1000 the anchors were composed against — the same
 * world offset would read as a different fraction in each. Resolving it here,
 * against the live viewport, is the only place the fraction means what it says.
 *
 * Sliding the TARGET right slides the subject left, so the camera keeps its
 * authored position and only its aim changes.
 */
/**
 * Composition bias for the redesigned assembly pages.
 *
 * The authored anchors carry subjectBias 0.08, which slides the subject 8% of
 * the frame width LEFT of centre. That was composed against the old workspace,
 * where the canvas was the layout's right-hand column and the instruction
 * panel sat beside it rather than over it. The redesigned assembly pages are
 * full-bleed with the step title as a left-hand overlay, so the authored bias
 * now pushes the pole underneath the very text it needs to stay clear of —
 * "INSTALL POLE BANDS" ends about 44% across and the pole centres at 42%.
 *
 * Negating and deepening it seats the subject right of centre. The binding
 * case is 'antenna': its title is one long line and the stage pushes the
 * camera in, so the bracket is both wide and far right of the text — 0.13 is
 * what clears it, and the shorter stages simply gain more room. It stays a
 * fraction of frame width, so the gap between pole and text holds at every
 * resolution instead of drifting the way a pixel offset would.
 *
 * Nothing about the model changes. This moves where the camera aims; the pole,
 * its anchors, the drop target and the assembly clips are all untouched, which
 * is why the target highlight stays glued to the pole as it moves.
 */
const ASSEMBLY_STAGE_IDS = new Set([
  'bands', 'rail', 'pivot', 'antenna', 'fasteners', 'connectors',
])
const ASSEMBLY_SUBJECT_BIAS = -0.13

/* The coverage page is the one page where the scene IS the message: there is
   no title column to keep clear, so the site is centred rather than composed
   off-axis the way the authored anchor has it. */
const CENTRED_STAGE_IDS = new Set(['coverage', 'handover'])

const subjectBiasFor = (stage, authored) => (
  ASSEMBLY_STAGE_IDS.has(stage) ? ASSEMBLY_SUBJECT_BIAS
    : CENTRED_STAGE_IDS.has(stage) ? 0
      : authored
)

const applySubjectBias = (pos, tgt, bias, vFovDeg, aspect) => {
  if (!bias) return tgt
  const dist = pos.distanceTo(tgt)
  const halfW = Math.tan(THREE.MathUtils.degToRad(vFovDeg) / 2) * aspect * dist
  const right = new THREE.Vector3().subVectors(tgt, pos).normalize()
    .cross(WORLD_UP).normalize()
  return tgt.clone().addScaledVector(right, 2 * halfW * bias)
}

/**
 * Clips worth pushing in on, and when.
 *
 * ANIM_06 spends its first second bringing the cable run up to the ports and
 * its last second threading the coupling nuts — 900 degrees of rotation on a
 * 21 mm nut. At the stage's authored framing that is a few pixels of movement,
 * so the half of the clip the stage is actually named after was invisible.
 * `delayMs` is set to land the push just as the nuts start to turn (frame 32
 * of 60 at 30fps ≈ 1.07 s), not at the clip's start.
 */
const CLIP_FOCUS = {
  ANIM_06_Connectors_Attach: { node: 'Connector_Bank', delayMs: 1050, distance: 1.15, lensMM: 90 },
}


/**
 * Stages whose subject must be wholly in frame, and what "wholly" means.
 *
 * The fasteners stage is the case that forced this. Its authored anchor frames
 * the antenna tightly and the four fasteners sit at the radome's corners, so
 * two of them were outside the frustum for the entire clip — the learner was
 * being shown a bolt animation with the bolts cropped off.
 *
 * Fitting is computed from the model rather than by moving the anchor, because
 * the antenna has grown twice already (end caps, bezel, vent) and a hand-set
 * distance goes stale every time it does.
 */
/**
 * Stages that pull the camera back until their subject fits.
 *
 * The rig pages needed it for a reason worth recording: their anchors are
 * authored close, and at a tall or narrow viewport that framing crops INTO the
 * assembly. The antenna, the bracket and the rail then arrive on screen as
 * three separate objects with gaps between them, and the pole reads as
 * scattered rather than built — the model is correct, the camera is simply
 * standing inside it. Fitting the whole mounted assembly guarantees the
 * relationship between the parts is visible at every aspect, which is the
 * thing these two pages are asking the learner to judge.
 */
const MOUNTED_ASSEMBLY = ['Antenna_Body', 'Pivot_Bracket', 'Mounting_Rail', 'Band_Top_Front']

const STAGE_FIT = {
  fasteners: { nodes: ['Antenna_Body', 'Antenna_Fasteners'], margin: 1.28 },
  downtilt: { nodes: MOUNTED_ASSEMBLY, margin: 1.9 },
  height: { nodes: [...MOUNTED_ASSEMBLY, 'Pole_Shaft'], margin: 1.12 },
}

/**
 * The coverage page is framed like an architectural model: the whole city
 * plate, seen from high up at a corner, centred, with white studio all round.
 *
 * The authored CAM_10 anchor is a street-level oblique (about 23 degrees of
 * elevation, aimed 40 m above the pole) and the plate runs off every edge of
 * it. So the anchor only lends its bearing here — which corner the city is
 * seen from — and everything else is solved from the plate's own footprint:
 * the target is the centre of the ground, the elevation is fixed, and the
 * distance is whatever puts all eight corners of the plate's box inside the
 * viewport at the live aspect. Corner-fitting rather than a bounding sphere,
 * because a 440 x 340 m slab's sphere is mostly empty air and would leave the
 * plate small in a wide frame.
 */
/**
 * `fill` is how much of the plate-fitting distance the default actually uses.
 *
 * Fitting all eight corners of the environment's box puts the whole district in
 * frame with white studio around it — an architectural model on a table. The
 * subject of this page is the dome over one junction, and at that distance it
 * is a small blue shape in the middle of a lot of city. Coming in to 60% of the
 * fitted distance gives the framing this page was signed off at: the dome
 * dominant, the boulevard running through it, buildings for context.
 *
 * It is a fraction of the fit rather than an absolute distance so it stays
 * correct if the environment or the viewport aspect changes.
 */
const COVERAGE_FRAME = {
  // Lower than the 52 the plate-fitting view used: at that elevation the city
  // reads as a floor plan. Around 40 degrees the buildings show their faces and
  // the boulevard recedes, which is the view this page was signed off on.
  // 44 rather than 40: at the closer distance a shallower camera sees past the
  // far corners of the environment slab and the studio shows through as white
  // wedges in the top corners. Four degrees of lift puts the city across the
  // whole frame without flattening it into a plan.
  elevationDeg: 44, lensMM: 45, margin: 1.06, fill: 0.42, near: 0.5, far: 2000,
  /**
   * Bearing, taken here rather than inherited from the stage anchor.
   *
   * The anchor's bearing looks ACROSS the boulevard, which puts the road on a
   * diagonal and the dome against a row of roofs. Awolowo Way runs along world
   * X, so -90 degrees stands the camera at one end and looks down it: the road
   * runs away up the frame, the dome sits over the junction in the middle, and
   * the buildings line both sides. That is the composition this page wants,
   * because the thing being judged is how far the cell reaches ALONG the road.
   */
  azimuthDeg: -90,
}
const COVERAGE_FRAME_STAGES = new Set(['coverage', 'handover'])
const ENV_FOOTPRINT_NODES = ['ENV_Ground_merged', 'ENV_Roads_merged']

function frameEnvironment(scene, anchor, aspect, domeRadiusM = 0) {
  const box = new THREE.Box3()
  let found = false
  ENV_FOOTPRINT_NODES.forEach((n) => {
    const node = scene.getObjectByName(n)
    if (node) { box.expandByObject(node, true); found = true }
  })
  if (!found || box.isEmpty()) return null

  const fov = fitFovToViewport(COVERAGE_FRAME.lensMM, STUDIO_AUTHORED_ASPECT, aspect)
  const vHalf = THREE.MathUtils.degToRad(fov) / 2
  const hHalf = Math.atan(Math.tan(vHalf) * aspect)
  const tanV = Math.tan(vHalf)
  const tanH = Math.tan(hHalf)

  const tgt = box.getCenter(new THREE.Vector3())
  tgt.y = box.min.y

  // Bearing and elevation both from the rule; the anchor is no longer consulted
  // for either, so this framing is stable whatever CAM_10 is authored at.
  const az = THREE.MathUtils.degToRad(COVERAGE_FRAME.azimuthDeg)
  const el = THREE.MathUtils.degToRad(COVERAGE_FRAME.elevationDeg)
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
  const fwd = dir.clone().negate()
  const right = fwd.clone().cross(WORLD_UP).normalize()
  const up = right.clone().cross(fwd).normalize()

  let dist = 0
  const c = new THREE.Vector3()
  for (let i = 0; i < 8; i += 1) {
    c.set(i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z).sub(tgt)
    const cf = c.dot(fwd)
    dist = Math.max(dist, Math.abs(c.dot(right)) / tanH - cf,
                    Math.abs(c.dot(up)) / tanV - cf)
  }
  dist *= COVERAGE_FRAME.margin * COVERAGE_FRAME.fill

  /**
   * Then stand far enough back to actually SEE the dome.
   *
   * The distance above is fitted to the city slab alone, which was safe only
   * while this page could be reached with the correct rig settings and nothing
   * else: at 7.5 m and 5 degrees the footprint is ~86 m and sits comfortably
   * inside that framing. The assessment model now accepts whatever height and
   * tilt the learner picks, and the radius is `height / tan(downtilt)` — so a
   * shallow tilt throws it out to the 250 m clamp. The camera then ends up
   * INSIDE the hemisphere, which is backface-culled, and the page whose entire
   * subject is the dome renders a city with no dome and no visible pole.
   *
   * The dome is a hemisphere of radius R standing on the ground at the LP12,
   * which is the world origin and effectively the ground target here. Framing a
   * sphere of radius R needs `R / sin(halfAngle)` along the view axis, taking
   * the narrower of the two half-angles so it fits in both directions. Taking
   * the max with the city fit keeps the signed-off framing wherever the dome is
   * small enough to fit inside it, and only pulls back when it is not.
   */
  if (domeRadiusM > 0) {
    const halfMin = Math.min(vHalf, hHalf)
    dist = Math.max(dist, (domeRadiusM / Math.sin(halfMin)) * COVERAGE_FRAME.margin)
  }

  const pos = tgt.clone().addScaledVector(dir, dist)
  return { pos, tgt, fov, near: COVERAGE_FRAME.near, far: COVERAGE_FRAME.far }
}

/**
 * Compiles the scene's shaders before the stage is revealed.
 *
 * three compiles a material's program the first time it is actually drawn. Do
 * that on the first visible frame and the first camera move stutters — the
 * jank is not the camera, it is twenty programs compiling while the frame is
 * already on screen. renderer.compile() walks the graph and builds them up
 * front, off-screen, before anyone is looking.
 *
 * It reports ready once, after one compile pass and one settled frame; the
 * gate above is what turns that into a reveal.
 */
function ScenePrecompile({ onCompiled }) {
  const { gl, scene, camera } = useThree()
  const state = useRef({ done: false, frames: 0 })

  useFrame(() => {
    const st = state.current
    if (st.done) return
    if (st.frames === 0) {
      // compile() is synchronous and can take tens of ms — which is the whole
      // point of it happening here rather than on the first visible frame.
      gl.compile(scene, camera)
    }
    st.frames += 1
    // One frame to compile, one to let anything lazily created settle.
    if (st.frames >= 2) {
      st.done = true
      onCompiled?.()
    }
  })
  return null
}


function CameraDirector({ flow, studio, stage, cameraName, view = 'front',
                          activeClip = null, modelRoot = null, orbitInput = null,
                          viewRef = null, domeRadiusM = 0 }) {
  const { camera, size, scene } = useThree()
  const state = useMemo(
    () => ({ anim: null, pos: null, tgt: null, subject: null, focus: null,
             home: null, pendingFrame: false }), [])

  // Studio manifest wins when present: it carries the 9 authored anchors and
  // the stage -> camera map straight from Blender.
  const studioViews = useMemo(() => {
    if (!studio) return null
    const out = {}
    for (const [name, v] of Object.entries(studio.cameras)) {
      out[name] = { pos: toThree(v.position), tgt: toThree(v.target),
                    lensMM: v.lensMM, bias: v.subjectBias || 0,
                    near: 0.05, far: 500 }
    }
    return out
  }, [studio])

  const views = useMemo(() => {
    if (studioViews) return studioViews
    if (!flow) return null
    const out = {}
    for (const [k, v] of Object.entries(flow.views)) {
      out[k] = { pos: toThree(v.position), tgt: toThree(v.targetPosition),
                 fov: vFovFromLens(v.lensMM), near: v.near, far: v.far }
    }
    return out
  }, [flow])

  useEffect(() => {
    if (!views) return
    // The caller resolves the anchor from its own stage table and passes the
    // name; prefer it. The manifest's stageCamera map is keyed by the older
    // buildStage ids ('attachBands'), not the installation stage ids
    // ('bands'), so looking the stage up in it misses on every stage and
    // silently falls back to CAM_01 - which is how all nine anchors came to
    // render as the same full-pole view.
    const key = cameraName
      || (studio ? (studio.stageCamera[stage] || 'CAM_01_FULL_POLE')
                 : STAGE_TO_VIEW[stage])
    let v = views[key]
    if (v && view === 'side') {
      // s11: rotate the camera, never the model.
      const offset = v.pos.clone().sub(v.tgt)
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
      v = { ...v, pos: v.tgt.clone().add(offset) }
    }
    if (!v) return
    const aspect = size.width / size.height
    const fov = v.lensMM !== undefined
      ? fitFovToViewport(v.lensMM, STUDIO_AUTHORED_ASPECT, aspect)
      : (aspect < 16 / 9 ? v.fov * ((16 / 9) / aspect) : v.fov)
    // The subject itself, before the composition bias slides the aim sideways
    // to push it off centre. Overlays that have to sit ON the hardware need
    // this one; the camera needs the biased one below.
    state.subject = v.tgt.clone()
    let tgt = applySubjectBias(v.pos, v.tgt, subjectBiasFor(stage, v.bias), fov, aspect)

    // Pull back until the stage's subject fits, if it does not already.
    const fit = STAGE_FIT[stage]
    if (fit && modelRoot) {
      const box = new THREE.Box3()
      let found = false
      fit.nodes.forEach((n) => {
        let node = null
        modelRoot.traverse((o) => { if (!node && o.name === n) node = o })
        if (node) { box.expandByObject(node); found = true }
      })
      if (found && !box.isEmpty()) {
        const sphere = box.getBoundingSphere(new THREE.Sphere())
        // Vertical FOV binds on a tall subject, horizontal on a wide one in a
        // narrow viewport; take whichever needs the greater distance.
        const vHalf = THREE.MathUtils.degToRad(fov) / 2
        const hHalf = Math.atan(Math.tan(vHalf) * aspect)
        const need = (sphere.radius * fit.margin)
          / Math.sin(Math.min(vHalf, hHalf))
        const dir = v.pos.clone().sub(sphere.center)
        if (dir.length() < need) {
          v = { ...v, pos: sphere.center.clone().add(dir.normalize().multiplyScalar(need)) }
          tgt = sphere.center.clone()
        }
      }
    }
    // Coverage: the whole plate, from above, centred. The environment mounts
    // in its own Suspense boundary and may not be in the scene yet when this
    // runs; if it is not, the frame loop below keeps looking and eases over
    // to the plate framing the moment it lands.
    let fov2 = fov
    state.pendingFrame = false
    if (COVERAGE_FRAME_STAGES.has(stage)) {
      const framed = frameEnvironment(scene, v, aspect, domeRadiusM)
      if (framed) {
        v = { ...v, pos: framed.pos, near: framed.near, far: framed.far }
        tgt = framed.tgt
        fov2 = framed.fov
      } else {
        state.pendingFrame = true
      }
    }
    // The stage's authored framing, kept so navigation can be reset to it.
    state.home = { pos: v.pos.clone(), tgt: tgt.clone(), fov: fov2,
                   near: v.near, far: v.far }
    if (!state.pos) {
      state.pos = v.pos.clone(); state.tgt = tgt.clone()
      camera.position.copy(v.pos); camera.lookAt(tgt)
      camera.fov = fov2; camera.near = v.near; camera.far = v.far
      camera.updateProjectionMatrix()
      return
    }
    camera.near = v.near; camera.far = v.far
    state.anim = { t: 0, fromPos: state.pos.clone(), fromTgt: state.tgt.clone(),
                   fromFov: camera.fov, to: { ...v, tgt, fov: fov2 } }
  }, [views, studio, stage, cameraName, view, camera, size, state, activeClip, modelRoot, scene])

  // Push in on the part being worked, partway through the clip.
  useEffect(() => {
    const spec = activeClip ? CLIP_FOCUS[activeClip] : null
    // Runs in orbit too. Orbit is the default view now, and excluding it here
    // meant the connector push-in — the whole reason that focus exists — never
    // fired unless the learner had switched to Front or Side first. The frame
    // loop already yields to state.anim, so the push takes over, and orbit
    // resumes around wherever it left the camera.
    if (!spec || !modelRoot) { state.focus = null; return undefined }
    let node = null
    modelRoot.traverse((o) => { if (!node && o.name === spec.node) node = o })
    if (!node) return undefined
    const id = setTimeout(() => {
      const subject = new THREE.Vector3()
      node.getWorldPosition(subject)
      // Keep the current bearing and dolly along it, so the push reads as the
      // same camera moving closer rather than a cut to somewhere else.
      const dir = (state.pos || camera.position).clone().sub(subject)
      if (dir.lengthSq() < 1e-6) return
      dir.normalize()
      const aspect = size.width / size.height
      const fov = fitFovToViewport(spec.lensMM, STUDIO_AUTHORED_ASPECT, aspect)
      // Same off-centre composition as the stage anchor, or the push-in would
      // re-centre the part under the title for the length of the clip.
      const pos = subject.clone().add(dir.clone().multiplyScalar(spec.distance))
      const tgt = applySubjectBias(pos, subject, subjectBiasFor(stage, 0), fov, aspect)
      state.anim = {
        t: 0, fromPos: (state.pos || camera.position).clone(),
        fromTgt: (state.tgt || tgt).clone(), fromFov: camera.fov,
        to: { pos, tgt, fov, near: camera.near, far: camera.far },
      }
      state.focus = activeClip
    }, spec.delayMs)
    return () => clearTimeout(id)
  }, [activeClip, modelRoot, camera, size, state, stage])

  useFrame((_, dt) => {
    // The stage's look-at point, published for the DOM overlays. It is the
    // Blender anchor's own target, so "where this stage is working" is
    // authored data rather than a rectangle guessed in CSS.
    if (viewRef?.current && state.subject) viewRef.current.target = state.subject

    // The plate arrived after the stage effect ran: frame it now, from
    // wherever the camera is, with the same eased move a stage change gets.
    if (state.pendingFrame && state.home && state.pos) {
      const framed = frameEnvironment(
        scene, state.home, size.width / size.height, domeRadiusM)
      if (framed) {
        state.pendingFrame = false
        state.home = { ...framed }
        camera.near = framed.near; camera.far = framed.far
        state.anim = { t: 0, fromPos: state.pos.clone(), fromTgt: state.tgt.clone(),
                       fromFov: camera.fov, to: { ...framed } }
      }
    }


    // Navigation runs on the resolved target, so it follows whatever the stage
    // is framing and survives a stage change without re-deriving anything.
    if (view === 'orbit' && state.tgt && state.pos && !state.anim) {
      // Driven by the learner, never by the clock. A frame with no input is a
      // frame where the camera does not move — which is what makes the motion
      // stop the instant the gesture does.
      const d = orbitInput ? orbitInput.consume() : null
      if (!d) return

      if (d.reset && state.home) {
        state.anim = { t: 0, fromPos: state.pos.clone(), fromTgt: state.tgt.clone(),
                       fromFov: camera.fov, to: { ...state.home } }
        return
      }
      if (!d.az && !d.el && !d.dolly && !d.panX && !d.panY) return

      const off = state.pos.clone().sub(state.tgt)
      let r = off.length()
      // Spherical about the target: azimuth free, elevation clamped short of
      // both poles so the view never flips or dives under the ground plane.
      let az = Math.atan2(off.x, off.z) + d.az
      let el = Math.acos(THREE.MathUtils.clamp(off.y / r, -1, 1)) + d.el
      el = THREE.MathUtils.clamp(el, 0.18, Math.PI / 2 - 0.02)
      /**
       * Log-scale dolly, so a trackpad flick behaves the same as a mouse notch.
       *
       * The outer stop is the stage's own framing rather than a fixed number:
       * the authored distance is the widest the page is composed for, and past
       * it the subject just recedes into empty studio. So the learner can move
       * in as far as they like and out only as far as the view they arrived on.
       */
      const homeR = state.home
        ? state.home.pos.distanceTo(state.home.tgt)
        : 900
      r = THREE.MathUtils.clamp(r * Math.exp(d.dolly), 4, homeR)

      if (d.panX || d.panY) {
        // Pan in screen space, scaled by radius so it feels the same near and
        // far. The target moves; the camera follows it below.
        const fwd = state.tgt.clone().sub(state.pos).normalize()
        const right = fwd.clone().cross(WORLD_UP).normalize()
        const up = right.clone().cross(fwd).normalize()
        const shift = right.multiplyScalar(d.panX * r)
          .add(up.multiplyScalar(d.panY * r))
        state.tgt = state.tgt.clone().add(shift)
      }

      const sinEl = Math.sin(el)
      state.pos = state.tgt.clone().add(new THREE.Vector3(
        Math.sin(az) * sinEl * r, Math.cos(el) * r, Math.cos(az) * sinEl * r))
      camera.position.copy(state.pos)
      camera.lookAt(state.tgt)
      return
    }
    const a = state.anim
    if (!a) return
    a.t = Math.min(1, a.t + dt / 1.25)
    const k = easeInOut(a.t)
    state.pos = a.fromPos.clone().lerp(a.to.pos, k)
    state.tgt = a.fromTgt.clone().lerp(a.to.tgt, k)
    camera.position.copy(state.pos)
    camera.lookAt(state.tgt)
    camera.fov = THREE.MathUtils.lerp(a.fromFov, a.to.fov, k)
    camera.updateProjectionMatrix()
    if (a.t >= 1) { state.anim = null }
  })
  return null
}

/* --- LP12 only. No environment GLB is loaded on this route. ---------------- */
/**
 * The hardware is HOT-DIP GALVANISED, not dark steel: high-albedo,
 * warm-neutral, semi-rough metal with soft broad highlights.
 *
 * None of that is set here any more. Albedo and roughness are graded into the
 * texture pixels by deliverables/source/regrade_textures.py, and metalness
 * ships as the glTF metallicFactor — so the GLB is the single authority on
 * what these materials are.
 *
 * Setting `roughness` here on top of that is not a second opinion, it is a
 * multiply: three.js uses `roughness * roughnessMap.g`, so re-asserting the
 * authored 0.31 would land the bands on 0.10 and turn galvanised steel into
 * chrome. The only thing left below is environment response, which is a
 * property of this scene rather than of the material.
 */
/**
 * Stages that show the coverage dome.
 *
 * Not the height stage. It used to be included so the learner could watch the
 * footprint change while they moved the control, but that reasoning assumed
 * the city was behind it; with the environment gone (specification 2.4) the
 * dome is a pale hemisphere filling an otherwise empty studio, and Page 11
 * asks the learner to judge a height against the column, which is exactly what
 * it covers. Nor the downtilt stage, where the same information is carried by
 * the coverage mini viewport (2.7) and a scene-sized dome would swallow the
 * hinge geometry the learner is there to watch. Nor the completion screen,
 * which summarises what was commissioned — repeating the footprint under it
 * turns a consequence into wallpaper. Coverage gets one page, and that is the
 * page it gets.
 */
const DOME_STAGES = new Set(['coverage'])

/** Range the cable's flex morph targets were authored over, in degrees.
 *  Must match FLEX_RANGE_DEG in build_lp12_v2.py. */
const FLEX_RANGE_DEG = 10

const TEXTURE_SLOTS = ['map', 'roughnessMap', 'normalMap', 'aoMap', 'emissiveMap']

function tuneMaterial(mesh, maxAnisotropy = 1) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  mats.forEach((m) => {
    if (!m || m.userData.__tuned) return
    m.envMapIntensity = m.metalness > 0.5 ? 1.6 : 1.05

    // Anisotropic filtering. Every texture arrives at anisotropy 1, and this
    // model is almost entirely grazing-angle surfaces - a tapered cylindrical
    // pole, band straps wrapping away from camera - which is the exact case
    // isotropic mipmapping blurs into mush. The concrete reads soft in the
    // browser next to the Blender render for this reason and no other; the
    // texture data is identical.
    TEXTURE_SLOTS.forEach((slot) => {
      const t = m[slot]
      if (!t || t.anisotropy === maxAnisotropy) return
      t.anisotropy = maxAnisotropy
      t.needsUpdate = true
    })

    m.userData.__tuned = true
    m.needsUpdate = true
  })
}

function LP12Assembly({ height, downtilt, stage, completedClips, activeClip, rigSettled, onReady, onError }) {
  const { scene, animations } = useGLTF(LP12_MODEL_URL)
  const { gl } = useThree()
  const maxAnisotropy = useMemo(() => gl.capabilities.getMaxAnisotropy(), [gl])
  const { actions, mixer } = useAnimations(animations, scene)

  const nodes = useMemo(() => {
    const map = {}
    scene.traverse((o) => {
      map[o.name] = o
      if (o.isMesh) {
        o.castShadow = true
        o.receiveShadow = true
        tuneMaterial(o, maxAnisotropy)
        // NOTE: the GLB exports every material doubleSided. Forcing FrontSide
        // here is the correct end state, but the meshes have inconsistent face
        // winding (bands render as broken strips when back faces are culled),
        // so it must be fixed in Blender first — see build_lp12.py.
      }
    })
    return map
  }, [scene, maxAnisotropy])

  useEffect(() => {
    // Report every missing node together rather than failing on the first.
    const missing = REQUIRED_NODES.filter((n) => !nodes[n])
    if (missing.length) {
      const msg = `LP12 GLB is missing required nodes: ${missing.join(', ')}`
      console.error('[LP12]', msg, '\nLoaded hierarchy:', Object.keys(nodes))
      onError?.(msg)
      return
    }
    // Each selected group must actually contain a mesh, or the outline is a no-op.
    const empty = Object.entries(STAGE_CONFIG)
      .flatMap(([st, c]) => c.selected.map((n) => [st, n]))
      .filter(([, n]) => {
        const o = nodes[n]
        if (!o) return true
        let has = false
        o.traverse((c) => { if (c.isMesh) has = true })
        return !has
      })
    if (empty.length) {
      console.warn('[LP12] selection groups with no mesh descendants:', empty)
    }
    // s26: verify the clip contract before anything tries to play one.
    const missingClips = CLIP_ORDER.filter((c) => !actions[c])
    if (missingClips.length) {
      const msg = `LP12 GLB is missing animation clips: ${missingClips.join(', ')}`
      console.error('[LP12]', msg, '\nfound:', Object.keys(actions))
      onError?.(msg)
      return
    }

    const extras = nodes['LP12_ROOT'].userData
    const controller = createLP12AnimationController({ actions, mixer })
    onReady?.(extras && Object.keys(extras).length ? extras : null, scene, controller)
  }, [nodes, scene, actions, mixer, onReady, onError])

  const baseRef = useMemo(() => ({ y: null }), [])
  useEffect(() => {
    const n = nodes['Height_Rig']
    if (!n) return
    if (baseRef.y === null) baseRef.y = 0     // authored neutral is metres directly
    n.position.y = THREE.MathUtils.clamp(height, 4, 12)
    n.updateMatrixWorld(true)
  }, [nodes, height, baseRef])
  useEffect(() => {
    // Tilt_Rig is the real hinge; the brief's "Pivot_Bracket" is a mesh under it.
    const n = nodes['Tilt_Rig']
    if (!n) return
    n.rotation.x = -THREE.MathUtils.degToRad(downtilt)   // +UI = -local X
    n.updateMatrixWorld(true)

    // Flex the feeder to match.
    //
    // Antenna_Cables hangs off this hinge, so without this the whole run —
    // including the length cleated to the pole 1.2 m below the pivot — swings
    // rigidly with the antenna. Measured in Blender, that puts the cable 68 mm
    // INSIDE the shaft at full downtilt. The model carries two morph targets
    // that cancel the inherited rotation below the cleat; driving them here
    // keeps the run dressed against the pole across the whole range (clearance
    // stays 16-78 mm instead of swinging -68 to +259 mm).
    //
    // +UI downtilt is -local X, so it is the NEG target that does the work.
    const cable = nodes['Antenna_Cables']
    const dict = cable?.morphTargetDictionary
    if (!dict || !cable.morphTargetInfluences) return
    const t = THREE.MathUtils.clamp(downtilt / FLEX_RANGE_DEG, 0, 1)
    if (dict.Flex_Tilt_Neg !== undefined) cable.morphTargetInfluences[dict.Flex_Tilt_Neg] = t
    if (dict.Flex_Tilt_Pos !== undefined) cable.morphTargetInfluences[dict.Flex_Tilt_Pos] = 0
  }, [nodes, downtilt])

  /**
   * s33 visibility, driven by the CLIP rather than the stage.
   *
   * A part appears only once its own clip is actually running, or once that
   * clip has completed. Revealing on stage entry was wrong: it put the antenna
   * on screen already looking mounted before the learner pressed "Mount
   * antenna", and it showed the whole assembly during inspectPole.
   */
  /**
   * Hold every finished clip at its end pose.
   *
   * The visibility pass below reveals the parts a stage has installed, but
   * revealing a part does not move it: the GLB ships every component at a rest
   * offset and only its own clip carries it to the mount. Playback used to be
   * the only thing holding those poses — each action clamps when finished and
   * is deliberately never stopped — and that works right up until an action
   * stops holding for any reason at all. When it does, the part springs back
   * to rest and the pole is left with a component lying at its base while the
   * rest of the assembly sits 7.5 m up: the "scattered" pole on the rig pages.
   *
   * So the assembled state is derived from `completedClips` rather than
   * inherited from a history of successful playbacks. Snapping is idempotent —
   * the clip that just finished is already at its end — and it means arriving
   * at a stage by any route produces the same pole.
   */
  useEffect(() => {
    const done = (completedClips || []).filter((c) => c && c !== activeClip)
    if (!done.length || !actions) return
    done.forEach((name) => {
      const a = actions[name]
      if (!a) return
      a.enabled = true
      a.reset()
      a.setEffectiveWeight(1)
      a.setLoop(THREE.LoopOnce, 1)
      a.clampWhenFinished = true
      a.play()
      a.time = a.getClip().duration
      a.paused = true
    })
    mixer.update(0)
  }, [actions, mixer, completedClips, activeClip])

  useEffect(() => {
    const done = new Set(completedClips || [])
    const revealed = new Set()
    Object.entries(STAGE_PARTS).forEach(([st, parts]) => {
      const clip = ASSEMBLY_CLIPS[st]
      if (done.has(clip) || activeClip === clip) parts.forEach((n) => revealed.add(n))
    })
    ALL_STAGED_PARTS.forEach((n) => {
      const o = nodes[n]
      if (o) o.visible = revealed.has(n)
    })
  }, [nodes, completedClips, activeClip])

  /* The additive Coverage_Beam cone that used to live here is gone.
   *
   * It was a 26 m long, 8 m radius ConeGeometry with AdditiveBlending pinned to
   * Beam_Origin, and it read on screen as a spotlight washing down the pole.
   * Nothing in the live route ever passed `showBeam`, so it was only ever
   * visible by accident — and the Coverage_Dome now expresses reach honestly,
   * derived from height and downtilt rather than drawn at a fixed 26 m. */

  /**
   * X-ray the enclosure while the fasteners go in.
   *
   * CAM_07_FASTENERS looks straight at the antenna, and the four bolts it is
   * about to show being driven are behind the enclosure body from that angle -
   * so the one stage whose entire subject is "watch the bolts fasten" showed a
   * solid box and nothing else. Dropping the enclosure to wireframe for that
   * stage lets the bolts read as they turn into their holes, which is the
   * whole point of the step.
   *
   * The material is cloned once and cached, so toggling never mutates the
   * shared GLB material and never disturbs any other stage.
   */
  useEffect(() => {
    const body = nodes['Antenna_Body']
    const fins = nodes['Cooling_Fins']
    const xray = stage === 'fasteners'

    // The heat sink is hidden outright rather than wireframed. Its fins are
    // dozens of thin parallel plates, so in wireframe they become a dense grid
    // sitting directly between the camera and the bolts — competing with the
    // very thing this stage exists to show.
    if (fins) {
      if (xray) {
        // Remember whatever the staged-visibility contract had decided, so
        // leaving the stage restores its answer rather than this one.
        if (fins.userData.__preXray === undefined) fins.userData.__preXray = fins.visible
        fins.visible = false
      } else if (fins.userData.__preXray !== undefined) {
        fins.visible = fins.userData.__preXray
        delete fins.userData.__preXray
      }
    }
    ;[body].forEach((o) => {
      if (!o || !o.material) return
      if (!o.userData.__solidMat) o.userData.__solidMat = o.material
      if (!o.userData.__wireMat) {
        const w = o.userData.__solidMat.clone()
        w.wireframe = true
        w.transparent = true
        w.opacity = 0.55
        w.depthWrite = false
        // Emissive so the cage reads against the pale studio rather than
        // dissolving into it.
        if (w.emissive) { w.emissive.setHex(0x8899aa); w.emissiveIntensity = 0.6 }
        o.userData.__wireMat = w
      }
      o.material = xray ? o.userData.__wireMat : o.userData.__solidMat
      o.material.needsUpdate = true
    })
    // activeClip is a dependency because the staged-visibility effect above
    // also writes .visible and re-runs when the clip starts; without it the
    // heat sink reappears mid-animation and covers the bolts again.
  }, [nodes, stage, activeClip])

  // Coverage dome. The GLB ships it as a UNIT hemisphere on LP12_ROOT; radius,
  // colour state and the ripple/pulse all live in CoverageDomeFX. It is shown
  // from the height stage onward, not only on the coverage screen, so the
  // learner can watch the footprint change as they move the two controls that
  // determine it — which is the point of deriving the radius from them.

  // Model-space presentation root; LP12_Anchor is no longer used at runtime.
  return (
    <group name="LP12_PRESENTATION_ROOT" position={[0, 0, 0]}>
      <primitive object={scene} />
      <CoverageDomeFX
        domeNode={nodes['Coverage_Dome']}
        radius={effectiveCoverageRadiusM(height, downtilt)}
        active={DOME_STAGES.has(stage)}
        settled={rigSettled}
      />
    </group>
  )
}

/**
 * The stage's target region, drawn where the stage is actually working.
 *
 * The specification places this with viewport units (`right: 27vw, top: 27vh`).
 * That holds for exactly one camera and one window shape, and the learner can
 * now turn the camera, so it would slide off the column the moment they did.
 *
 * Projecting the component itself is not available either: the parts ship at
 * rest offsets and only reach their mounting positions when their clip runs,
 * so the destination does not exist as a node until after the drop that the
 * highlight exists to invite.
 *
 * What does exist is the stage's camera anchor, whose look-at point was
 * authored in Blender to frame precisely the area being worked on. The region
 * is a fixed-size collar around that point, sized in WORLD units so it stays
 * the same physical size on the pole however close the stage's camera sits —
 * an earlier version sized it as a fraction of the projected pole, which is
 * correct in world terms and useless in practice, because a camera framing the
 * band area puts most of the pole outside the frame and the region with it.
 */
const TARGET_RADIUS_M = 0.17      // half-width of the collar, in metres
const TARGET_HEIGHT_M = 0.46      // its vertical extent

function StageTargetHighlight({ viewRef, region, hidden }) {
  const boxRef = useRef(null)
  const vec = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    if (!region) return undefined
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = boxRef.current
      const view = viewRef.current
      if (!el || !view || !view.target) return
      if (hidden) { el.style.opacity = '0'; return }
      const { camera, size } = view
      const tgt = view.target

      const toPx = (p) => ({
        x: (p.x * 0.5 + 0.5) * size.width,
        y: (-p.y * 0.5 + 0.5) * size.height,
      })
      const centre = vec.copy(tgt).project(camera).clone()
      if (centre.z > 1) { el.style.opacity = '0'; return }
      const top = vec.set(tgt.x, tgt.y + TARGET_HEIGHT_M / 2, tgt.z).project(camera).clone()
      const side = vec.set(tgt.x + TARGET_RADIUS_M, tgt.y, tgt.z).project(camera).clone()

      const c = toPx(centre)
      const h = Math.abs(toPx(top).y - c.y) * 2
      const w = Math.abs(toPx(side).x - c.x) * 2

      el.style.opacity = '1'
      el.style.width = `${Math.max(w, 18)}px`
      el.style.height = `${Math.max(h, 26)}px`
      el.style.transform = `translate(${c.x - Math.max(w, 18) / 2}px, ${c.y - Math.max(h, 26) / 2}px)`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [viewRef, region, hidden, vec])

  if (!region) return null
  return <div ref={boxRef} className="fm-target-highlight lp12-stage-target" aria-hidden="true" />
}

export default function LP12BuildCanvas(props) {
  // Written by CalloutBridge inside the Canvas, read by PartCallouts outside
  // it. A ref rather than state: it is updated every frame and nothing should
  // re-render because the camera moved.
  const calloutView = useRef(null)
  return (
    <div className="lp12-canvas-layer">
      {/* Outside the Canvas on purpose: this is an SVG, and everything inside
          <Canvas> is reconciled as three.js objects. Suppressed while a clip
          runs — a label on a part in mid-flight points at where it used to be. */}
      {/* Leader-line labels naming the hardware already on the pole.
          Suppressed on the assembly pages: the tray there deliberately shows
          unlabelled objects because recognising them is the assessment, and a
          label pointing at the part on the model gives away the answer to the
          step after it. */}
      <PartCallouts viewRef={calloutView}
                    modelRoot={props.modelRoot}
                    installed={props.installedParts}
                    hidden={Boolean(props.activeClip) || props.hideCallouts} />
      {/* Where this stage's component goes. Suppressed while a clip runs, for
          the same reason the callouts are: the part is in flight. */}
      <StageTargetHighlight viewRef={calloutView}
                            region={props.targetRegion}
                            hidden={Boolean(props.activeClip)} />
      <Canvas
        dpr={props.performanceTier === 'high' ? [1, 1.75] : 1}
        shadows={props.performanceTier === 'high'}
        // preserveDrawingBuffer keeps the frame readable after compositing.
        // Without it the canvas is blank to toDataURL and readPixels, so the
        // viewport cannot be captured — which is what the lighting was
        // calibrated against, and what any future frame export needs.
        gl={{ alpha: false, antialias: props.performanceTier === 'high',
              preserveDrawingBuffer: true,
              powerPreference: 'high-performance' }}
        camera={{ fov: 32, near: 0.05, far: 250 }}
        onCreated={({ gl }) => {
          // Render-brief Step 10. Cycles' AgX transform and the studio's
          // exposure do not travel with a GLB, so the equivalent has to be
          // rebuilt here or the browser view drifts away from the approved
          // Blender render. Exposure is 0.9, not the 1.05 it was: the previous
          // value lifted the whole image, which is the browser half of the
          // same washed-out fault corrected in the studio.
          gl.setClearColor(0xedece9, 1)
          gl.outputColorSpace = THREE.SRGBColorSpace
          // AgX, not the ACESFilmic the brief's snippet names.
          //
          // The brief's own acceptance test is that the GLB in the simulation
          // matches the approved Blender render, and those renders are AgX with
          // Medium High Contrast. ACES and AgX roll highlights off differently
          // and sit at different contrast, so running ACES here guarantees a
          // visible mismatch no matter how the lights are tuned - the browser
          // looked flat and hazy against the render for exactly this reason.
          // three r185 ships AgX, so the two ends can use the same transform.
          //
          // Exposure is 0.62, not 0.9: Blender's AgX view runs at -0.7 EV, and
          // 2^-0.7 = 0.62 is that same offset expressed as three's linear
          // multiplier.
          // Set from site_look.json by SiteLighting once the manifest loads.
          // These are the pre-manifest defaults, and they are AgX only so the
          // first frame is not blown out before the fetch resolves — the
          // Blender scene moved to Standard at -0.15 EV, and the comment above
          // describes a scene that no longer exists.
          gl.toneMapping = THREE.AgXToneMapping
          gl.toneMappingExposure = 0.62
          gl.shadowMap.enabled = true
          // The brief asks for PCFSoftShadowMap, but three r185 deprecates it
          // and silently coerces it to PCFShadowMap while warning on every
          // renderer creation — so writing the brief's literal value gets the
          // fallback plus console noise, not soft shadows. Setting the real
          // value is honest about what is running. Softness in this scene comes
          // from ContactShadows, not the shadow map: the ground plane was
          // removed, so the only shadow receivers are the model's own parts.
          gl.shadowMap.type = THREE.PCFShadowMap
        }}
      >
        {/* Separate Suspense boundaries, deliberately.
            These shared one boundary, which coupled the animation clock to the
            environment. drei's useAnimations advances the mixer from a
            useFrame subscription, so the clock only runs while LP12Assembly is
            mounted - and when <Environment> suspends, React tears down its
            sibling's effects too. The mixer then freezes mid-clip, the
            'finished' event never fires, and the stage button locks on
            "Installing…" permanently. Isolating them means the environment can
            suspend as often as it likes without stopping the assembly. */}
        <Suspense fallback={null}>
          {/* The Blender rig when the manifest is available, the hand-matched
              studio rig when it is not — so a missing or stale site_look.json
              degrades to the previous look rather than to an unlit scene. */}
          {props.look ? <SiteLighting look={props.look} /> : <StudioEnvironment />}
        </Suspense>
        {/* The site around the pole. Its own Suspense boundary for the same
            reason the others have one: a GLB suspending must never tear down
            the assembly's effects and freeze the animation mixer.

            Off for most of the workspace now. Specification 2.4 removes the
            city outright once the assembly starts — buildings, roads, cars and
            street furniture, not merely blurred — and the pole overview shows
            the street as a softened plate behind the model instead, so the
            only stages that still build the 3D city are the ones where the
            city is the point. */}
        {props.showEnvironment && (
          <Suspense fallback={null}>
            <SiteEnvironment />
          </Suspense>
        )}
        {/* Traffic is off, matching the Blender scene, which builds with
            INCLUDE_VEHICLES = False. SiteTraffic and the ten vehicle GLBs are
            left in place: putting the street back is re-adding this element
            and flipping that flag, and the vehicle library took long enough to
            build that deleting it over a staging decision would be wasteful.

            It stayed a separate Suspense boundary for a reason — ten vehicle
            GLBs suspend independently of the one environment GLB, and neither
            may take the assembly's mixer down with it. Keep that shape if it
            comes back. */}
        <Suspense fallback={null}>
          <LP12Assembly {...props} />
        </Suspense>
        {/* Publishes the camera to the DOM overlay below the Canvas. */}
        <CalloutBridge viewRef={calloutView} />
        <ScenePrecompile onCompiled={props.onCompiled} />
        <CameraDirector flow={props.flow} studio={props.studio}
                        stage={props.stage} cameraName={props.camera}
                        view={props.view} activeClip={props.activeClip}
                        modelRoot={props.modelRoot} orbitInput={props.orbitInput}
                        viewRef={calloutView}
                        domeRadiusM={COVERAGE_FRAME_STAGES.has(props.stage)
                          ? effectiveCoverageRadiusM(props.height, props.downtilt)
                          : 0} />
        {/* Amber active-component outline. One composer for the whole scene. */}
        {props.modelRoot && (
          <ComponentHighlight
            modelRoot={props.modelRoot}
            selectedNames={props.selectedNames}
            reducedMotion={props.reducedMotion}
          />
        )}
      </Canvas>
    </div>
  )
}
