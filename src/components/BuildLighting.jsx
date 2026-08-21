import { Environment, Lightformer } from '@react-three/drei'

/**
 * Lighting matched to the background photograph by measurement, not by eye.
 *
 * Sampled from public/background.jpg:
 *   sunlit surfaces  rgb(0.802, 0.757, 0.725)   warmth R/B 1.106
 *   shadow / shade   rgb(0.112, 0.128, 0.114)   warmth R/B 0.984  (NEUTRAL)
 *   road / bounce    rgb(0.420, 0.413, 0.398)
 *   sunlit:shadow contrast 6.45x, median luminance 0.388
 *
 * Two corrections fell out of that:
 *   1. the plate's shade is essentially neutral, so the strong blue sky fill
 *      used previously made the model read cooler than its backdrop;
 *   2. real contrast is ~6.5:1, so the fill had to come down rather than the
 *      key go up, otherwise the model looks flat against a punchy photo.
 *
 * Sun direction follows the plate: shadows there fall down-left, so the key
 * sits high and camera-right.
 */
const SUN = '#fff1e7'        // R/B ~1.105, matching measured sunlit surfaces
const SKY_FILL = '#cdd2d8'   // near-neutral, faintly cool
const BOUNCE = '#6b665c'     // road/pavement bounce, warm-neutral

export default function BuildLighting() {
  return (
    <>
      {/* Metals have no diffuse response — without something to reflect, the
          steel bands, rail and bracket render black. Built locally into a small
          cube map: no CDN fetch, no HDRI download. */}
      <Environment resolution={256} frames={1} background={false}>
        <Lightformer form="rect" intensity={0.85} color={SKY_FILL}
                     position={[0, 9, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[16, 16, 1]} />
        <Lightformer form="rect" intensity={6.0} color={SUN}
                     position={[6, 7, 5]} rotation={[-Math.PI / 4, Math.PI / 5, 0]} scale={[4, 4, 1]} />
        <Lightformer form="rect" intensity={0.55} color={SKY_FILL}
                     position={[-7, 3, -4]} rotation={[0, -Math.PI / 3, 0]} scale={[6, 6, 1]} />
        <Lightformer form="rect" intensity={0.7} color={BOUNCE}
                     position={[0, -5, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[14, 14, 1]} />
      </Environment>

      {/* Fill kept low: the measured plate runs ~6.5:1, so lifting shadows any
          further makes the model sit flat on top of the photograph. */}
      <hemisphereLight args={[SKY_FILL, BOUNCE, 0.42]} position={[0, 8, 0]} />
      <ambientLight intensity={0.10} />

      {/* Key: high and camera-right, matching the plate's down-left shadows. */}
      <directionalLight
        color={SUN} intensity={2.75} position={[6, 9, 5]}
        castShadow
        shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-bias={-0.0006} shadow-normal-bias={0.02}
        shadow-camera-near={0.5} shadow-camera-far={40}
        shadow-camera-left={-6} shadow-camera-right={6}
        shadow-camera-top={6} shadow-camera-bottom={-6}
      />
      {/* Neutral fill — deliberately NOT blue, per the measurement. */}
      <directionalLight color={SKY_FILL} intensity={0.34} position={[-5, 4, -3]} />
      {/* Rim so dark hardware separates from the blurred backdrop. */}
      <directionalLight color="#ffffff" intensity={0.55} position={[-2, 5, -7]} />
    </>
  )
}
