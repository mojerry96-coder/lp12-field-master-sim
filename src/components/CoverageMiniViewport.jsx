import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import SiteEnvironment from './SiteEnvironment'
import { coverageRadiusM } from '../lib/coverage'

/**
 * Live coverage preview — Page 12 only.
 *
 * A real 3D view of the footprint standing over the site, not a diagram of
 * one. Section 2.7 is explicit that this is state-driven rather than
 * prerecorded, and the honest way to show a volume changing shape is to render
 * the volume: the same low-poly Awolowo Way the coverage page uses, with the
 * cell's hemisphere over it, both redrawn every frame from the height and tilt
 * the learner currently has dialled in.
 *
 * The radius comes from `coverageRadiusM` — height / tan(tilt) — which is the
 * same function the full-scene dome and the network map read, so the preview
 * cannot tell the learner something the other two surfaces would contradict.
 * Too little tilt throws the beam outward until it swallows the whole
 * neighbourhood; too much pulls it into a puddle around the pole; the target
 * is the one that covers the corridor and stops.
 *
 * Its own canvas rather than a corner of the main one: the main viewport is
 * framed on the hinge at arm's length, and the only way to show a 250 m
 * footprint in the same shot would be to give up the mechanical view this page
 * exists for.
 */

/* The site is about 180 m across, and the footprint runs from roughly 43 m at
   10 degrees to the 250 m clamp near zero. The camera frames the larger of the
   two so the dome never leaves the frame — watching it grow past the edge
   would read as "no change" exactly when the change is largest. */
const SITE_EXTENT_M = 180
const CAMERA_ELEVATION = 0.62      // fraction of the framed distance, upward
const CAMERA_AZIMUTH = -0.72       // radians, so the boulevard runs across

function Dome({ radiusRef }) {
  const mesh = useRef(null)
  // One unit hemisphere, scaled per frame. Rebuilding geometry on every tilt
  // step would allocate a new buffer sixty times a second.
  const geometry = useMemo(
    () => new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2),
    [],
  )

  useFrame(() => {
    const m = mesh.current
    if (!m) return
    const r = radiusRef.current
    // Eased rather than snapped: the learner is dragging, and a footprint that
    // jumps between steps reads as a slideshow of states rather than one
    // volume responding. But a single degree near zero moves the reach by more
    // than a hundred metres, and easing across that at a fixed rate takes long
    // enough that the panel looks unresponsive — so a large jump is taken in
    // one step and only the small ones are smoothed.
    const target = new THREE.Vector3(r, r * 0.52, r)
    const jump = Math.abs(target.x - m.scale.x) > Math.max(8, target.x * 0.45)
    if (jump) m.scale.copy(target)
    else m.scale.lerp(target, 0.3)
  })

  return (
    <group ref={mesh} position={[0, 0.2, 0]}>
      <mesh geometry={geometry} renderOrder={2}>
        <meshBasicMaterial
          color="#2E86FF"
          transparent
          opacity={0.3}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* A wire shell over the fill. A translucent solid at this size reads as
          a colour wash on the city; the lat/long lines are what make it a
          volume with a near and a far side. */}
      <mesh geometry={geometry} renderOrder={3}>
        <meshBasicMaterial color="#0A6BE8" wireframe transparent opacity={0.18}
                           depthWrite={false} />
      </mesh>
    </group>
  )
}

function Rig({ radiusRef }) {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#e6ecf5', 2.4]} />
      <directionalLight position={[60, 120, 40]} intensity={1.5} />
      <Suspense fallback={null}>
        <SiteEnvironment />
      </Suspense>
      <Dome radiusRef={radiusRef} />
    </>
  )
}

export default function CoverageMiniViewport({ heightM, tiltDeg, aligned, leaving }) {
  const radiusM = coverageRadiusM(heightM, tiltDeg)
  // Read in the frame loop rather than passed as a prop, so a drag re-renders
  // nothing inside the canvas.
  const radiusRef = useRef(radiusM)
  radiusRef.current = radiusM

  // Capped as well as floored. Without the cap, a 250 m footprint pushes the
  // camera so far back that the city shrinks to a patch and the dome — now
  // comfortably inside the frame — reads as "nothing happened", which is the
  // opposite of what a beam thrown too far should look like. Capped, it spills
  // past the edges, which is exactly the complaint.
  const framed = Math.min(300, Math.max(SITE_EXTENT_M, radiusM * 2.1))
  const camera = useMemo(() => ({
    position: [
      Math.sin(CAMERA_AZIMUTH) * framed * 0.9,
      framed * CAMERA_ELEVATION,
      Math.cos(CAMERA_AZIMUTH) * framed * 0.9,
    ],
    fov: 34,
    near: 1,
    far: framed * 6,
  }), [framed])

  return (
    <aside
      className={`fm-glass cmv${aligned ? ' is-aligned' : ''}${leaving ? ' is-leaving' : ''}`}
      aria-label="Coverage preview"
    >
      <p className="fm-eyebrow cmv-title">Coverage preview</p>

      <div className="cmv-stage">
        <Canvas
          className="cmv-canvas"
          dpr={1}
          gl={{ alpha: true, antialias: false, powerPreference: 'low-power' }}
          camera={camera}
          onCreated={({ gl, camera: cam }) => {
            gl.setClearColor(0x000000, 0)
            cam.lookAt(0, 0, 0)
          }}
        >
          <Rig radiusRef={radiusRef} />
        </Canvas>

        {/* The number the shape is showing. Without it the panel says
            "different", not "how different". */}
        <span className="cmv-reach">{Math.round(radiusM)} m</span>
      </div>

      <p className="cmv-aligned" role="status" aria-live="polite">
        {aligned ? 'Coverage aligned' : ''}
      </p>
    </aside>
  )
}
