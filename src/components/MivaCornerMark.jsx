/**
 * The MIVA mark pinned to a clear upper corner of the simulation screens.
 * Pure decoration: no link, no interaction, and pointer-events are off so it
 * can never catch a drag, a knob turn, or a button click. It sits under the
 * opener's z-index (200), so the cinematic opening still owns the first
 * seconds alone.
 *
 * THE TWO IMAGES ARE NOT IN THIS REPOSITORY YET.
 *
 * Upstream this component imported them as `.asset.json` pointers — Lovable's
 * asset indirection, a JSON stub whose `url` resolves against that editor's own
 * host. The stubs carry no image data, the binaries were not in the export, and
 * the path they name (`/__l5e/assets-v1/...`) is not served by this app. Kept as
 * it was, every screen in the simulation would render a broken image in its top
 * corner.
 *
 * So the source is a plain public path, the way every other image in this
 * project is loaded, and the mark renders NOTHING until the file is actually
 * there. A missing decoration should be invisible, not a broken-image icon on
 * top of the hardware the learner is being marked on.
 *
 * To turn it on, drop the two files into public/brand/:
 *   miva-logo-colour.png   — for light screens
 *   miva-logo-white.png    — for dark ones
 */

import { useEffect, useState } from 'react'

const LOGO = {
  light: '/brand/miva-logo-colour.png',
  dark: '/brand/miva-logo-white.png',
}

/** Resolves once per source, and only to true if the image really loads. */
function useImageExists(src) {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    let live = true
    const img = new Image()
    img.onload = () => { if (live) setOk(true) }
    img.onerror = () => { if (live) setOk(false) }
    img.src = src
    return () => { live = false }
  }, [src])
  return ok
}

export default function MivaCornerMark({ onLight = true, oppositeBack = false }) {
  const src = onLight ? LOGO.light : LOGO.dark
  const exists = useImageExists(src)
  if (!exists) return null

  return (
    <img
      className={`miva-corner-mark${oppositeBack ? ' is-left' : ''}`}
      src={src}
      alt="MIVA Open University"
      draggable={false}
    />
  )
}
