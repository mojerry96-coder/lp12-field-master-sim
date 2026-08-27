import { Suspense, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { SkeletonUtils } from 'three-stdlib'
import { LP12_MODEL_URL, useSim } from '../store'
import { CLIP_ORDER } from '../lib/assemblyClips'
import SiteEnvironment from '../components/SiteEnvironment'
import { calculateTestQuality, corridorReach, faultPoints } from './networkTestQuality'

/**
 * The network test, in 3D.
 *
 * Everything the learner sees here is derived from the five values they chose:
 * the dome's size and where it sits, how far down the corridor the probe stays
 * healthy, and where the trail breaks. Nothing is baked (section 49) — the
 * geometry has to change when the settings do, which is the entire argument
 * for the page existing.
 *
 * The scene is the real Awolowo Way environment and the real LP12, not a
 * background plate. Both GLBs are already in the cache by the time the learner
 * reaches the tuning sequence, so this costs a second node graph and no second
 * download.
 */

const BLUE = '#4DA3FF'
const BLUE_HOT = '#C9EEFF'
const WARN = '#FFCA45'
const FAIL = '#FF5C57'

/* Test length, and the beats inside it. The specification asks for 9-12
   seconds and names 10 as the default build. */
export const TEST_DURATION_MS = 10_000

/* ------------------------------------------------------------------ model */

/**
 * The installed LP12, at the height and tilt the learner set.
 *
 * The GLB ships unassembled — every component sits at a rest offset until its
 * clip runs — so all six assembly clips are snapped to their end pose once, on
 * mount, on a CLONE of the cached scene. The clone matters: useGLTF hands
 * every caller the same Object3D, and posing the shared graph would reach back
 * into the install route. The actions are left playing on purpose; stopping one
 * restores its original values through the property bindings and springs the
 * whole assembly back apart.
 */
function InstalledLP12({ height, downtilt }) {
  const { scene, animations } = useGLTF(LP12_MODEL_URL)

  const root = useMemo(() => {
    const clone = SkeletonUtils.clone(scene)
    const mixer = new THREE.AnimationMixer(clone)
    animations
      .filter((clip) => CLIP_ORDER.includes(clip.name))
      .forEach((clip) => {
        const action = mixer.clipAction(clip)
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
        action.play()
        action.time = clip.duration
      })
    mixer.update(0)
    clone.traverse((o) => {
      o.visible = true
      if (o.name === 'Coverage_Dome') o.visible = false
    })
    return clone
  }, [scene, animations])

  // The learner's own rig, applied to the clone. Section 1.4: changing these
  // must change what the test shows. A layout effect rather than a memo — this
  // writes transforms onto a graph, it does not compute a value — and before
  // paint, so the first rendered frame is already at the learner's settings.
  useLayoutEffect(() => {
    const rigY = root.getObjectByName('Height_Rig')
    const rigTilt = root.getObjectByName('Tilt_Rig')
    if (rigY) rigY.position.y = THREE.MathUtils.clamp(height, 4, 12)
    if (rigTilt) rigTilt.rotation.x = -THREE.MathUtils.degToRad(downtilt)
    root.updateMatrixWorld(true)
  }, [root, height, downtilt])

  return <primitive object={root} />
}

/* ------------------------------------------------------------------- dome */

/**
 * How big the footprint draws, in scene units.
 *
 * Not metres. The real figure is height / tan(tilt), which at 7.5 m and 5
 * degrees is 85 m — a dome so much larger than the block that the camera would
 * have to stand off far enough to lose the pole entirely, and the learner would
 * be watching a blue wall rather than a cell. So the radius is a legible range
 * that still moves with the physical decisions, and the camera is placed just
 * outside its largest value.
 */
const domeRadius = (quality) => THREE.MathUtils.lerp(19, 33, quality.physical)

function CoverageDome({ quality, height, downtilt, reducedMotion }) {
  const mesh = useRef()
  const material = useRef()

  // Radius follows the physical decisions; a well-sited cell reaches further.
  const radius = domeRadius(quality)
  // Downtilt throws the footprint forward down the corridor, which runs +X.
  const forwardShift = THREE.MathUtils.clamp(downtilt, 0, 10) * 1.9

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    // Layer 1: breathing. Pressure, not a bounce.
    const breathe = reducedMotion ? 1
      : 1 + Math.sin((t * Math.PI * 2) / 1.9) * 0.015
    if (mesh.current) mesh.current.scale.set(breathe, breathe * 0.62, breathe)
    // Layer 2: opacity, synchronised with the shell.
    if (material.current) {
      material.current.opacity = reducedMotion ? 0.135
        : THREE.MathUtils.lerp(0.105, 0.165, (Math.sin(t * 3.3) + 1) / 2)
    }
  })

  return (
    <mesh ref={mesh} position={[forwardShift, height * 0.12, 0]}>
      <sphereGeometry args={[radius, 72, 44, 0, Math.PI * 2, 0, Math.PI / 2]} />
      <meshPhysicalMaterial
        ref={material}
        color={BLUE}
        transparent
        opacity={0.14}
        roughness={0.12}
        metalness={0}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

/* --------------------------------------------------- transmission rings */

function SignalRing({ index, count, radius, reducedMotion }) {
  const ref = useRef()
  const material = useRef()

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    const speed = reducedMotion ? 0.16 : 0.36
    const progress = ((t * speed + index / count) % 1)
    const s = THREE.MathUtils.lerp(0.08, radius, progress)
    if (ref.current) ref.current.scale.setScalar(s)
    // Fades out as it travels, so the eye reads outward motion rather than a
    // set of static circles.
    if (material.current) material.current.opacity = (1 - progress) * 0.5
  })

  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.96, 1, 96]} />
      <meshBasicMaterial
        ref={material}
        color={BLUE_HOT}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

function TransmissionWaves({ height, radius, reducedMotion }) {
  return (
    <group position={[0, height, 0]}>
      {Array.from({ length: 7 }).map((_, i) => (
        <SignalRing key={i} index={i} count={7} radius={radius}
                    reducedMotion={reducedMotion} />
      ))}
    </group>
  )
}

/* ---------------------------------------------------------- the corridor */

/**
 * The route the test signal drives, laid down the carriageway.
 *
 * Awolowo Way runs along world X in the environment GLB, with the LP12's pole
 * at the origin on the kerb — so the corridor runs along X and sits a few units
 * off in +Z to keep it in the near lane rather than on the median.
 */
function useCorridorCurve() {
  return useMemo(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(-30, 0.2, 4.4),
    new THREE.Vector3(-12, 0.2, 3.9),
    new THREE.Vector3(6, 0.2, 3.4),
    new THREE.Vector3(26, 0.2, 3.0),
    new THREE.Vector3(48, 0.2, 2.6),
  ]), [])
}

/**
 * The tested route, behind the probe.
 *
 * Coloured per segment from the learner's own settings: blue where the link
 * held, amber past the point the footprint stops reaching, red at the faults
 * the tuning produced. A correct configuration paints one clean blue line —
 * which is the only way "correct" is communicated here (section 24).
 */
function CorridorTrail({ curve, progress, quality }) {
  const SEGMENTS = 120
  const RADIAL = 8
  const reach = corridorReach(quality)
  const faults = faultPoints(quality)

  /* A tube, not a line. WebGL caps `linewidth` at one device pixel on every
     desktop driver, and the environment's carriageway is itself a saturated
     blue — a hairline over it is not something a learner can read, and this
     trail is the page's main piece of teaching. */
  const geometry = useMemo(() => {
    const g = new THREE.TubeGeometry(curve, SEGMENTS, 0.55, RADIAL, false)
    g.setAttribute('color', new THREE.BufferAttribute(
      new Float32Array(g.getAttribute('position').count * 3), 3,
    ))
    return g
  }, [curve])

  useFrame(() => {
    const colour = geometry.getAttribute('color')
    const healthy = new THREE.Color(BLUE_HOT)
    const warn = new THREE.Color(WARN)
    const fail = new THREE.Color(FAIL)
    // Muted slate, not near-black: the road under it is already a saturated
    // blue, and a dark tube on top of it reads as a trench cut into the
    // carriageway rather than as route the probe has not driven yet.
    const untested = new THREE.Color('#8098B2')

    for (let i = 0; i <= SEGMENTS; i += 1) {
      const t = i / SEGMENTS
      let c = untested
      if (t <= progress) {
        const nearFault = faults.some((f) => Math.abs(t - f) < 0.035)
        if (nearFault) c = fail
        else if (t > reach) c = warn
        else c = healthy
      }
      // TubeGeometry lays out one ring of RADIAL+1 vertices per segment.
      for (let j = 0; j <= RADIAL; j += 1) {
        colour.setXYZ(i * (RADIAL + 1) + j, c.r, c.g, c.b)
      }
    }
    colour.needsUpdate = true
  })

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial vertexColors toneMapped={false} />
    </mesh>
  )
}

/**
 * The travelling test signal.
 *
 * It stalls briefly at each fault rather than gliding through, because an
 * interruption the learner cannot see is not being taught.
 */
function TestProbe({ curve, progress, quality }) {
  const group = useRef()
  const faults = faultPoints(quality)
  const reach = corridorReach(quality)

  useFrame(({ clock }) => {
    if (!group.current) return
    const p = THREE.MathUtils.clamp(progress, 0, 1)
    const point = curve.getPoint(p)
    group.current.position.copy(point)

    const nearFault = faults.some((f) => Math.abs(p - f) < 0.03)
    const weak = p > reach
    // Flicker at a fault, dim past the end of the footprint, steady otherwise.
    const flicker = nearFault
      ? 0.25 + Math.abs(Math.sin(clock.getElapsedTime() * 22)) * 0.75
      : weak ? 0.55 : 1
    group.current.scale.setScalar(flicker)
    group.current.visible = p > 0.001
  })

  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[0.42, 20, 20]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>
      <mesh scale={2.1}>
        <sphereGeometry args={[0.42, 20, 20]} />
        <meshBasicMaterial color={BLUE} transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <pointLight color={BLUE} intensity={3} distance={11} />
    </group>
  )
}

/* ----------------------------------------------------------------- camera */

/**
 * Nearly imperceptible drift. The specification is explicit that the network
 * animation should provide the motion and the camera should not compete, and
 * that the learner cannot steer while the test runs — this is an explainer.
 */
/* Above the rooftops, not merely back from the pole. Standing off at street
   level to clear the dome puts the camera inside the next block of the
   environment GLB and the shot fills with a wall. */
const CAMERA_HOME = new THREE.Vector3(-34, 52, 38)

function TestCamera({ reducedMotion }) {
  useFrame(({ camera, clock }) => {
    const t = clock.getElapsedTime()
    const drift = reducedMotion ? 0 : 1
    camera.position.lerp(new THREE.Vector3(
      CAMERA_HOME.x + Math.sin(t * 0.17) * 1.1 * drift,
      CAMERA_HOME.y,
      CAMERA_HOME.z + Math.cos(t * 0.14) * 0.8 * drift,
    ), 0.018)
    camera.lookAt(2, 1, 2)
  })
  return null
}

/* ------------------------------------------------------------------ scene */

export default function NetworkTestViewport({ settings, progress }) {
  const reducedMotion = useSim((s) => s.reducedMotion)
  const quality = useMemo(() => calculateTestQuality(settings), [settings])
  const curve = useCorridorCurve()
  const antennaHeight = THREE.MathUtils.clamp(settings.mountHeight, 4, 12)

  return (
    <Canvas
      className="network-test-canvas"
      dpr={[1, 1.75]}
      camera={{ fov: 46, near: 0.1, far: 400, position: [-34, 52, 38] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={['#9fc4e4']} />
      <fog attach="fog" args={['#b9d3e9', 70, 260]} />

      <hemisphereLight intensity={1.5} color="#eaf4ff" groundColor="#8a8377" />
      <directionalLight intensity={2.1} color="#fff6e8" position={[18, 30, 16]} />
      <directionalLight intensity={0.5} color="#cfe4ff" position={[-14, 12, -18]} />

      <Suspense fallback={null}>
        <SiteEnvironment />
      </Suspense>
      <Suspense fallback={null}>
        <InstalledLP12 height={settings.mountHeight} downtilt={settings.downtilt} />
      </Suspense>

      <CoverageDome quality={quality} height={antennaHeight}
                    downtilt={settings.downtilt} reducedMotion={reducedMotion} />
      <TransmissionWaves height={antennaHeight} radius={domeRadius(quality)}
                         reducedMotion={reducedMotion} />

      <CorridorTrail curve={curve} progress={progress} quality={quality} />
      <TestProbe curve={curve} progress={progress} quality={quality} />

      <TestCamera reducedMotion={reducedMotion} />
    </Canvas>
  )
}
