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

// The locate page is the isometric city rendered straight out of the Blender
// scene (CAM_ENV_ISOMETRIC), not the aerial photograph. It is the same
// geometry the build canvas loads, so the site the learner picks on the map is
// literally the site they then work on.
//
// No video plate here: the render is a still, and a photographic loop under a
// low-poly render read as two different scenes stitched together.
const BACKGROUND_URL = '/city-isometric.jpg'
const BACKGROUND_VIDEO_URL = null

export default function App() {
  const s = useSim()
  const [flow, setFlow] = useState(null)
  const [studio, setStudio] = useState(null)

  const showHotspot = selectShowHotspot(s)
  const showCanvas = selectShowCanvas(s)
  const focusBackground = selectFocusBackground(s)
  const controlsEnabled = selectControlsEnabled(s)

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

      {false && showCanvas && (
        <LP12BuildCanvas
          flow={flow}
          studio={studio}
          stage={s.buildStage}
          height={s.height}
          downtilt={s.downtilt}
          stage={s.buildStage}
          completedClips={s.completedClips}
          activeClip={s.activeClip}
          onReady={onModelReady}
          onError={onModelError}
          modelRoot={s.modelRoot}
          selectedNames={cfg.selected}
          focusNodeName={cfg.focusNode}
          focusMode={cfg.focusMode}
          performanceTier={s.performanceTier}
          reducedMotion={s.reducedMotion}
          rigRevision={s.rigRevision}
        />
      )}

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
        <LP12TabletTuningScene
          onExit={() => {
            // Corridor test is the next scene in the sequence; until it exists
            // the learner returns to the network view rather than to assembly.
            useSim.getState().returnToSite()
          }}
        />
      ) : showCanvas && (
        <InstallationPage
          studio={studio} flow={flow}
          onExit={() => useSim.getState().returnToSite()}
          onComplete={() => useSim.getState().startTuning()}
        />
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
