import { useCallback, useEffect, useState } from 'react'
import {
  useSim, selectShowHotspot, selectShowCanvas, selectFocusBackground,
  selectControlsEnabled,
} from './store'
import BackgroundPlate from './components/BackgroundPlate'
import ResponsiveLP12Hotspot from './components/Hotspot'
import NetworkCoverageDome from './components/NetworkCoverageDome'
import LP12BuildCanvas from './components/LP12BuildCanvas'
import InstallationPage from './InstallationPage'
import LP12TabletTuningScene from './tuning/LP12TabletTuningScene'
import CanvasDimLayer from './components/CanvasDimLayer'
import TargetCursor from './components/TargetCursor'
import { STAGE_CONFIG, detectPerformanceTier, prefersReducedMotion } from './lib/stageConfig'
import MivaOpener from './components/MivaOpener'
import MissionBriefing from './components/MissionBriefing'
import StageGate from './components/StageGate'
import CompletionScreen, { PerformanceReview } from './components/CompletionScreen'
import { P2, P3, warm } from './lib/preloader'
import { urlFor } from './lib/assetManifest'

// The locate page is the isometric city rendered straight out of the Blender
// scene (CAM_ENV_ISOMETRIC), not the aerial photograph. It is the same
// geometry the build canvas loads, so the site the learner picks on the map is
// literally the site they then work on.
//
// No video plate here: the render is a still, and a photographic loop under a
// low-poly render read as two different scenes stitched together.
// Through the manifest, so the locate page and the completion screen ask for
// the identical URL and share one decode.
const BACKGROUND_URL = urlFor('iso-background')
const BACKGROUND_VIDEO_URL = null

/**
 * Where "Return to Course" goes, if anywhere.
 *
 * Read from a build-time variable rather than assumed. The brief is explicit
 * that a broken or placeholder route is worse than no button, so when this is
 * unset the action is not rendered at all.
 */
const COURSE_URL = import.meta.env.VITE_COURSE_URL || null

export default function App() {
  const s = useSim()
  const [flow, setFlow] = useState(null)
  const [studio, setStudio] = useState(null)

  const showHotspot = selectShowHotspot(s)
  const showCanvas = selectShowCanvas(s)
  const focusBackground = selectFocusBackground(s)
  const controlsEnabled = selectControlsEnabled(s)

  const [reviewOpen, setReviewOpen] = useState(false)

  /**
   * Staged preloading.
   *
   * P1 is loaded by the opener itself. P2 starts the moment the first scene is
   * interactive, so the studio is already built by the time the hotspot is
   * clicked; P3 starts once the learner is in the build, so the tablet opens
   * as a finished composition rather than assembling itself.
   */
  useEffect(() => {
    if (!s.openerDone) return undefined
    const id = setTimeout(() => warm(P2), 0)
    return () => clearTimeout(id)
  }, [s.openerDone])

  useEffect(() => {
    if (s.mode !== 'build') return undefined
    const id = setTimeout(() => warm(P3), 0)
    return () => clearTimeout(id)
  }, [s.mode])

  useEffect(() => {
    fetch('/models/camera_studio.json').then((r) => r.json()).then(setStudio).catch(() => {})
    fetch('/models/camera_flow.json').then((r) => r.json()).then(setFlow)
      .catch((e) => useSim.getState().setLoadError('camera_flow.json failed: ' + e))
    useSim.getState().setEnvironment(detectPerformanceTier(), prefersReducedMotion())
  }, [])

  const onModelReady = useCallback((extras, root, controller) => {
    if (extras) {
      const keys = ['mount_height_min','mount_height_max','mount_height_step',
        'mount_height_correct_min','mount_height_correct_max',
        'mount_height_ideal','downtilt_correct']
      const l = {}
      keys.forEach((k) => { if (typeof extras[k] === 'number') l[k] = extras[k] })
      if (Object.keys(l).length) useSim.getState().setLimits(l)
    }
    const st = useSim.getState()
    st.setController(controller)
    st.setModelReady(true, root)
    st.restoreCompletedPoses()      // s34: resume without replaying
  }, [])

  // Stable identities: these feed CameraDirector's effect deps. Inline arrows
  // made the effect re-fire every render, which set state and re-rendered —
  // an infinite loop that starved the render loop and blanked the canvas.
  const onRigMoved = useCallback(() => useSim.getState().bumpRig(), [])
  const onCameraDepart = useCallback(() => useSim.getState().setCameraStatus('moving'), [])
  const onCameraArrive = useCallback(() => useSim.getState().setCameraStatus('idle'), [])

  const onModelError = useCallback((msg) => {
    useSim.getState().setLoadError(msg)
    useSim.getState().setModelReady(false)
  }, [])

  const cfg = STAGE_CONFIG[s.buildStage] ?? STAGE_CONFIG.inspect
  const dimOpacity = s.mode === 'locate' ? 0 : cfg.dimOpacity

  // The opener owns the screen until it hands over. It preloads P1 while it
  // plays, so this is not three seconds spent, it is three seconds used.
  // Opener, then the briefing, then the site. Both sit in front of the
  // simulation while P1 and P2 warm behind them, so the explanation costs the
  // learner nothing — it happens during loading that was going to happen.
  if (!s.openerDone) {
    return (
      <MivaOpener
        reducedMotion={s.reducedMotion}
        // Replays on restart, but skippable then — a learner going round again
        // should not have to sit through the titles.
        skippable={Boolean(s.result)}
        onDone={useSim.getState().openerFinished}
      />
    )
  }

  if (!s.briefingDone) {
    return (
      <MissionBriefing
        reducedMotion={s.reducedMotion}
        onDone={useSim.getState().briefingFinished}
      />
    )
  }

  if (s.mode === 'complete') {
    return (
      <>
        <CompletionScreen
          onReview={() => setReviewOpen(true)}
          onRestart={useSim.getState().restart}
          onReturnToCourse={COURSE_URL ? () => { window.location.href = COURSE_URL } : null}
        />
        {reviewOpen && <PerformanceReview onClose={() => setReviewOpen(false)} />}
      </>
    )
  }

  return (
    <main className={`hybrid-simulation mode-${s.mode}`}>
      <BackgroundPlate
        imageSrc={BACKGROUND_URL}
        videoSrc={BACKGROUND_VIDEO_URL}
        focused={focusBackground}
        reducedMotion={s.reducedMotion}
        onLoad={useSim.getState().setBgReady}
      />
      <div className="background-focus-overlay" aria-hidden="true" />


      <CanvasDimLayer opacity={dimOpacity} />

      {/* Coverage footprint on the network plate. Rendered under the marker,
          and only in the network view — inside the build view the same dome is
          shown in 3D at the coverage stage instead. */}
      {showHotspot && s.bgReady && (
        <NetworkCoverageDome height={s.height} downtilt={s.downtilt} />
      )}

      {showHotspot && s.bgReady && (
        <ResponsiveLP12Hotspot
          disabled={s.transitionLocked}
          completed={s.installed && s.heightOk() && s.tiltOk()}
          onActivate={s.openBuild}
        />
      )}

      {/* Buttons only. Gated on reduced motion: the idle cursor spins
          continuously, which is exactly the kind of persistent motion
          prefers-reduced-motion asks us to drop — and the component has no
          prop to disable it, so we fall back to the native cursor. */}
      {!s.reducedMotion && (
        <TargetCursor
          targetSelector=".cursor-target"
          spinDuration={3}
          hoverDuration={0.18}
          parallaxOn
          hideDefaultCursor
          cursorColor="#35e0d0"
          cursorColorOnTarget="#f0a63c"
        />
      )}

      {/* The tablet tuning sequence replaces the installation workspace once
          the physical build is signed off. It is a separate mode rather than a
          nested view so the installation route keeps its own state untouched
          and can be returned to unchanged. */}
      {s.mode === 'tuning' ? (
        <StageGate name="Network tuning" priority={P3}
                   onRetreat={() => useSim.getState().returnToSite()}>
        <LP12TabletTuningScene
          onExit={() => {
            // Tuning is the last task, so finishing it ends the simulation.
            // finish() freezes the outcome before anything can reset it — the
            // completion screen and the review both read that snapshot.
            useSim.getState().finish()
          }}
        />
        </StageGate>
      ) : showCanvas && (
        // The installation stage is held until the LP12 GLB is parsed, its
        // materials are built and its shaders are compiled — `modelReady` is
        // set by the canvas, not on mount, so this cannot reveal an empty
        // studio the way clicking the hotspot early used to.
        <StageGate name="Installation workspace" priority={P2}
                   ready={s.modelReady}
                   onRetreat={() => useSim.getState().returnToSite()}>
          <InstallationPage
            studio={studio} flow={flow}
            onExit={() => useSim.getState().returnToSite()}
            onComplete={() => useSim.getState().startTuning()}
          />
        </StageGate>
      )}

      <div className="sr-live" aria-live="polite">
        {s.mode === 'build' ? 'LP12 model opened' : ''}
      </div>

      {s.loadError && (
        <div className="error-panel" role="alert">
          <b>Could not load the LP12 model.</b>
          <p>{s.loadError}</p>
          <button className="ghost" onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}
    </main>
  )
}
