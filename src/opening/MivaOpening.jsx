import { useEffect, useRef, useState } from 'react'
import { urlFor } from '../lib/assetManifest'

/**
 * The institutional opener.
 *
 * One fixed layer over the welcome page for ~7.2 seconds: navy, a blue sweep,
 * MIVA OPEN UNIVERSITY resolving out of blur, then the Awolowo Way plate
 * emerging behind the wordmark until the layer itself is gone. It renders the
 * same hero photograph the welcome page renders, so the hand-over is a fade of
 * blur and exposure rather than a swap of pictures.
 *
 * The whole timeline is CSS delays off one clock; this component only owns the
 * end of it, the skip, and the reduced-motion variant.
 */

export const OPENING_MS = 7200
const REDUCED_MS = 1600
const SKIP_AFTER_MS = 1000

export default function MivaOpening({ reducedMotion = false, onDone }) {
  const total = reducedMotion ? REDUCED_MS : OPENING_MS
  const [skippable, setSkippable] = useState(false)
  const done = useRef(false)

  const finish = useRef(() => {})
  finish.current = () => {
    if (done.current) return
    done.current = true
    onDone?.()
  }

  useEffect(() => {
    const end = setTimeout(() => finish.current(), total)
    const arm = setTimeout(() => setSkippable(true), SKIP_AFTER_MS)
    return () => { clearTimeout(end); clearTimeout(arm) }
  }, [total])

  useEffect(() => {
    if (!skippable) return undefined
    const skip = () => finish.current()
    window.addEventListener('pointerdown', skip)
    window.addEventListener('keydown', skip)
    return () => {
      window.removeEventListener('pointerdown', skip)
      window.removeEventListener('keydown', skip)
    }
  }, [skippable])

  return (
    <div className={`mivo${reducedMotion ? ' is-reduced' : ''}`} aria-hidden="true">
      <div className="mivo-ground" />
      <div className="mivo-glow" />
      <img className="mivo-plate" src={urlFor('landing-plate')} alt="" draggable={false} />
      <div className="mivo-grain" />
      <div className="mivo-sweep" />
      <div className="mivo-bloom" />
      <div className="miva-opening-title mivo-title">
        <strong>MIVA</strong> OPEN UNIVERSITY
      </div>
    </div>
  )
}
