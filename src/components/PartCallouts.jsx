import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Leader-line callouts naming the parts on the pole.
 *
 * Split in two, and it has to be:
 *
 *   CalloutBridge   lives INSIDE <Canvas>, publishes the camera and viewport
 *                   size into a ref every frame
 *   PartCallouts    lives OUTSIDE it, as a plain DOM sibling of the canvas,
 *                   and draws one SVG using what the bridge published
 *
 * The reason is the reconciler. Everything inside <Canvas> is reconciled by
 * R3F, where a JSX tag is a three.js object — `<polyline>` there is not an SVG
 * element, it is a lookup into the THREE namespace, and it throws. react-dom's
 * createPortal does not help: it moves where nodes land in the DOM, not which
 * reconciler interprets them. So the SVG is rendered by React DOM, outside,
 * and only the numbers cross the boundary.
 *
 * drei's <Html> would cross that boundary for us, and it is still the wrong
 * tool: it gives each label its own transformed element with no way to draw a
 * leader back to the part, and the leader is what makes this a callout rather
 * than floating text.
 *
 * Positions are written straight to SVG attributes in a rAF loop. Holding them
 * in state would re-render seven labels sixty times a second to move two line
 * segments.
 */

/* GLB node -> what to call it, and which way the leader runs. */
const CALLOUTS = [
  { node: 'Antenna_Body', label: 'Antenna radome', part: 'antenna-unit', side: 1 },
  { node: 'Cooling_Fins', label: 'Radio unit', part: 'antenna-unit', side: -1 },
  { node: 'Connector_Bank', label: 'RF ports', part: 'connector-set', side: 1 },
  { node: 'Antenna_Fasteners', label: 'Fastener set', part: 'fastener-set', side: -1 },
  { node: 'Pivot_Bracket', label: 'Pivot bracket', part: 'pivot-bracket', side: -1 },
  { node: 'Mounting_Rail', label: 'Mounting rail', part: 'mounting-rail', side: 1 },
  { node: 'Band_Top_Front', label: 'Pole bands', part: 'pole-bands', side: -1 },
]

const LEADER = 52          // px from the anchor to the elbow
const STUB = 26            // px of horizontal run into the label

/** Inside the Canvas. Publishes the camera and size; renders nothing. */
export function CalloutBridge({ viewRef }) {
  const { camera, size } = useThree()
  useFrame(() => { viewRef.current = { camera, size } })
  return null
}

/** Outside the Canvas. Plain DOM. */
export default function PartCallouts({ viewRef, modelRoot, installed = [], hidden = false }) {
  const svgRef = useRef(null)
  const groups = useRef([])
  const vec = useMemo(() => new THREE.Vector3(), [])
  const box = useMemo(() => new THREE.Box3(), [])

  const items = useMemo(() => {
    if (!modelRoot) return []
    return CALLOUTS
      .filter((c) => installed.includes(c.part))
      .map((c) => {
        let object = null
        modelRoot.traverse((o) => { if (!object && o.name === c.node) object = o })
        // `object`, not `node`. Spreading the resolved Object3D over `c.node`
        // used to replace the node's NAME with the object itself, and the name
        // is what keys the list below — so every callout keyed as
        // "[object Object]" and React warned about duplicate keys from the
        // second installed part onward. The name is also the only stable
        // identity here: the object is re-resolved whenever the model reloads.
        return object ? { ...c, object } : null
      })
      .filter(Boolean)
  }, [modelRoot, installed])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const svg = svgRef.current
      const view = viewRef.current
      if (!svg || !view) return
      svg.style.opacity = hidden || !items.length ? '0' : '1'
      if (hidden) return
      const { camera, size } = view

      items.forEach((item, i) => {
        const g = groups.current[i]
        if (!g) return
        // Centre of the part, not its node origin: a GLB origin is wherever the
        // exporter left it, which for the bands is out on the pole axis.
        box.setFromObject(item.object)
        if (box.isEmpty()) { g.style.display = 'none'; return }
        box.getCenter(vec).project(camera)
        if (vec.z > 1) { g.style.display = 'none'; return }   // behind the camera
        g.style.display = ''

        const x = (vec.x * 0.5 + 0.5) * size.width
        const y = (-vec.y * 0.5 + 0.5) * size.height
        const ex = x + item.side * LEADER
        const ey = y - LEADER * 0.62
        const tx = ex + item.side * STUB

        const dot = g.querySelector('.cal-dot')
        dot.setAttribute('cx', x)
        dot.setAttribute('cy', y)
        g.querySelector('.cal-line')
          .setAttribute('points', `${x},${y} ${ex},${ey} ${tx},${ey}`)

        const text = g.querySelector('.cal-text')
        text.setAttribute('x', tx + item.side * 8)
        text.setAttribute('y', ey + 4)
        text.setAttribute('text-anchor', item.side > 0 ? 'start' : 'end')

        const plate = g.querySelector('.cal-plate')
        const w = text.getComputedTextLength() + 16
        plate.setAttribute('x', item.side > 0 ? tx : tx - w)
        plate.setAttribute('y', ey - 11)
        plate.setAttribute('width', Math.max(w, 1))
      })
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [items, hidden, viewRef, vec, box])

  if (!items.length) return null

  return (
    /* Hidden declaratively, not only inside the rAF loop below. The loop is
       the right place for a value that changes every frame; whether the layer
       exists at all is not one, and leaving it to the loop meant the labels
       stayed on screen for as long as frames were not being delivered. */
    <svg ref={svgRef} className="part-callouts" aria-hidden="true"
         style={hidden ? { opacity: 0 } : undefined}>
      {items.map((item, i) => (
        <g key={item.node} ref={(el) => { groups.current[i] = el }}>
          <polyline className="cal-line" fill="none" points="0,0" />
          <circle className="cal-dot" r="4" cx="-99" cy="-99" />
          <rect className="cal-plate" x="-99" y="-99" width="1" height="22" rx="6" />
          <text className="cal-text" x="-99" y="-99">{item.label}</text>
        </g>
      ))}
    </svg>
  )
}
