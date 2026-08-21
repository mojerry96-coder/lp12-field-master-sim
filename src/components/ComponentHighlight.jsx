import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Amber highlight for the component currently being worked on.
 *
 * Deliberately NOT post-processing. The `Outline` effect requires an
 * EffectComposer, and mounting one renders the whole scene into an offscreen
 * target — which bypasses the canvas MSAA and softens the entire model. It also
 * never composited correctly over the transparent canvas (silhouette pixels sit
 * against alpha-0 background).
 *
 * Instead each selected mesh gets a back-face shell sharing its geometry,
 * slightly inflated. It renders as a clean amber rim, costs one extra draw per
 * selected mesh, needs no render target, and leaves the model perfectly sharp.
 */
const AMBER = 0xffb000
const INFLATE = 1.02

export default function ComponentHighlight({
  modelRoot, selectedNames = [], reducedMotion = false, enabled = true,
}) {
  const shellsRef = useRef([])

  const targets = useMemo(() => {
    if (!modelRoot || !enabled) return []
    const out = []
    selectedNames.forEach((n) => {
      const o = modelRoot.getObjectByName(n)
      if (!o) return
      o.traverse((c) => { if (c.isMesh && c.visible) out.push(c) })
    })
    return out
  }, [modelRoot, selectedNames, enabled])

  useEffect(() => {
    const shells = targets.map((src) => {
      const mat = new THREE.MeshBasicMaterial({
        color: AMBER,
        side: THREE.BackSide,      // only the rim shows past the source mesh
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,         // keep the amber exact under tone mapping
      })
      const shell = new THREE.Mesh(src.geometry, mat)
      shell.name = '__highlight_shell'
      shell.scale.setScalar(INFLATE)
      // Draw the shell BEFORE its source so the part paints over it and only
      // the inflated rim survives. Drawing it after covers the whole part.
      shell.renderOrder = -1
      shell.raycast = () => {}     // never intercept clicks
      src.add(shell)
      return { shell, mat }
    })
    shellsRef.current = shells
    return () => {
      shells.forEach(({ shell, mat }) => {
        shell.parent?.remove(shell)
        mat.dispose()              // geometry is shared, so only the material
      })
      shellsRef.current = []
    }
  }, [targets])

  useFrame(({ clock }) => {
    const shells = shellsRef.current
    if (!shells.length) return
    const pulse = reducedMotion ? 0.92 : 0.78 + Math.sin(clock.elapsedTime * 2.5) * 0.17
    for (let i = 0; i < shells.length; i++) shells[i].mat.opacity = pulse
  })

  return null
}
