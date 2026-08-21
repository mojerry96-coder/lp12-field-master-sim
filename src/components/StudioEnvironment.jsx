import { useEffect, useRef } from 'react'
import { ContactShadows, Environment, Lightformer } from '@react-three/drei'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'

/**
 * White product studio, matched to the corrected Blender rig.
 *
 * The previous version reproduced the same fault the Blender studio had: a
 * strong ambientLight (0.42) plus a broad environment plus fill at 40% of key.
 * Undirected light from every side is what flattens the model - it lifts the
 * shadow side as much as the lit side, so nothing reads as its material. The
 * render brief is explicit that leaning on AmbientLight recreates the washed
 * out result, and it did.
 *
 * The hierarchy below is the Blender rig's, ratio for ratio:
 *
 *     key   100%   the only shadow caster, and the only source with authority
 *     fill    20%   opens the shadow side without cancelling the key
 *     rim     30%   separates the enclosure and metal edges from the backdrop
 *
 * Ambient is gone. What remains is a restrained environment, which gives metal
 * something to reflect - without it, metalness ~0.92 surfaces go black - at an
 * intensity low enough that it never competes with the key.
 *
 * BACKDROP: #EDECE9, the brief's value. It is deliberately brighter than the
 * enclosure albedo (#C7C9C8). Measuring the target reference gives backdrop
 * 238 against pole 152, and that separation is the whole look; a backdrop that
 * merely matches the subject is the fog.
 */
export const STUDIO_BG = '#edece9'

/** Key intensity. Fill and rim are derived, so the ratios cannot drift apart. */
const KEY = 2.5
const FILL = KEY * 0.20
const RIM = KEY * 0.30

/**
 * Area lights, mirroring the Blender rig's actual geometry.
 *
 * This is why the browser looked flat next to the render, and it is not a
 * tuning problem: a directionalLight is parallel and infinitely distant, so on
 * a flat panel like the antenna enclosure it produces perfectly uniform
 * illumination and a pinpoint specular. Measured against the Blender frame,
 * the enclosure face held a standard deviation of 2.1 against Blender's 12.7,
 * and sweeping intensity from 1x to 4x against three environment levels never
 * pushed it past 6.6. There is no setting at which a parallel source models a
 * flat face, because it has no falloff across one.
 *
 * Blender lights it with a 5 m area source about 15 m out: real inverse-square
 * falloff across the face, and a broad soft specular sweep instead of a dot.
 * RectAreaLight is three's direct analogue, so the sizes and the 100/20/30
 * ratios below are the same numbers build_lp12_studio.py uses.
 *
 * RectAreaLight casts no shadows, so the directional key is kept purely as the
 * shadow caster at low intensity — shape from the area lights, contact from the
 * directional, which is the usual division of labour.
 */
const AREA = [
  // [name,        position,        w,   h,   share, colour]
  ['key',  [8.5, 12.0, 8.5], 5.0, 5.0, 1.00, '#fffdf8'],
  ['fill', [-9.5, 7.5, 7.0], 4.5, 4.5, 0.20, '#eef4ff'],
  ['rim',  [-3.5, 11.0, -8.5], 2.6, 2.6, 0.30, '#ffffff'],
]

/**
 * Area lights are far weaker per unit than a directional at these sizes and
 * distances. 31 was swept against the Blender frame, not guessed: it lands the
 * pole shaft at mean 140 / sd 15.5 against Blender's 148.1 / 13.3, which is the
 * closest simultaneous match for level and modelling across the range tried.
 */
const AREA_GAIN = 31

function AreaRig({ target = [0, 7.5, 0] }) {
  const refs = useRef([])
  useEffect(() => { RectAreaLightUniformsLib.init() }, [])
  useEffect(() => {
    refs.current.forEach((l) => l && l.lookAt(target[0], target[1], target[2]))
  }, [target])
  return (
    <>
      {AREA.map(([name, pos, w, h, share, color], i) => (
        <rectAreaLight
          key={name}
          ref={(el) => { refs.current[i] = el }}
          position={pos} width={w} height={h} color={color}
          intensity={KEY * share * AREA_GAIN}
        />
      ))}
    </>
  )
}

export default function StudioEnvironment() {
  return (
    <>
      <color attach="background" args={[STUDIO_BG]} />

      {/* Reflection source only. Intensities are a third of the previous set:
          enough for metal to have something to see, not enough to light the
          scene on its own. */}
      <Environment resolution={256} frames={1} background={false}>
        <Lightformer form="rect" intensity={0.22} color="#ffffff"
                     position={[0, 12, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[20, 20, 1]} />
        <Lightformer form="rect" intensity={1.1} color="#fffdf8"
                     position={[7, 9, 7]} rotation={[-Math.PI / 4, Math.PI / 5, 0]} scale={[8, 8, 1]} />
        <Lightformer form="rect" intensity={0.3} color="#eef4ff"
                     position={[-8, 6, 6]} rotation={[0, -Math.PI / 4, 0]} scale={[10, 10, 1]} />
        <Lightformer form="rect" intensity={0.38} color="#ffffff"
                     position={[2, 10, -8]} rotation={[Math.PI / 3, 0, 0]} scale={[6, 6, 1]} />
      </Environment>

      {/* No ambientLight. See the note above - it was the flattener. */}

      {/* Shape comes from the area rig. */}
      <AreaRig />

      {/* Shadow caster only — RectAreaLight cannot cast. Intensity is a
          fraction of the key so it contributes shadow without re-flattening
          the faces the area lights just modelled. */}
      <directionalLight
        castShadow position={[8.5, 12, 8.5]} intensity={KEY * 0.25} color="#fffdf8"
        shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-bias={-0.0004} shadow-normal-bias={0.015}
        shadow-camera-near={0.5} shadow-camera-far={60}
        shadow-camera-left={-10} shadow-camera-right={10}
        shadow-camera-top={16} shadow-camera-bottom={-16}
      />

      {/* No floor plane.
          A lit ground plane and the flat clear colour never tone-map to the
          same value, so however carefully the two are matched they meet at a
          visible horizon line right behind the pole. The target reference has
          no horizon at all - it is a flat field with a soft shadow under the
          base - so the plane is gone and ContactShadows carries the grounding
          on its own, which is what it renders anyway. */}

      {/* Contact shadow, kept as a tight pool under the footer.
          `far` is the important number. At 7 it caught seven metres of pole,
          and blurring a shadow that long smeared it across nearly the whole
          16-unit plane - which then read as a faintly tinted floor slab with a
          visible far edge, a horizon by another route. At 3 only the footer
          and base casts, so the shadow stays a pool and the rest of the plane
          stays genuinely transparent. */}
      <ContactShadows position={[0, 0.01, 0]} scale={9} opacity={0.5}
                      blur={2.4} far={3} resolution={1024} />
    </>
  )
}
