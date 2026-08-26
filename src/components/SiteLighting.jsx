import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'

/**
 * The Blender rig, rebuilt from site_look.json.
 *
 * The studio rig this replaces was hand-matched to a Blender scene that has
 * since moved — different world colour, different strength, and a different
 * view transform. Hand-matching drifts every time either side changes, so the
 * values are read from the manifest the environment build writes instead of
 * being restated here.
 *
 * Two conversions, both from the manifest's own axis note:
 *
 *   position   Blender Z-up (x, y, z) -> three Y-up (x, z, -y)
 *   direction  the same substitution; it is a vector, not an angle, so there
 *              is no Euler order to get wrong
 *
 * WATTS is the one number that cannot come from the manifest. Blender area
 * lights are radiometric — watts over an area — and three's RectAreaLight
 * intensity is photometric, with no defined conversion between them. So the
 * manifest's energies set the RATIOS, which is what the look actually depends
 * on, and a single scalar sets the overall level. Calibrating one number
 * against a reference render is honest; inventing a physical conversion for
 * each light and calling it exact would not be.
 */

/** Blender Z-up -> three Y-up. Applies to positions and directions alike. */
function toThree(v) {
  return new THREE.Vector3(v[0], v[2], -v[1])
}

/**
 * Calibration, measured rather than judged by eye.
 *
 * Method: sample the radome face — the same MAT_Antenna_OffWhite in both ends
 * — in a Blender render of CAM_LP12_MOUNT and in the browser canvas, and match
 * them. Comparing whole frames does not work: the browser frame carries the
 * blue information panel and a different slice of the street, so its histogram
 * is measuring the UI as much as the model.
 *
 * Blender radome face:      RGB 225 / 219 / 209, luma 220
 * Browser at first guess:   luma 156   -> 2.1x too dark (linear)
 * After 2.1x:               luma 229   -> 1.09x too bright
 * After the 0.92 trim:      the values below
 *
 * All three scale together, so the manifest's ratios between key, fill, rim,
 * sun and world are preserved and only the overall level is fitted.
 */
const AREA_SCALE = 0.0242      // per Blender watt
const SUN_SCALE = 5.06         // per unit of Blender sun strength
const ENV_SCALE = 1.66         // world strength -> ambient

export default function SiteLighting({ look }) {
  const { gl } = useThree()

  // Tone mapping first: it moves every pixel, so matching lights under the
  // wrong transform is fitting one error with another.
  useEffect(() => {
    if (!look?.color_management) return
    const cm = look.color_management
    // Blender "Standard" is a linear transfer with an exposure multiply,
    // clipped at white. That is LinearToneMapping. NoToneMapping looks like
    // the honest choice and is not: three's shader ignores toneMappingExposure
    // under it, so the exposure silently disappears.
    gl.toneMapping = cm.three_js_tone_mapping === 'LinearToneMapping'
      ? THREE.LinearToneMapping
      : THREE.NoToneMapping
    gl.toneMappingExposure = cm.three_js_exposure ?? Math.pow(2, cm.exposure ?? 0)
    gl.outputColorSpace = THREE.SRGBColorSpace
  }, [gl, look])

  useEffect(() => { RectAreaLightUniformsLib.init() }, [])

  const lights = useMemo(() => (look?.lights ?? []).map((l) => {
    const pos = toThree(l.location)
    const dir = toThree(l.direction ?? [0, 0, -1])
    return { ...l, pos, target: pos.clone().add(dir.multiplyScalar(10)) }
  }), [look])

  const world = look?.world
  const ambient = world
    ? new THREE.Color(world.color[0], world.color[1], world.color[2])
    : null

  if (!look) return null

  return (
    <>
      {/* The world. In Blender this is a uniform background feeding every
          surface, which is exactly a hemisphere with the same colour top and
          bottom — and it is most of the light in a high-key scene, so getting
          it wrong shows up as the whole model sitting too dark. */}
      {ambient && (
        <hemisphereLight args={[ambient, ambient, world.strength * ENV_SCALE]} />
      )}

      {lights.map((l) => {
        if (l.type === 'SUN') {
          return (
            <directionalLight
              key={l.name}
              position={l.pos}
              target-position={l.target}
              intensity={l.energy * SUN_SCALE}
              color={new THREE.Color(l.color[0], l.color[1], l.color[2])}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-bias={-0.0006}
            />
          )
        }
        if (l.type === 'AREA') {
          // RectAreaLight has no target property, so it is aimed by lookAt on
          // mount. It also casts no shadows — the sun above is the only
          // caster, which is the same division of labour the Blender rig has.
          return (
            <rectAreaLight
              key={l.name}
              position={l.pos}
              width={l.size ?? 5}
              height={l.size_y ?? l.size ?? 5}
              intensity={l.energy * AREA_SCALE}
              color={new THREE.Color(l.color[0], l.color[1], l.color[2])}
              onUpdate={(self) => self.lookAt(l.target)}
            />
          )
        }
        return null
      })}
    </>
  )
}
