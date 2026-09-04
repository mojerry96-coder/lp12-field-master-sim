import { useState } from 'react'
import ReferenceStage from '../reference/ReferenceStage'
import {
  ArrowRight, ClipboardIcon, ColumnIcon, NodesIcon, PinIcon, PlayIcon,
} from '../reference/RefIcons'
import '../styles/ref-page04.css'

/**
 * PAGE 04 — Pole Overview, rebuilt against `Field_Master_Pole_Overview_
 * Replication.md` and the supplied 1672 x 941 reference.
 *
 * This is a fidelity task, not a redesign, so the whole composition is authored
 * in the reference's own pixels on the shared ReferenceStage and scaled
 * uniformly — the kit's §3 rule, and the same stage the other replicated
 * screens already use.
 *
 * WHAT THIS PAGE IS FOR (§1). It is an inspection state: it says which object
 * the learner is about to work on and where it stands, and nothing else. The
 * previous version of this page carried "Mounts at 7.5 m height", which is the
 * answer to Page 11 printed on the screen before it, and the §25 list of things
 * to remove names it explicitly. The four rows here are deliberately
 * instructional rather than answer-bearing: no height, no downtilt, no
 * component order, no attachment points, no target marks.
 *
 * THE POLE IS THE HERO (§21, §22). `children` is the live 3D canvas, full
 * bleed behind the stage, and it stays the real model rather than a generated
 * plate. It does not auto-rotate (§23) and this page adds no Orbit control,
 * because the reference build does not show one.
 *
 * The stage is `transparent` so the canvas and the city plate behind it are
 * what fills the frame; §4 is explicit that the background runs continuously
 * across both zones with no column divider.
 *
 * BEGIN INSTALLATION (§26) is a transition, not a jump. The city fades, the
 * studio ground comes up under the pole, and only then does the installation
 * load — so the first component never appears over the street. The 900 ms here
 * is the kit's own figure and it matches the CSS in `ref-page04.css`.
 */

const ROWS = [
  {
    Icon: ColumnIcon,
    title: 'Selected installation pole',
    body: 'LP12 small-cell pole with double-arm luminaire',
  },
  {
    Icon: NodesIcon,
    title: 'Review structure and mounting points',
    body: 'Inspect pole components and attachment zones',
  },
  {
    Icon: PinIcon,
    title: 'Confirm surrounding context',
    body: 'Understand the installation environment',
  },
  {
    Icon: ClipboardIcon,
    title: 'Proceed to begin installation',
    body: 'You’re ready when you are',
  },
]

export default function Page04PoleOverview({ onBeginInstallation, busy, children }) {
  const [leaving, setLeaving] = useState(false)

  const begin = () => {
    if (leaving || busy) return
    setLeaving(true)
    // The route change waits for the environment to have gone, so the
    // installation opens on the isolated studio rather than over the city.
    window.setTimeout(() => onBeginInstallation?.(), 900)
  }

  return (
    <section className={`fm-page p04${leaving ? ' is-starting' : ''}`}
             aria-label="Pole overview">
      {/* Full bleed, not a right-hand column: §4 forbids a hard divider, and
          the old 62%-wide viewport met the street at a visible vertical seam. */}
      <div className="p04-viewport">{children}</div>

      {/* The studio ground the pole is left standing on once the city goes. */}
      <div className="p04-studio" aria-hidden="true" />

      <ReferenceStage className="p04r" label="Pole overview" transparent>
        <div className="fm-brand p04r-brand">
          <strong>MIVA</strong><span>OPEN UNIVERSITY</span>
        </div>

        {/* §24: spatial cues only. No labels, no numbers, no target region —
            it says "inspect this object", not "install here". */}
        <svg className="p04r-guide" viewBox="0 0 220 760" aria-hidden="true">
          <path
            d="M130 18 C192 23, 192 85, 192 150 C192 242, 106 246, 106 315
               C106 385, 158 403, 158 472 C158 555, 188 563, 188 644
               C188 706, 159 730, 86 730"
            fill="none" stroke="rgba(255,255,255,.70)"
            strokeWidth="1" strokeDasharray="2 5"
          />
          {[[106, 315], [158, 472], [86, 730]].map(([cx, cy]) => (
            <g key={`${cx}-${cy}`}>
              <circle cx={cx} cy={cy} r="9" fill="rgba(255,255,255,.75)"
                      stroke="rgba(193,218,249,.88)" strokeWidth="4" />
              <circle cx={cx} cy={cy} r="3" fill="rgba(234,245,255,1)" />
            </g>
          ))}
        </svg>

        <section className="p04r-panel">
          <h1 className="p04r-title">
            <span>POLE</span>
            <strong>OVERVIEW</strong>
          </h1>

          <h2 className="p04r-sub">LP12 Small-Cell Installation</h2>

          <div className="p04r-rule" />

          <div className="p04r-rows">
            {ROWS.map(({ Icon, title, body }) => (
              <div className="p04r-row" key={title}>
                <span className="p04r-row-icon"><Icon size={21} /></span>
                <div>
                  <strong>{title}</strong>
                  <p>{body}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="p04r-rule is-location" />

          <p className="p04r-where">
            <PinIcon size={22} />
            <span>Awolowo Way<i /> · <i />Ikeja, Lagos</span>
          </p>

          <button type="button" className="p04r-begin"
                  onClick={begin} disabled={busy || leaving}>
            <span className="p04r-play" aria-hidden="true"><PlayIcon size={26} /></span>
            <strong>Begin Installation</strong>
            <ArrowRight size={26} />
          </button>
        </section>
      </ReferenceStage>
    </section>
  )
}
