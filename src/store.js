import { create } from 'zustand'

export const LP12_MODEL_URL = '/models/lp12_v2.glb'

/** Shell mode wraps the existing build sequence; it does not replace it. */
export const MODES = ['locate', 'opening', 'build', 'complete', 'tuning']
// Stage list and clip contract live in one place (spec s24/s25).
export { BUILD_STAGES, OBJECTIVES } from './lib/assemblyClips'
import { BUILD_STAGES, ASSEMBLY_CLIPS, NEXT_STAGE, CLIP_ORDER } from './lib/assemblyClips'


const INITIAL_BUILD = {
  buildStage: 'inspectPole',
  animationStatus: 'idle',      // idle | preparing | playing | finished | error
  activeClip: null,
  completedClips: [],
  controlsLocked: false,
  animationError: null,
  installed: false,
  height: 7.5,
  downtilt: 0,
}

export const useSim = create((set, get) => ({
  mode: 'locate',
  modelReady: false,
  transitionLocked: false,
  cameraStatus: 'idle',        // 'idle' | 'moving' — gates task controls
  rigRevision: 0,              // bumps when a rig moves, so focus re-resolves
  modelRoot: null,
  performanceTier: 'high',
  reducedMotion: false,
  bgReady: false,
  loadError: null,
  ...INITIAL_BUILD,
  controller: null,             // survives restart; owns the GLB mixer

  limits: {
    mount_height_min: 4, mount_height_max: 12, mount_height_step: 0.5,
    mount_height_correct_min: 7, mount_height_correct_max: 8,
    mount_height_ideal: 7.5, downtilt_correct: 5,
  },
  setLimits: (l) => set({ limits: { ...get().limits, ...l } }),
  setBgReady: () => set({ bgReady: true }),
  setModelReady: (v = true, modelRoot = null) =>
    set(modelRoot ? { modelReady: v, modelRoot } : { modelReady: v }),
  setCameraStatus: (cameraStatus) => set({ cameraStatus }),
  bumpRig: () => set({ rigRevision: get().rigRevision + 1 }),
  setEnvironment: (performanceTier, reducedMotion) =>
    set({ performanceTier, reducedMotion }),
  setLoadError: (loadError) => set({ loadError }),

  /**
   * Hotspot activation: locate -> opening -> build. Guarded against repeats.
   *
   * Readiness is proven by awaiting the asset itself rather than waiting for
   * the canvas subtree to report back. The earlier handshake deadlocked: the
   * canvas only mounts once mode leaves 'locate', so gating the mode change on
   * a signal that can only come from the canvas is circular. Suspense covers
   * the remaining decode, and the canvas fades in over the blurred backdrop.
   */
  openBuild: async () => {
    const { transitionLocked, mode } = get()
    if (transitionLocked || mode !== 'locate') return
    set({ transitionLocked: true, mode: 'opening', loadError: null })
    try {
      const res = await fetch(LP12_MODEL_URL, { cache: 'force-cache' })
      if (!res.ok) throw new Error(`${LP12_MODEL_URL} responded ${res.status}`)
      await res.arrayBuffer()
      set({ mode: 'build', buildStage: get().buildStage || 'inspectPole' })
    } catch (err) {
      console.error('[LP12] opening transition failed:', err)
      set({ mode: 'locate', loadError: String(err.message || err) })
    } finally {
      set({ transitionLocked: false })
    }
  },

  nextStage: () => {
    const i = BUILD_STAGES.indexOf(get().buildStage)
    if (i < BUILD_STAGES.length - 1) {
      const nextStage = BUILD_STAGES[i + 1]
      set({ buildStage: nextStage, mode: nextStage === 'complete' ? 'complete' : 'build' })
    }
  },
  prevStage: () => {
    const i = BUILD_STAGES.indexOf(get().buildStage)
    if (i > 0) set({ buildStage: BUILD_STAGES[i - 1], mode: 'build' })
  },

  install: () => set({ installed: true }),
  setHeight: (height) => set({ height }),
  setDowntilt: (downtilt) => set({ downtilt }),

  /** Keeps completion data — only Restart clears it. */
  returnToSite: () => set({ mode: 'locate' }),

  /**
   * Physical installation is finished; hand over to the tablet tuning sequence.
   *
   * A mode rather than a new route, matching how 'build' and 'complete' already
   * work here, so the installation state stays exactly where it is and the
   * learner can be returned to it untouched.
   */
  startTuning: () => set({ mode: 'tuning', installed: true }),
  setController: (controller) => set({ controller }),

  /**
   * One assembly action. Rejects duplicate input, locks controls for the whole
   * playback, holds the completed pose, then advances (spec s29).
   */
  runAssemblyStage: async (stage) => {
    const { controller, controlsLocked, animationStatus, reducedMotion } = get()
    const clip = ASSEMBLY_CLIPS[stage]
    if (!clip) return
    if (controlsLocked || animationStatus === 'playing') return   // duplicate input
    if (!controller) {
      set({ animationStatus: 'error', animationError: 'Animation controller not ready' })
      return
    }

    set({ animationStatus: 'preparing', activeClip: clip, controlsLocked: true,
          animationError: null })
    try {
      // s37: reduced motion shortens the clip rather than removing the
      // installation feedback entirely.
      await controller.playOnce(clip, { timeScale: reducedMotion ? 2 : 1 })
      const completed = get().completedClips.includes(clip)
        ? get().completedClips
        : [...get().completedClips, clip]
      set({
        animationStatus: 'finished',
        completedClips: completed,
        activeClip: null,
        controlsLocked: false,
        buildStage: NEXT_STAGE[stage] || get().buildStage,
      })
    } catch (err) {
      // s36: do not advance, do not teleport the part into place.
      console.error('[LP12] assembly clip failed:', err)
      set({ animationStatus: 'error', controlsLocked: false, activeClip: null,
            animationError: String(err.message || err) })
    }
  },

  /** Re-apply completed clips in manifest order without replaying them (s34). */
  restoreCompletedPoses: () => {
    const { controller, completedClips } = get()
    if (!controller) return
    CLIP_ORDER.filter((c) => completedClips.includes(c))
              .forEach((c) => controller.applyClipEndPose(c))
  },

  restart: () => {
    // s35: return the model to the unassembled rest state. The controller
    // itself is deliberately preserved — it owns the GLB's mixer.
    get().controller?.resetAll()
    set({ ...INITIAL_BUILD, mode: 'locate', loadError: null })
  },

  heightOk: () => {
    const { height, limits } = get()
    return height >= limits.mount_height_correct_min && height <= limits.mount_height_correct_max
  },
  tiltOk: () => get().downtilt === get().limits.downtilt_correct,
}))

/** Derived display state — no competing booleans (brief: Recommended shell state). */
export const selectShowHotspot = (s) => s.mode === 'locate'
export const selectShowCanvas = (s) => s.mode !== 'locate'
export const selectFocusBackground = (s) => s.mode !== 'locate'
export const selectControlsEnabled = (s) =>
  (s.mode === 'build' || s.mode === 'complete') && s.modelReady

// Dev-only handle. The tuning sequence sits behind a full physical install, so
// without this there is no way to reach it — or re-check it after an edit —
// short of replaying every stage. Stripped from production builds.
if (import.meta.env.DEV) globalThis.__lp12 = useSim
