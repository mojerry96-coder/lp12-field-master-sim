import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, Environment, Lightformer, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import { SkeletonUtils } from 'three-stdlib'
import { LP12_MODEL_URL, useSim } from '../store'
import { CLIP_ORDER } from '../lib/assemblyClips'
import { STATUS_ROWS, SENSOR_NODES } from './tuning-config'

/**
 * The live viewport: the installed LP12 inside a spherical coverage volume.
 *
 * Reuses the project's existing GLB through useGLTF, which is cached by URL —
 * the model is not downloaded or parsed a second time for this scene, and the
 * canvas stays mounted across all four pages so page changes never reload it.
 *
 * The coverage volume here is a SPHERE centred on the antenna. That is
 * deliberately not the ground-standing hemisphere the installation route uses:
 * this scene is about the reporter's radio behaviour rather than a ground
 * footprint, and it must never read as a directional cone. The GLB's own
 * hemisphere is hidden below for the same reason — two overlapping coverage
 * volumes would be incoherent.
 *
 * Framing is derived from the model's bounding box rather than hand-typed
 * camera coordinates, so the pole stays correctly framed base-to-cap whatever
 * mount height the learner left it at.
 */

/* --------------------------------------------------------------- shader */

const vert = /* glsl */`
  varying vec3 vLocal;
  varying vec3 vView;
  varying vec3 vNormalW;
  void main() {
    vLocal = position;                                   // unit sphere
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vNormalW = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`

/**
 * Every visible property of the shell is driven by one of the three values the
 * learner is tuning, so the sphere is a readout rather than decoration:
 *
 *   uRate     measurement interval — how fast the volume breathes
 *   uFlicker  hysteresis          — edge instability, fades out on target
 *   uSettle   time-to-trigger     — how far the shell has caught up
 */
const frag = /* glsl */`
  precision highp float;
  varying vec3 vLocal;
  varying vec3 vView;
  varying vec3 vNormalW;
  uniform vec3  uColor;
  uniform float uTime;
  uniform float uRate;
  uniform float uFlicker;
  uniform float uSettle;
  uniform float uOpacity;

  void main() {
    vec3 n = normalize(vNormalW);
    float facing = abs(dot(n, normalize(vView)));

    // Fresnel: the limb of the sphere is where a volume actually reads, so the
    // shell is nearly clear face-on and brightest at the silhouette. This is
    // what carries the shape — not banding. A double-sided sphere shows both
    // its near and far walls at once, so any contour strong enough to see
    // face-on is drawn twice and reads as a striped planet rather than a
    // volume of air, which is why the sweep below is kept very faint.
    float rim = pow(1.0 - facing, 2.6);

    // One soft sweep travelling down the volume, gated to the limb so it never
    // becomes a contour line across the middle of the shell.
    float lat   = clamp(vLocal.y * 0.5 + 0.5, 0.0, 1.0);
    float sweep = smoothstep(0.55, 1.0, sin((lat * 2.2 - uTime * uRate * 0.22) * 6.2831) * 0.5 + 0.5);
    sweep *= smoothstep(0.25, 0.85, 1.0 - facing);

    // Hysteresis instability: a fast, shallow tremor over the whole shell.
    float tremor = uFlicker * 0.5 * sin(uTime * 9.0 + lat * 18.0);

    float a = uOpacity * uSettle
            + rim * (0.40 + 0.16 * uSettle)
            + sweep * 0.05
            + tremor * 0.04;

    vec3 c = uColor + rim * 0.34 + sweep * 0.10;
    gl_FragColor = vec4(c, clamp(a, 0.0, 0.72));
  }
`

const DOME_COLOURS = {
  grey: new THREE.Color('#adbccb'),
  cyan: new THREE.Color('#7fd0d6'),
  green: new THREE.Color('#74c98c'),
  complete: new THREE.Color('#5fbf74'),
}

/**
 * Colour progression from the guide's table: an untuned volume is a neutral
 * grey, a partly tuned one is cyan, a fully optimised one is green. One
 * monotonic ramp, so the colour can only move forward as the learner works.
 */
function domeColour(d, out) {
  if (d.completed) return out.copy(DOME_COLOURS.complete)
  return d.progress < 0.5
    ? out.copy(DOME_COLOURS.grey).lerp(DOME_COLOURS.cyan, d.progress / 0.5)
    : out.copy(DOME_COLOURS.cyan).lerp(DOME_COLOURS.green, (d.progress - 0.5) / 0.5)
}

function CoverageSphere({ domeState, centre, radius }) {
  const mesh = useRef(null)
  const scratch = useMemo(() => new THREE.Color(), [])
  const settle = useRef(0)

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uColor: { value: DOME_COLOURS.grey.clone() },
      uTime: { value: 0 },
      uRate: { value: 1 },
      uFlicker: { value: 0 },
      uSettle: { value: 0 },
      uOpacity: { value: 0.1 },
    },
  }), [])

  useEffect(() => () => material.dispose(), [material])

  useFrame((state, dt) => {
    const u = material.uniforms
    u.uTime.value = state.clock.elapsedTime

    // Time-to-trigger is a delay, so it is expressed as the time constant of
    // the shell's approach to its settled size rather than as a size itself.
    const tau = Math.max(domeState.responseDelayMs / 1000, 0.1)
    settle.current += (1 - settle.current) * Math.min(dt / tau, 1)

    u.uRate.value = domeState.pulseHz
    u.uFlicker.value = domeState.edgeFlicker
    u.uSettle.value = settle.current
    u.uOpacity.value = domeState.completed ? 0.16 : 0.09 + domeState.quality * 0.05
    u.uColor.value.lerp(domeColour(domeState, scratch), Math.min(dt * 2.2, 1))

    const breathe = Math.sin(state.clock.elapsedTime * Math.PI * 2 * domeState.pulseHz)
    const amp = domeState.completed ? 0.010 : 0.016
    mesh.current?.scale.setScalar(radius * (1 + breathe * amp))
  })

  return (
    <mesh ref={mesh} position={centre} material={material} renderOrder={6}>
      <sphereGeometry args={[1, 64, 48]} />
    </mesh>
  )
}

/* ------------------------------------------------------------- overlays */

/**
 * Screen-space labels for 3D points — the LP12 chip and the reporter sample
 * points on the shell.
 *
 * drei's <Html> is not used here. It positions its children by converting a
 * projected point into pixels against the canvas's measured size, and this
 * canvas lives inside a CSS-transformed artboard: the same scale that already
 * shrank the canvas rect is applied a second time to the overlay, so every
 * label lands off its anchor. Projecting to PERCENTAGES sidesteps that
 * entirely — a percentage of the container is correct at any scale.
 *
 * The DOM nodes are rendered outside the Canvas by the viewport and reached
 * through a shared ref map, so this component only writes style on each frame
 * and never re-renders React.
 */
function LabelProjector({ anchors, labelRefs }) {
  const { camera } = useThree()
  const v = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    anchors.forEach((a) => {
      const el = labelRefs.current.get(a.id)
      if (!el) return
      v.set(a.position[0], a.position[1], a.position[2]).project(camera)
      // z > 1 means the point is behind the camera; projecting it would mirror
      // the label to the opposite side of the screen.
      if (v.z > 1) { el.style.opacity = '0'; return }
      el.style.opacity = '1'
      el.style.left = `${(v.x * 0.5 + 0.5) * 100}%`
      el.style.top = `${(-v.y * 0.5 + 0.5) * 100}%`
    })
  })

  return null
}

/**
 * World-space anchors for the screen labels: the antenna's identity chip, and
 * the reporter sample points spread over the coverage shell. The sample points
 * are placed in 3D rather than pinned to screen corners so they keep their
 * relationship to the volume as it breathes and as the camera frames it.
 */
function buildAnchors(centre, radius, antennaAt) {
  const nodes = SENSOR_NODES.map((n) => {
    const phi = THREE.MathUtils.degToRad(90 - n.elevation)
    const theta = THREE.MathUtils.degToRad(n.azimuth)
    const r = radius * n.radius
    return {
      id: n.id,
      kind: 'node',
      position: [
        centre[0] + r * Math.sin(phi) * Math.sin(theta),
        centre[1] + r * Math.cos(phi),
        centre[2] + r * Math.sin(phi) * Math.cos(theta),
      ],
    }
  })
  return [
    { id: 'LP12', kind: 'chip',
      position: [antennaAt.x + 0.55, antennaAt.y + 0.5, antennaAt.z] },
    ...nodes,
  ]
}

/* ---------------------------------------------------------------- model */

/**
 * The installed LP12, posed and framed.
 *
 * The GLB ships unassembled — every component sits at a rest offset until its
 * clip runs — so loading it and drawing it gives a bare pole. This scene is
 * downstream of a finished installation, so all six assembly clips are snapped
 * to their end pose once, on mount. That is the same treatment the install
 * route's applyClipEndPose gives a completed step, applied to the whole set.
 *
 * It runs on a CLONE of the cached scene, not the cached scene itself. useGLTF
 * hands every caller the same Object3D, and the install route keeps a live
 * mixer, staged visibility flags and rig transforms on it. Posing that shared
 * graph here would reach back into the other route. The clone shares geometry,
 * materials and textures — nothing is re-downloaded and no second GLB exists,
 * only a second node graph. The mixer is temporary: it exists to evaluate the
 * end poses, then it is released, so there is no animation cost per frame.
 */
function LP12Model({ domeState, onFramed }) {
  const { scene, animations } = useGLTF(LP12_MODEL_URL)
  const { gl } = useThree()
  const height = useSim((s) => s.height)
  const downtilt = useSim((s) => s.downtilt)

  const model = useMemo(() => {
    const root = SkeletonUtils.clone(scene)
    const maxAniso = gl.capabilities.getMaxAnisotropy()

    const mixer = new THREE.AnimationMixer(root)
    animations
      .filter((clip) => CLIP_ORDER.includes(clip.name))
      .forEach((clip) => {
        const action = mixer.clipAction(clip)
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
        action.play()
        action.time = clip.duration
      })
    // One update writes every clip's final frame into the transforms. The
    // actions are deliberately left playing: stopping an action restores the
    // original values through its property bindings, which springs every
    // component back to its unassembled rest pose — the same trap the install
    // route's controller documents. Nothing advances this mixer again, so the
    // written pose simply stands.
    mixer.update(0)

    const nodes = {}
    root.traverse((o) => {
      nodes[o.name] = o
      // Staged visibility belongs to the install route; here the build is done.
      o.visible = true
      if (o.isMesh) {
        o.castShadow = true
        o.receiveShadow = true
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        mats.forEach((m) => {
          if (!m || m.userData.__tunedTablet) return
          ;['map', 'roughnessMap', 'normalMap'].forEach((slot) => {
            if (m[slot] && m[slot].anisotropy !== maxAniso) {
              m[slot].anisotropy = maxAniso
              m[slot].needsUpdate = true
            }
          })
          m.userData.__tunedTablet = true
        })
      }
    })
    if (nodes.Coverage_Dome) nodes.Coverage_Dome.visible = false
    return { root, nodes }
  }, [scene, animations, gl])

  // Mount height and downtilt are the learner's own settings from the install,
  // so the tuning viewport shows the antenna exactly where they left it.
  const framing = useMemo(() => {
    const { root, nodes } = model
    if (nodes.Height_Rig) nodes.Height_Rig.position.y = THREE.MathUtils.clamp(height, 4, 12)
    if (nodes.Tilt_Rig) nodes.Tilt_Rig.rotation.x = -THREE.MathUtils.degToRad(downtilt)
    root.updateMatrixWorld(true)

    // Box3.setFromObject walks the whole graph, hidden branches included, so
    // the GLB's coverage hemisphere and any other non-hardware helper would
    // otherwise inflate the bounds and push the camera far too far back.
    const box = new THREE.Box3()
    const meshBox = new THREE.Box3()
    root.traverse((o) => {
      if (!o.isMesh || !o.visible) return
      let node = o
      let skip = false
      while (node && node !== root) {
        if (!node.visible || node.name === 'Coverage_Dome') { skip = true; break }
        node = node.parent
      }
      if (skip) return
      meshBox.setFromObject(o)
      box.union(meshBox)
    })
    const size = box.getSize(new THREE.Vector3())
    const antennaAt = new THREE.Vector3(0, size.y * 0.78, 0)
    if (nodes.Antenna_Body) nodes.Antenna_Body.getWorldPosition(antennaAt)

    return {
      height: size.y,
      centreY: (box.min.y + box.max.y) / 2,
      antenna: [antennaAt.x, antennaAt.y, antennaAt.z],
      // The volume is centred on the pole AXIS at the antenna's height, not on
      // the antenna's own centroid. The enclosure is bolted to one side of the
      // pole, so centring on it hangs the sphere visibly off to that side —
      // which would imply the coverage is skewed, when in fact it is not.
      centre: [0, antennaAt.y, 0],
      // Sized so its limb sits just inside a portrait viewport: enough of the
      // street is enclosed to read as a volume, without the edge leaving frame.
      radius: size.y * 0.30,
      anchors: buildAnchors([0, antennaAt.y, 0], size.y * 0.30, antennaAt),
    }
  }, [model, height, downtilt])

  useEffect(() => { onFramed(framing) }, [framing, onFramed])

  return (
    <>
      <primitive object={model.root} />
      <CoverageSphere domeState={domeState} centre={framing.centre} radius={framing.radius} />
    </>
  )
}

/**
 * Frames the model from its bounding box instead of fixed coordinates: the
 * mount height is a learner-set value, so a hard-coded camera would crop the
 * pole for anyone who left it at a different setting.
 */
function ViewportCamera({ framing }) {
  const { camera, size } = useThree()

  useEffect(() => {
    if (!framing) return
    const fov = 34
    const margin = 1.05
    const vFov = THREE.MathUtils.degToRad(fov)
    const aspect = size.width / size.height

    // Distance that fits the model's height, and the distance that fits the
    // coverage sphere's width — whichever is further back wins.
    const forHeight = (framing.height * margin) / 2 / Math.tan(vFov / 2)
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
    const forWidth = (framing.radius * 2 * margin) / 2 / Math.tan(hFov / 2)
    const dist = Math.max(forHeight, forWidth)

    const azimuth = THREE.MathUtils.degToRad(34)
    const pitch = THREE.MathUtils.degToRad(6)
    const target = new THREE.Vector3(0, framing.centreY + framing.height * 0.06, 0)

    camera.position.set(
      target.x + dist * Math.cos(pitch) * Math.sin(azimuth),
      target.y + dist * Math.sin(pitch),
      target.z + dist * Math.cos(pitch) * Math.cos(azimuth),
    )
    camera.lookAt(target)
    camera.fov = fov
    camera.aspect = aspect
    camera.near = 0.1
    camera.far = dist * 4
    camera.updateProjectionMatrix()
  }, [camera, framing, size.width, size.height])

  return null
}

/* --------------------------------------------------------------- status */

function StatusCard({ step }) {
  const rows = STATUS_ROWS[step] || STATUS_ROWS.interval
  const [, headValue, headTone] = rows[0]
  return (
    <div className="lp12-status-card">
      <div className="lp12-status-head">
        <span>Status</span>
        <b className={`lp12-status-pill${headTone === 'green' ? ' is-green' : ''}`}>{headValue}</b>
        <span className="lp12-status-chevron" aria-hidden="true">›</span>
      </div>
      <div className="lp12-status-rows">
        {rows.slice(1).map(([label, value, tone]) => (
          <div className="lp12-status-row" key={label}>
            <span>{label}</span>
            <b><i className={tone === 'amber' ? 'is-amber' : ''} />{value}</b>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function LP12LiveViewport({ step, domeState, performanceTier = 'high' }) {
  const [framing, setFraming] = useState(null)
  const labelRefs = useRef(new Map())
  const anchors = framing?.anchors ?? []

  return (
    <div className="lp12-live-viewport">
      {/* Defocused site plate. The pole is composited over the street it was
          installed on, which is what puts the coverage volume somewhere real
          rather than over a flat swatch. */}
      <img className="lp12-viewport-plate" src="/assets/lp12/site-backdrop.jpg"
           alt="" aria-hidden="true" draggable={false} />

      <Canvas
        className="lp12-viewport-canvas"
        dpr={performanceTier === 'high' ? [1, 1.75] : 1}
        shadows={performanceTier === 'high'}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 34, near: 0.1, far: 200 }}
        onCreated={({ gl }) => {
          gl.setClearAlpha(0)
          gl.outputColorSpace = THREE.SRGBColorSpace
          gl.toneMapping = THREE.AgXToneMapping
          gl.toneMappingExposure = 0.82
          gl.shadowMap.enabled = true
          gl.shadowMap.type = THREE.PCFShadowMap
        }}
      >
        <ViewportCamera framing={framing} />
        <Environment resolution={128} frames={1} background={false}>
          <Lightformer form="rect" intensity={0.55} color="#ffffff"
                       position={[0, 14, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[24, 24, 1]} />
          <Lightformer form="rect" intensity={1.35} color="#fffdf8"
                       position={[8, 10, 8]} rotation={[-Math.PI / 4, Math.PI / 5, 0]} scale={[9, 9, 1]} />
        </Environment>
        <directionalLight castShadow position={[9, 13, 9]} intensity={2.1} color="#fffdf8"
                          shadow-mapSize-width={1024} shadow-mapSize-height={1024}
                          shadow-camera-near={0.5} shadow-camera-far={60}
                          shadow-camera-left={-12} shadow-camera-right={12}
                          shadow-camera-top={18} shadow-camera-bottom={-18} />
        <directionalLight position={[-8, 6, 5]} intensity={0.5} color="#eef4ff" />
        <ContactShadows position={[0, 0.01, 0]} scale={12} opacity={0.3} blur={2.4}
                        far={5} resolution={512} />
        <Suspense fallback={null}>
          <LP12Model domeState={domeState} onFramed={setFraming} />
        </Suspense>
        <LabelProjector anchors={anchors} labelRefs={labelRefs} />
      </Canvas>

      {/* Labels live outside the Canvas so they are ordinary DOM the browser
          lays out and the page can style; LabelProjector only moves them. */}
      <div className="lp12-scene-labels" aria-hidden="true">
        {anchors.map((a) => (
          <span
            key={a.id}
            ref={(el) => {
              if (el) labelRefs.current.set(a.id, el)
              else labelRefs.current.delete(a.id)
            }}
            className={a.kind === 'chip' ? 'lp12-scene-chip' : 'lp12-sensor-node'}
          >
            {a.id}
          </span>
        ))}
      </div>

      <StatusCard step={step} />

      <h1 className="lp12-viewport-title">LP12 Network<br />Tuning</h1>

      <div className="lp12-viewport-meta">
        Lagos, Ikeja<br />
        Good coverage
        <span className="lp12-meta-bars" aria-hidden="true">
          <i style={{ height: 7 }} /><i style={{ height: 9 }} />
          <i style={{ height: 11 }} /><i style={{ height: 13 }} />
        </span>
      </div>
    </div>
  )
}
