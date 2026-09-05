import ReferenceStage from '../reference/ReferenceStage'
import { ArrowRight } from '../reference/RefIcons'
import '../styles/ref-page02.css'

/**
 * FIELD ASSIGNMENT — the briefing and the site, on one screen.
 *
 * This was two pages. The assignment card named the job over the isometric
 * city, Begin dismissed it, and an otherwise identical city came back carrying
 * a "Locate the LP12 installation site" capsule and a "Click me" leader
 * pointing at the column. The learner read the same plate twice and the second
 * pass asked for a click that only confirmed what the first pass had already
 * told them: the replacement goes on the lighting column on the central
 * median. So the two are merged, the capsule and the leader are gone, and
 * Begin now does what the column click used to do — it opens the installation.
 *
 * WHAT SURVIVED is the dead zone, as the red pulsing dome over the column. It
 * is the reason there is an assignment at all, and it is the one thing here
 * the card cannot say in words as well as the plate says it in shape.
 *
 * THE PIN IS GONE. It was the locate page's label for the column and it was
 * carried over with the merge, projected onto the same anchor the dome hangs
 * off — which is exactly why it had to go: two marks on one spot, and the
 * smaller one sat on top of the larger. The dome already says which column,
 * more loudly and for a better reason, so the label was covering the thing it
 * was pointing at.
 *
 * The stage is `transparent`: the card sits over App's live plate and the dome
 * drawn on it, rather than over a copy of its own.
 */

export default function Page02MissionBriefing({ reducedMotion, onBegin, busy = false }) {
  return (
    <>
      {/* Full bleed, over App's plate and under the card: the wash that keeps
          the panel readable over the city. */}
      <div className="p02m-wash" aria-hidden="true" />

      <ReferenceStage className={`p02r${reducedMotion ? ' is-reduced' : ''}`}
                      label="Field assignment" transparent>
        <div className="fm-brand p02r-brand">
          <strong>MIVA</strong><span>OPEN UNIVERSITY</span>
        </div>

        <section className="fm-glass p02r-panel">
          <p className="p02r-eyebrow">Field assignment</p>
          <h1 className="p02r-site">Awolowo Way</h1>
          <p className="p02r-place">Ikeja · Lagos</p>

          <div className="fm-hairline p02r-line" />

          <p className="p02r-brief">Install and commission one<br />LP12 small-cell antenna.</p>
          <p className="p02r-note">
            Replacement goes on the lighting column<br />on the central median.
          </p>

          {/* Begin carries the selection now. It is the only way into the
              installation from this screen, so it is disabled while the
              transition it starts is already running. */}
          <button className="fm-btn fm-btn-primary p02r-begin" type="button"
                  onClick={onBegin} disabled={busy}>
            <span>Begin</span>
            <ArrowRight size={26} />
          </button>
        </section>
      </ReferenceStage>
    </>
  )
}
