import { urlFor } from './lib/assetManifest'
import { create } from 'zustand'

// Via the manifest so the loader cache is guaranteed to hit: five call sites
// ask for this model, and any of them spelling the path differently would
// download and parse a second 1.5 MB copy.
export const LP12_MODEL_URL = urlFor('lp12')

/** Shell mode wraps the existing build sequence; it does not replace it. */
export const MODES = ['locate', 'opening', 'build', 'complete', 'tuning']
// Stage list and clip contract live in one place (spec s24/s25).
export { BUILD_STAGES, OBJECTIVES } from './lib/assemblyClips'
import { BUILD_STAGES, ASSEMBLY_CLIPS, NEXT_STAGE, CLIP_ORDER } from './lib/assemblyClips'
import { INITIAL_TUNING, isOnTarget } from './tuning/tuning-config'

/** Scoring weights. One place, so the completion screen cannot restate them. */
export const WRONG_ATTEMPT_PENALTY = 5
export const RIG_PENALTY = 15
export const TUNING_PENALTY = 10
export const INCOMPLETE_PENALTY = 40
export const PASS_MARK = 70


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
  openerDone: false,           // the MIVA opener has handed over
  briefingDone: false,         // the typed mission briefing has been read
  startedAt: null,             // set when the learner first opens the build
  wrongAttempts: 0,            // parts fitted out of order, for the review
  completedStages: [],         // stage titles, in the order they were finished
  result: null,                // frozen snapshot, survives restart for review

  /**
   * The three reporter decisions, and where the learner is in making them.
   *
   * These live here rather than in the tuning scene because the network test
   * can send the learner back to the pole to change mount height or downtilt,
   * and that excursion switches mode and unmounts the scene. Component state
   * would not survive the trip, and the learner would come back to find their
   * reporter settings reset to the entry values.
   */
  tuning: { ...INITIAL_TUNING },
  tuningStep: 'interval',
  /* Set while the learner is correcting one decision the test flagged. It
     names where to return to, so a correction goes straight back to the
     corridor rather than walking the whole sequence again. */
  revisit: null,
  networkTest: null,           // last corridor verdict, for the review

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
    set({ transitionLocked: true, mode: 'opening', loadError: null,
         startedAt: get().startedAt || Date.now() })
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

  openerFinished: () => set({ openerDone: true }),
  briefingFinished: () => set({ briefingDone: true }),

  /**
   * Which installation stage is on screen.
   *
   * Owned by InstallationPage, mirrored here because App renders the city
   * plate and has to know when to take it away: Page 04 inspects the pole with
   * the street still behind it, and everything from Page 05 to the downtilt is
   * isolated (specification 2.4 / 4). Without this the plate could only be
   * switched on `mode`, which does not change between those pages.
   */
  installStage: 'overview',
  setInstallStage: (installStage) => set({ installStage }),
  noteWrongAttempt: () => set((st) => ({ wrongAttempts: st.wrongAttempts + 1 })),
  noteStageComplete: (title) => set((st) => (
    st.completedStages.includes(title)
      ? st
      : { completedStages: [...st.completedStages, title] })),

  /**
   * Freeze the outcome. Called once when the simulation finishes, so the
   * completion screen and the review read a stable snapshot rather than live
   * state that restart is about to clear.
   *
   * Scoring: every refused drag or click already increments wrongAttempts, and
   * it now costs points. Without a penalty the tray could be brute-forced —
   * try all six and the correct one installs — which is exactly the behaviour
   * the ordering rule exists to discourage.
   */
  finish: () => {
    const st = get()
    const heightOk = st.heightOk()
    const tiltOk = st.tiltOk()
    const penalties = []
    if (st.wrongAttempts > 0) {
      penalties.push({
        k: `Incorrect part attempts (${st.wrongAttempts} x ${WRONG_ATTEMPT_PENALTY})`,
        points: st.wrongAttempts * WRONG_ATTEMPT_PENALTY,
      })
    }
    if (!heightOk) penalties.push({ k: 'Mount height outside target', points: RIG_PENALTY })
    if (!tiltOk) penalties.push({ k: 'Downtilt outside target', points: RIG_PENALTY })
    // Nothing in the sequence refuses a wrong reporter value any more — the
    // corridor test is what judges them, and this is where that judgement
    // costs something. Scored one decision at a time so the review can name
    // which dial was left wrong rather than marking "tuning" as a whole.
    const tuningOk = st.tuningOk()
    if (!tuningOk.interval) {
      penalties.push({ k: 'Measurement interval outside target', points: TUNING_PENALTY })
    }
    if (!tuningOk.hysteresis) {
      penalties.push({ k: 'Hysteresis outside target', points: TUNING_PENALTY })
    }
    if (!tuningOk.timeToTrigger) {
      penalties.push({ k: 'Time-to-trigger outside target', points: TUNING_PENALTY })
    }
    if (!st.installed) penalties.push({ k: 'Installation incomplete', points: INCOMPLETE_PENALTY })
    const lost = penalties.reduce((n, p) => n + p.points, 0)
    const score = Math.max(0, 100 - lost)

    const result = {
      version: 2,
      installed: st.installed,
      height: st.height,
      downtilt: st.downtilt,
      heightOk,
      tiltOk,
      tuning: { ...st.tuning },
      tuningOk,
      networkTest: st.networkTest,
      wrongAttempts: st.wrongAttempts,
      wrongAttemptPenalty: st.wrongAttempts * WRONG_ATTEMPT_PENALTY,
      penalties,
      score,
      passMark: PASS_MARK,
      completedStages: st.completedStages,
      durationMs: st.startedAt ? Date.now() - st.startedAt : null,
      finishedAt: new Date().toISOString(),
    }
    try {
      // Small and versioned. No images, GLBs or textures go in here — this is
      // a handful of numbers describing one attempt.
      localStorage.setItem('lp12.result.v2', JSON.stringify(result))
    } catch { /* private mode, quota: the in-memory copy still works */ }
    set({ result, mode: 'complete' })
  },

  restart: () => {
    // s35: return the model to the unassembled rest state. The controller
    // itself is deliberately preserved — it owns the GLB's mixer, and
    // rebuilding it would mean re-parsing the GLB.
    //
    // Nothing here touches the asset caches. That is the point: a restart
    // resets the attempt, not the download. No page reload either — a reload
    // would drop the parsed GLBs, the decoded images and the compiled shaders
    // and make the second run slower than the first.
    //
    // `result` is deliberately kept so the review is still readable after a
    // restart, and openerDone is cleared so the opener replays (skippable).
    get().controller?.resetAll()
    set({
      ...INITIAL_BUILD,
      mode: 'locate',
      loadError: null,
      openerDone: false,
      briefingDone: false,
      installStage: 'overview',
      startedAt: null,
      wrongAttempts: 0,
      completedStages: [],
      tuning: { ...INITIAL_TUNING },
      tuningStep: 'interval',
      revisit: null,
      networkTest: null,
    })
  },

  setTuning: (patch) => set({ tuning: { ...get().tuning, ...patch } }),
  setTuningStep: (tuningStep) => set({ tuningStep }),
  noteNetworkTest: (networkTest) => set({ networkTest }),

  /**
   * Send the learner back to one decision the corridor test faulted.
   *
   * Nothing is reset on the way: they arrive at the control holding the value
   * they chose, because the point is to reconsider a specific choice, not to
   * start the phase again. `revisit` remembers that the corridor is what they
   * came from, so confirming returns them straight to it.
   */
  reviseRig: (which) =>
    set({ revisit: which, mode: 'build', installStage: which }),
  reviseTuning: (step) =>
    set({ revisit: step, mode: 'tuning', tuningStep: step }),
  resumeFromRevision: () =>
    set({ revisit: null, mode: 'tuning', tuningStep: 'networkTest' }),

  heightOk: () => {
    const { height, limits } = get()
    return height >= limits.mount_height_correct_min && height <= limits.mount_height_correct_max
  },
  tiltOk: () => get().downtilt === get().limits.downtilt_correct,
  /** The three reporter decisions, each judged on its own. */
  tuningOk: () => {
    const { tuning } = get()
    return {
      interval: isOnTarget('interval', tuning),
      hysteresis: isOnTarget('hysteresis', tuning),
      timeToTrigger: isOnTarget('timeToTrigger', tuning),
    }
  },
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