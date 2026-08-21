import { useMemo } from 'react'
import * as THREE from 'three'
import { Autofocus, EffectComposer, Outline } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'

/** Outline needs real meshes: a rig node like Height_Rig is an empty group. */
export function collectMeshes(root) {
  const out = []
  root.traverse((c) => { if (c.isMesh) out.push(c) })
  return out
}

/**
 * One EffectComposer for the whole scene (brief rule 4). Amber outline always;
 * depth of field only on close work stages and only on the high tier.
 */
export default function SceneEffects({
  modelRoot, selectedNames, focusNodeName, focusMode,
  performanceTier, reducedMotion, revision,
}) {
  const selectedObjects = useMemo(() => {
    if (!modelRoot) return []
    return selectedNames.flatMap((n) => {
      const o = modelRoot.getObjectByName(n)
      return o ? collectMeshes(o) : []
    })
  }, [modelRoot, selectedNames])

  // revision changes when a rig moves, so the focus point tracks Height_Rig.
  const focusTarget = useMemo(() => {
    if (!modelRoot || !focusNodeName) return undefined
    const n = modelRoot.getObjectByName(focusNodeName)
    if (!n) return undefined
    n.updateWorldMatrix(true, false)
    const p = n.getWorldPosition(new THREE.Vector3())
    return Number.isFinite(p.x) ? [p.x, p.y, p.z] : undefined
  }, [modelRoot, focusNodeName, revision])

  const dofEnabled = focusMode && performanceTier === 'high' && !!focusTarget
  const lowTier = performanceTier === 'low'

  return (
    <EffectComposer multisampling={0} enabled>
      {/* SCREEN (postprocessing's default for Outline) composites to nothing
          over the transparent canvas, because the silhouette pixels sit
          against an alpha-0 background. ALPHA blends correctly here. */}
      {selectedObjects.length > 0 ? (
        <Outline
          selection={selectedObjects}
          blendFunction={BlendFunction.ALPHA}
          visibleEdgeColor={0xffb000}
          hiddenEdgeColor={0x4d2e00}
          edgeStrength={5}
          pulseSpeed={reducedMotion || lowTier ? 0 : 0.4}
          blur
          xRay={false}
          resolutionScale={0.5}
        />
      ) : null}
      {dofEnabled ? (
        <Autofocus
          target={focusTarget}
          focalLength={0.055}
          bokehScale={2}
          smoothTime={reducedMotion ? 0 : 0.32}
        />
      ) : null}
    </EffectComposer>
  )
}
