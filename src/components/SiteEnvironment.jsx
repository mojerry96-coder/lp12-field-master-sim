import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { urlFor } from '../lib/assetManifest'
import * as THREE from 'three'

export const ENV_MODEL_URL = urlFor('environment')

/**
 * The low-poly Awolowo Way environment, standing around the LP12.
 *
 * The GLB is exported rebased on LP12_INSTALL_ANCHOR, so it drops in at the
 * origin with no transform and the street assembles itself around a pole that
 * is already there. Nothing here positions it — if the two ever drift apart,
 * the fix belongs in the Blender export, not in a nudge on this component.
 *
 * Two things are stripped on the way in, and both matter:
 *
 * LIGHTS. The environment carries its own sun, fill and rim, because it has to
 * light itself when rendered in Blender. Letting those into this scene would
 * add a second lighting rig on top of the studio one, and the studio rig is
 * what the LP12's appearance was tuned against — matching the approved Blender
 * render took a sweep across three environment levels to land on. A stray 1.9
 * strength sun would undo all of it.
 *
 * CAMERAS. CAM_ENV_ISOMETRIC and CAM_LP12_CONTEXT come along in the GLB. They
 * are harmless while unused, but they are exactly the kind of thing that gets
 * picked up later by something iterating scene.children looking for a camera,
 * and the studio anchors own the camera here.
 *
 * The environment also takes no part in shadows. It is background: casting from
 * it would drop city-sized shadows across the antenna the learner is working
 * on, and receiving would fight the ContactShadows already grounding the pole.
 */
export default function SiteEnvironment({ visible = true }) {
  const { scene } = useGLTF(ENV_MODEL_URL)

  const prepared = useMemo(() => {
    const strip = []
    scene.traverse((o) => {
      if (o.isLight || o.isCamera) {
        strip.push(o)
        return
      }
      if (o.isMesh) {
        o.castShadow = false
        o.receiveShadow = false
        // Behind everything, so the antenna and its parts always win the
        // depth argument at the silhouette.
        o.renderOrder = -1
      }
    })
    strip.forEach((o) => o.parent?.remove(o))
    return scene
  }, [scene])

  return <primitive object={prepared} visible={visible} />
}

useGLTF.preload(ENV_MODEL_URL)
