import { Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { LP12_MODEL_URL } from '../store'
import {
  mapCoverPointToContainer, ISO_SOURCE_SIZE, ISO_LP12_GROUND_ANCHOR,
  ISO_VIEW_ELEVATION_DEG, ISO_METRES_PER_PIXEL,
} from '../lib/plateAnchor'
import { effectiveCoverageRadiusM } from '../lib/coverage'

/**
 * The cell's coverage footprint, drawn over the aerial plate around the LP12
 * marker.
 *
 * This renders the SAME `Coverage_Dome` mesh the installation viewport uses,
 * cloned out of the GLB, rather than a lookalike built in three.js. There is
 * one dome in the project and it comes from Blender; a second, hand-rolled
 * hemisphere would be free to drift in shape, colour and radius from the one
 * the learner just saw in the 3D scene.
 *
 * The canvas covers the whole layer and the dome is positioned within it,
 * rather than the canvas being sized to the dome. Sizing to the dome meant a
 * near-horizontal beam — the default downtilt of 0, which clamps to 250 m —
 * produced a 2657 px-square canvas at 3985 px device resolution. Covering the
 * layer instead bounds the cost at viewport size, and a footprint larger than
 * the plate then clips at the edge of the view, which is the honest reading:
 * the coverage really does run off the frame.
 *
 * Scale: the radius is real metres from lib/coverage.js, converted to plate
 * pixels by ISO_METRES_PER_PIXEL — which is not an estimate. It comes out of
 * the isometric camera's own ortho_scale, and the derivation is checked by
 * projecting the LP12's world anchor and landing on the recorded plate anchor.
 * See plateAnchor.js.
 *
 * This used to be pinned to the OLD aerial plate — a different image, a
 * different anchor, a different camera elevation and a metres-per-pixel
 * estimated off the carriageway width — while the page behind it had long
 * since become the isometric render. The dome was drawn confidently in the
 * wrong place. Everything here now refers to the plate actually on screen.
 */

/** World units are CSS pixels: ortho zoom stays 1 and the dome scales in px. */
function DomeScene({
  radiusPx, offsetPx, elevationDeg, tint = null, pulse = false,
  baseOpacity = 0.24, reducedMotion = false,
}) {
  const { scene } = useGLTF(LP12_MODEL_URL)
  const { camera, size } = useThree()
  const group = useRef(null)

  // The clone and the materials the pulse writes to come out of one memo, so
  // nothing is assigned to a ref during render.
  const { dome, materials } = useMemo(() => {
    const src = scene.getObjectByName('Coverage_Dome')
    if (!src) return { dome: null, materials: [] }
    const clone = src.clone(true)
    clone.visible = true
    clone.position.set(0, 0, 0)
    clone.rotation.set(0, 0, 0)
    const mats = []
    clone.traverse((o) => {
      if (!o.isMesh) return
      o.material = o.material.clone()
      o.material.transparent = true
      o.material.opacity = baseOpacity
      o.material.depthWrite = false
      o.material.side = THREE.DoubleSide
      o.renderOrder = 2
      // Recolouring the shared dome rather than modelling a second one: the
      // dead zone and the coverage it becomes are the same volume in the same
      // place, and only their meaning differs.
      if (tint) {
        o.material.color = new THREE.Color(tint)
        if (o.material.emissive) o.material.emissive = new THREE.Color(tint)
      }
      mats.push(o.material)
    })
    return { dome: clone, materials: mats }
  }, [scene, tint, baseOpacity])

  /**
   * The pulse.
   *
   * Slow, and in both scale and opacity together, so it reads as a volume
   * under pressure rather than a blinking warning light. A dead zone is a
   * standing condition, not an alarm — if it flashed, the page would feel like
   * something is going wrong right now instead of something being wrong here.
   */
  useFrame(({ clock }) => {
    if (!pulse || reducedMotion) return
    const t = clock.getElapsedTime()
    const phase = Math.sin((t * Math.PI * 2) / 2.4)
    if (group.current) {
      const s = 1 + phase * 0.02
      group.current.scale.setScalar(radiusPx * s)
    }
    const o = baseOpacity + phase * 0.07
    materials.forEach((m) => { m.opacity = o })
  })

  // Aim an oblique camera at the origin, then slide it in its own screen plane
  // so the origin lands on the marker rather than the middle of the canvas.
  useFrame(() => {
    const el = (elevationDeg * Math.PI) / 180
    const dist = Math.max(size.width, size.height) * 2 + radiusPx * 2
    const dir = new THREE.Vector3(0, Math.sin(el), Math.cos(el)).normalize()
    camera.position.copy(dir).multiplyScalar(dist)
    camera.up.set(0, 1, 0)
    camera.lookAt(0, 0, 0)
    const right = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), camera.position).normalize(),
      camera.up).normalize()
    const up = new THREE.Vector3().crossVectors(right,
      new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), camera.position).normalize())
      .normalize()
    camera.position.addScaledVector(right, -offsetPx.x)
    camera.position.addScaledVector(up, offsetPx.y)
    camera.updateMatrixWorld()
  })

  if (!dome) return null
  return <primitive ref={group} object={dome} scale={radiusPx} />
}

/**
 * Where on the plate the dome's centre lands, and how big a source pixel is.
 *
 * Shared because both domes answer the same question about the same picture;
 * they differ only in which plate they are pinned to and what they mean.
 */
function usePlateGeometry(sourceSize, anchor) {
  const layerRef = useRef(null)
  const [geom, setGeom] = useState(null)

  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer) return undefined
    const update = () => {
      const b = layer.getBoundingClientRect()
      if (!b.width || !b.height) return
      const p = mapCoverPointToContainer(
        { width: b.width, height: b.height }, sourceSize, anchor)
      const scale = Math.max(b.width / sourceSize.width,
                             b.height / sourceSize.height)
      setGeom({
        w: b.width, h: b.height, scale,
        // Offset of the marker from the canvas centre, in CSS pixels.
        dx: p.left - b.width / 2,
        dy: p.top - b.height / 2,
      })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(layer)
    return () => ro.disconnect()
  }, [sourceSize, anchor])

  return [layerRef, geom]
}

function DomeLayer({ layerRef, geom, radiusPx, elevationDeg, ...rest }) {
  const show = geom && radiusPx > 2
  return (
    <div ref={layerRef} className="coverage-dome-layer" aria-hidden="true">
      {show && (
        <Canvas
          orthographic
          dpr={1}
          gl={{ alpha: true, antialias: true }}
          camera={{ zoom: 1, near: 1, far: 200000, position: [0, 0, 1000] }}
        >
          <ambientLight intensity={1.5} />
          <directionalLight position={[0.4, 1, 0.6]} intensity={0.7} />
          <Suspense fallback={null}>
            <DomeScene radiusPx={radiusPx} offsetPx={{ x: geom.dx, y: geom.dy }}
                       elevationDeg={elevationDeg} {...rest} />
          </Suspense>
        </Canvas>
      )}
    </div>
  )
}

export default function NetworkCoverageDome({ height, downtilt, visible = true }) {
  // The ground anchor, for the reason the dead zone uses it: a hemisphere hung
  // off the mount point floats with its flat face in mid-air.
  const [layerRef, geom] = usePlateGeometry(ISO_SOURCE_SIZE, ISO_LP12_GROUND_ANCHOR)
  const radiusM = effectiveCoverageRadiusM(height, downtilt)
  const radiusPx = geom ? (radiusM / ISO_METRES_PER_PIXEL) * geom.scale : 0

  return (
    <DomeLayer layerRef={layerRef} geom={visible ? geom : null}
               radiusPx={radiusPx} elevationDeg={ISO_VIEW_ELEVATION_DEG} />
  )
}

/**
 * The dead zone, over the pole on the isometric plate.
 *
 * SCALE. In metres, against the isometric camera's own ortho_scale. The
 * earlier objection to drawing a dead zone on this plate at all was that the
 * render carried no surveyed scale, so a polygon over it claimed a footprint
 * nobody measured. site_look.json turns out to record the camera, so the plate
 * does have a scale and the objection no longer holds.
 *
 * ANCHOR. The ground anchor, not the mount point: a hemisphere hung off the
 * antenna floats above the road with its flat face in mid-air, where one
 * centred at the foot of the column sits on the street the way a real
 * propagation volume does.
 */
/* In metres, like the coverage dome, now that the plate has a scale that came
   out of the camera rather than a guess. 28 m is the size this was accepted at
   when it was expressed in plate pixels — a volume around this junction rather
   than a wash over the district, big enough to be a zone and small enough that
   the pole at its centre stays the thing the learner is looking for. */
const DEAD_ZONE_RADIUS_M = 28

export function DeadZoneDome({ visible = true, reducedMotion = false }) {
  const [layerRef, geom] = usePlateGeometry(ISO_SOURCE_SIZE, ISO_LP12_GROUND_ANCHOR)
  const radiusPx = geom ? (DEAD_ZONE_RADIUS_M / ISO_METRES_PER_PIXEL) * geom.scale : 0

  return (
    <DomeLayer
      layerRef={layerRef}
      geom={visible ? geom : null}
      radiusPx={radiusPx}
      elevationDeg={ISO_VIEW_ELEVATION_DEG}
      tint="#FF3B30"
      baseOpacity={0.22}
      pulse
      reducedMotion={reducedMotion}
    />
  )
}
