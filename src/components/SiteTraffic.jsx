import { useEffect, useMemo, useRef, useState } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  VEHICLE_ASSETS, VEHICLE_PLACEMENTS_URL, VEHICLE_VARIANTS, lodForDistance,
} from '../lib/vehicleAssets'

/**
 * The traffic standing in the environment, brief sections 21 and 24.
 *
 * Each of the ten vehicle types is fetched once and cloned per instance. The
 * clones share geometry and materials with their source, so 36 vehicles cost
 * ten downloads and ten sets of GPU buffers.
 *
 * Positions come from vehicle_placements.json, exported from the same Blender
 * scene that produced the meshes, already rebased on LP12_INSTALL_ANCHOR and
 * converted to Y-up. Nothing here computes a transform — if a vehicle is in the
 * wrong place, the fix belongs in the export.
 */

const LOD_SUFFIX = ['_ROOT', '_LOD1', '_LOD2']

function pickLodNode(scene, type, level) {
  const want = type + LOD_SUFFIX[level]
  let found = null
  scene.traverse((o) => {
    if (!found && o.name === want) found = o
  })
  return found
}

/**
 * One vehicle. Holds all three LOD nodes and toggles visibility rather than
 * swapping geometry: a swap allocates, and this runs every frame.
 */
function Vehicle({ type, source, position, rotationY, variant }) {
  const group = useRef(null)
  const level = useRef(-1)

  const nodes = useMemo(() => {
    const clone = source.clone(true)
    const byLevel = [0, 1, 2].map((l) => pickLodNode(clone, type, l))
    // A vehicle with no LOD1/LOD2 falls back to LOD0 rather than vanishing.
    const lod0 = byLevel[0] || clone
    const resolved = byLevel.map((n) => n || lod0)

    if (variant && VEHICLE_VARIANTS[variant]) {
      const colour = new THREE.Color(VEHICLE_VARIANTS[variant])
      const seen = new Set()
      clone.traverse((o) => {
        if (!o.isMesh) return
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        o.material = mats.map((m) => {
          if (!m || !m.name.includes('OFFWHITE')) return m
          // Clone the material once per vehicle so recolouring one does not
          // recolour every vehicle sharing the source.
          if (!seen.has(m.uuid)) seen.add(m.uuid)
          const c = m.clone()
          c.color = colour
          return c
        })
        if (o.material.length === 1) [o.material] = o.material
      })
    }

    clone.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false
        o.receiveShadow = false
      }
    })
    return { clone, resolved }
  }, [source, type, variant])

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const d = state.camera.position.distanceTo(g.position)
    const next = lodForDistance(d)
    if (next === level.current) return
    level.current = next
    nodes.resolved.forEach((n, i) => { n.visible = i === next })
  })

  return (
    <group ref={group} position={position} rotation={[0, rotationY, 0]}>
      <primitive object={nodes.clone} />
    </group>
  )
}

export default function SiteTraffic({ visible = true }) {
  const [placements, setPlacements] = useState(null)
  const { invalidate } = useThree()

  useEffect(() => {
    let cancelled = false
    fetch(VEHICLE_PLACEMENTS_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then((d) => { if (!cancelled) { setPlacements(d.placements || []); invalidate?.() } })
      .catch((e) => console.warn('[traffic] placements unavailable:', e.message))
    return () => { cancelled = true }
  }, [invalidate])

  // Every asset is loaded unconditionally: the hook order has to be stable, and
  // all ten types appear in the placement list anyway.
  const types = Object.keys(VEHICLE_ASSETS)
  const loaded = types.map((t) => useGLTF(VEHICLE_ASSETS[t]))
  const sources = useMemo(
    () => Object.fromEntries(types.map((t, i) => [t, loaded[i].scene])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded],
  )

  if (!placements) return null

  return (
    <group visible={visible}>
      {placements.map((p, i) => {
        const source = sources[p.type]
        if (!source) return null
        return (
          <Vehicle
            key={`${p.type}-${i}`}
            type={p.type}
            source={source}
            position={p.position}
            rotationY={p.rotationY}
            variant={p.variant}
          />
        )
      })}
    </group>
  )
}

Object.values(VEHICLE_ASSETS).forEach((url) => useGLTF.preload(url))
