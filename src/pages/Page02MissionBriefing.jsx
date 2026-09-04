import { urlFor } from '../lib/assetManifest'
import ReferenceStage from '../reference/ReferenceStage'
import { ArrowRight, PinIcon } from '../reference/RefIcons'
import '../styles/ref-page02.css'

/**
 * PAGE 02 — Field Assignment, replicated against `02-field-assignment.png`.
 *
 * The kit's coordinates: panel at 78/176 measuring 548 x 617 on a 28px radius
 * with 44px internal padding; eyebrow 16/800/blue, "Awolowo Way" 52/600,
 * "Ikeja · Lagos" 28/400 secondary, a hairline, the instruction at 29/500 and
 * the body at 18/400 secondary.
 *
 * THE LOCATION PIN IS HTML, and the kit is explicit about why: baked into the
 * background art its label would scale with the image and go soft, so it is a
 * DOM element at 1040/387 that stays crisp at any stage scale. It marks the
 * median column the learner is about to work on.
 *
 * Background is the isometric city this app already renders out of Blender —
 * the same plate the locate page uses. The kit's generated alternative
 * (`field-assignment-isometric.webp`) describes exactly this view, so unlike
 * the other screens there is nothing missing here; the real render is better
 * than a generated approximation of it would be.
 */

export default function Page02MissionBriefing({ reducedMotion, onBegin }) {
  return (
    <ReferenceStage className={`p02r${reducedMotion ? ' is-reduced' : ''}`}
                    label="Field assignment"
                    plate={urlFor('iso-background')}>
      <img className="fmref-plate p02r-city" src={urlFor('iso-background')} alt="" />
      <div className="p02r-wash" aria-hidden="true" />

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

        <button className="fm-btn fm-btn-primary p02r-begin" type="button" onClick={onBegin}>
          <span>Begin</span>
          <ArrowRight size={26} />
        </button>
      </section>

      {/* The column the assignment names, marked on the plate itself. */}
      <div className="p02r-pin" aria-hidden="true">
        <span className="p02r-pin-dot"><PinIcon size={24} /></span>
        <span className="p02r-pin-label">Awolowo Way</span>
      </div>
    </ReferenceStage>
  )
}
