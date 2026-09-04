import { useEffect, useRef, useState } from 'react'
import { preload, P1 } from '../lib/preloader'
import { urlFor } from '../lib/assetManifest'
import ReferenceStage from '../reference/ReferenceStage'
import { PinIcon, PlayIcon, ArrowRight } from '../reference/RefIcons'
import '../styles/ref-page01.css'

/**
 * PAGE 01 — Landing, replicated against `01-landing-page.png`.
 *
 * Authored at the reference render's own 1672 x 941 and scaled as one piece,
 * so every coordinate below is the kit's: brand at 84/68, copy block at 82/163,
 * FIELD/MASTER at 98px on 0.88 leading, subtitle at 407, location at 470,
 * tagline at 555, the CTA at 83/636 measuring 454 x 114, the step counter at
 * 84 from the left and 74 from the bottom, campaign copy at 1482/69.
 *
 * The kit is explicit that the title does not sit in a card — the page is
 * carried by open negative space and a localized wash over the plate, and a
 * panel behind the type would close it up.
 *
 * BACKGROUND. The kit's own `landing-awolowo-bg` prompt, generated: one frame
 * with the boulevard in perspective and the LP12 sharp in the right foreground.
 * It replaces a two-layer stand-in that composited the isometric render under
 * the cut-out hero and showed the cut-out's edge down the middle of the page.
 * The wash over it stays, because the plate's left third is bright haze rather
 * than the flat field the title needs.
 *
 * The loading contract is unchanged. P1 is fetched behind the page and Begin
 * leaves only once both the learner has asked and the assets have arrived,
 * whichever happens second.
 */

export default function Page01Welcome({ reducedMotion, onBegin }) {
  const [progress, setProgress] = useState(0)
  const [waiting, setWaiting] = useState(false)
  const assetsReady = useRef(false)
  const requested = useRef(false)
  const left = useRef(false)

  // Both the asset gate and the button call this; whichever is second leaves.
  const maybeLeave = useRef(() => {})
  maybeLeave.current = () => {
    if (left.current || !requested.current || !assetsReady.current) return
    left.current = true
    onBegin()
  }

  useEffect(() => {
    preload(P1, setProgress)
      // The stage gate reports failures; the page still lets the learner in.
      .catch(() => {})
      .finally(() => { assetsReady.current = true; maybeLeave.current() })
  }, [])

  const begin = () => {
    if (requested.current) return
    requested.current = true
    if (!assetsReady.current) setWaiting(true)
    maybeLeave.current()
  }

  return (
    <ReferenceStage className={`p01r${reducedMotion ? ' is-reduced' : ''}`}
                    label="Field Master — LP12 Small-Cell Installation"
                    plate={urlFor('landing-plate')}>
      <img className="fmref-plate p01r-plate" src={urlFor('landing-plate')}
           alt="An LP12 small-cell antenna on a lighting column above Awolowo Way, Ikeja" />
      <div className="p01r-wash" aria-hidden="true" />

      <div className="fm-brand p01r-brand">
        <strong>MIVA</strong><span>OPEN UNIVERSITY</span>
      </div>

      <div className="p01r-copy">
        {/* Two block spans rather than a <br>: the break is visual only, and a
            <br> here makes the accessible name read "FIELDMASTER". */}
        <h1 className="p01r-title"><span>FIELD</span> <span>MASTER</span></h1>
        <p className="p01r-sub">LP12 Small-Cell Installation</p>
        <p className="p01r-where">
          <PinIcon size={26} />
          <span>Awolowo Way<i /> · <i />Ikeja, Lagos</span>
        </p>
        <div className="p01r-rule" aria-hidden="true"><i /><b /></div>
        <p className="p01r-tagline">Practice today.<br />A more connected tomorrow.</p>
      </div>

      <button className="fm-glass fm-btn p01r-cta" type="button"
              onClick={begin} disabled={waiting}>
        <span className="p01r-play" aria-hidden="true"><PlayIcon size={28} /></span>
        <span className="p01r-cta-label">
          {waiting ? `Preparing… ${Math.round(progress * 100)}%` : 'Begin Simulation'}
        </span>
        <ArrowRight size={30} />
      </button>

      <p className="p01r-caption">Interactive Network Installation Simulation</p>

      <div className="p01r-progress" aria-hidden="true">
        <span>01 / 09</span>
        <i className="is-on" /><i /><i /><i /><i /><i /><i /><i />
      </div>

      <p className="p01r-campaign">Real skills<br />greater<br />impact</p>
      <p className="p01r-footer">Mobile networks<br />stronger communities</p>
    </ReferenceStage>
  )
}
