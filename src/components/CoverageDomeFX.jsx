import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Coverage dome presentation: colour state, a wireframe ripple, and a pulse.
 *
 * The dome geometry comes from the GLB as a UNIT hemisphere, so everything here
 * works in local space where the rim is at radius 1 and the apex at y = 1. That
 * matters: the object is scaled to a real coverage radius that changes with
 * height and downtilt, and a shader written against world units would have its
 * ripple spacing stretch and squash every time the learner moved a control.
 *
 * Two signals, deliberately different in shape so they read as separate things:
 *
 *   RIPPLE  many thin bands travelling down the dome, apex to rim. Always on.
 *           Says "this is a live projection", and gives the shell a readable
 *           surface instead of a flat wash.
 *
 *   PULSE   one broad wave expanding from the pole out to the rim. Only once
 *           the rig is correctly set. Says "this site is radiating", and its
 *           direction — axis outwards — is the opposite of the ripple's, so
 *           the two never look like the same animation.
 *
 * Colour carries the state: the pre-commissioning teal becomes green the moment
 * height and downtilt are both within target. That is the same pass/fail the
 * stage gates enforce, shown as a property of the coverage itself.
 */

const TEAL = new THREE.Color('#21e0d0')
const GREEN = new THREE.Color('#3fdc6a')

const vert = /* glsl */`
  varying vec3 vLocal;
  void main() {
    vLocal = position;                       // unit hemisphere, pre-scale
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const frag = /* glsl */`
  precision highp float;
  varying vec3 vLocal;
  uniform vec3  uColor;
  uniform float uTime;
  uniform float uPulse;      // 0 = off, 1 = radiating
  uniform float uOpacity;
  uniform float uWire;       // 1 = wireframe pass, 0 = shell pass

  void main() {
    float h = clamp(vLocal.y, 0.0, 1.0);              // 0 at rim, 1 at apex
    float r = clamp(length(vLocal.xz), 0.0, 1.0);     // 0 at axis, 1 at rim

    // Ripple: bands running apex -> rim. Adding uTime to h makes the crest
    // travel toward decreasing h, i.e. downward.
    float band   = fract(h * 9.0 + uTime * 0.32);
    float ripple = smoothstep(0.86, 1.0, band);

    // Pulse: a single broad crest leaving the axis and reaching the rim.
    float wave  = fract(uTime * 0.26);
    float pulse = smoothstep(0.14, 0.0, abs(r - wave)) * uPulse;

    // The wireframe pass is mostly ripple; the shell pass is mostly body.
    float a = uWire > 0.5
      ? (0.10 + ripple * 0.85 + pulse * 0.35)
      : (uOpacity + ripple * 0.10 + pulse * 0.22);

    vec3 c = uColor + ripple * 0.35 + pulse * 0.45;
    gl_FragColor = vec4(c, a);
  }
`

function makeMaterial(isWire) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    wireframe: isWire,
    blending: THREE.NormalBlending,
    uniforms: {
      uColor: { value: TEAL.clone() },
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uOpacity: { value: 0.16 },
      uWire: { value: isWire ? 1 : 0 },
    },
  })
}

/**
 * @param domeNode  the Coverage_Dome Object3D from the GLB
 * @param radius    metres, already resolved from height/downtilt
 * @param active    whether the dome should be shown at all
 * @param settled   rig is correct — switches teal to green and starts the pulse
 */
export default function CoverageDomeFX({ domeNode, radius, active, settled }) {
  const shellMat = useMemo(() => makeMaterial(false), [])
  const wireMat = useMemo(() => makeMaterial(true), [])
  const wireRef = useRef(null)

  // Build the wireframe overlay once, as a sibling of the shell sharing its
  // geometry — one draw call more, no geometry duplicated.
  useEffect(() => {
    if (!domeNode) return
    const mesh = domeNode.isMesh ? domeNode : domeNode.children.find((c) => c.isMesh)
    if (!mesh) return

    const prevMat = mesh.material
    mesh.material = shellMat
    mesh.renderOrder = 10

    const wire = new THREE.Mesh(mesh.geometry, wireMat)
    wire.name = 'Coverage_Dome_Wire'
    wire.renderOrder = 11
    mesh.add(wire)
    wireRef.current = wire

    return () => {
      mesh.remove(wire)
      mesh.material = prevMat
      wireRef.current = null
    }
  }, [domeNode, shellMat, wireMat])

  // Scale, visibility and state colour.
  useEffect(() => {
    if (!domeNode) return
    domeNode.scale.setScalar(radius)
    domeNode.visible = !!active
    const target = settled ? GREEN : TEAL
    shellMat.uniforms.uColor.value.copy(target)
    wireMat.uniforms.uColor.value.copy(target)
    shellMat.uniforms.uPulse.value = settled ? 1 : 0
    wireMat.uniforms.uPulse.value = settled ? 1 : 0
  }, [domeNode, radius, active, settled, shellMat, wireMat])

  useFrame((_, dt) => {
    if (!active) return
    shellMat.uniforms.uTime.value += dt
    wireMat.uniforms.uTime.value += dt
  })

  return null
}
