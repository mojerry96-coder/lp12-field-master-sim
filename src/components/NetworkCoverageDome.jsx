import { Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { LP12_MODEL_URL } from '../store'
import { mapCoverPointToContainer } from './Hotspot'
import {
  effectiveCoverageRadiusM, MAP_METRES_PER_PIXEL, MAP_SOURCE_SIZE,
  MAP_LP12_ANCHOR, MAP_VIEW_ELEVATION_DEG,
} from '../lib/coverage'

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
 * Scale honesty: the radius is real metres from lib/coverage.js, converted to
 * pixels by MAP_METRES_PER_PIXEL — an estimate off the carriageway width, and
 * the weakest number in the chain. The dome's size on the street is indicative,
 * not surveyed.
 */

/** World units are CSS pixels: ortho zoom stays 1 and the dome scales in px. */
function DomeScene({ radiusPx, offsetPx }) {
  const { scene } = useGLTF(LP12_MODEL_URL)
  const { camera, size } = useThree()

  const dome = useMemo(() => {
    const src = scene.getObjectByName('Coverage_Dome')
    if (!src) return null
    const clone = src.clone(true)
    clone.visible = true
    clone.position.set(0, 0, 0)
    clone.rotation.set(0, 0, 0)
    clone.traverse((o) => {
      if (!o.isMesh) return
      o.material = o.material.clone()
      o.material.transparent = true
      o.material.opacity = 0.24
      o.material.depthWrite = false
      o.material.side = THREE.DoubleSide
      o.renderOrder = 2
    })
    return clone
  }, [scene])

  // Aim an oblique camera at the origin, then slide it in its own screen plane
  // so the origin lands on the marker rather than the middle of the canvas.
  useFrame(() => {
    const el = (MAP_VIEW_ELEVATION_DEG * Math.PI) / 180
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
  return <primitive object={dome} scale={radiusPx} />
}

export default function NetworkCoverageDome({ height, downtilt, visible = true }) {
  const layerRef = useRef(null)
  const [geom, setGeom] = useState(null)

  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    const update = () => {
      const b = layer.getBoundingClientRect()
      if (!b.width || !b.height) return
      const p = mapCoverPointToContainer(
        { width: b.width, height: b.height }, MAP_SOURCE_SIZE, MAP_LP12_ANCHOR)
      const scale = Math.max(b.width / MAP_SOURCE_SIZE.width,
                             b.height / MAP_SOURCE_SIZE.height)
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
  }, [])

  const radiusM = effectiveCoverageRadiusM(height, downtilt)
  const radiusPx = geom ? (radiusM / MAP_METRES_PER_PIXEL) * geom.scale : 0
  const show = visible && geom && radiusPx > 2

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
            <DomeScene radiusPx={radiusPx} offsetPx={{ x: geom.dx, y: geom.dy }} />
          </Suspense>
        </Canvas>
      )}
    </div>
  )
}
