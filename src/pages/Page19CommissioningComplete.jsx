import { useSim } from '../store'
import { urlFor } from '../lib/assetManifest'
import ReferenceStage from '../reference/ReferenceStage'
import { ArrowRight, BarsIcon, PinIcon, RestartIcon } from '../reference/RefIcons'
import '../styles/ref-page19.css'

/**
 * PAGE 04 in the kit — Commissioning Complete, against
 * `04-commissioning-complete.png`.
 *
 * One card at 87/95 measuring 626 x 731 on a 31px radius with 52px padding,
 * over the kit's own `commissioning-complete-bg` prompt, generated: the
 * hardware sharp on the right, the boulevard defocused behind it, and the left
 * 45% held calm for the card.
 *
 * The score hierarchy is the kit's and it is specific: the number is blue and
 * large, `/ 100` is navy and smaller, and the verdict chip is AMBER rather than
 * red — a review is not a failure. Both actions are full-width pills, with
 * Review Performance carrying the one dominant blue and Restart sitting quietly
 * under it.
 *
 * The number itself is the learner's, read from the frozen result the store
 * took when they commissioned; the reference's 50 is only what its example run
 * happened to score. `passMark` decides the chip, so a run that clears the mark
 * says PASS in green rather than REVIEW in amber.
 */

export default function Page19CommissioningComplete({ onReview, onRestart }) {
  const result = useSim((s) => s.result)
  const score = result?.score ?? null
  const passMark = result?.passMark ?? 70
  const passed = score !== null && score >= passMark

  return (
    <ReferenceStage className="p19r" label="Commissioning complete">
      <img className="fmref-plate p19r-plate" src={urlFor('commissioning-plate')}
           alt="The commissioned LP12 on its column above Awolowo Way" />
      <div className="p19r-wash" aria-hidden="true" />

      <section className="fm-glass p19r-card">
        <div className="fm-brand p19r-brand">
          <strong>MIVA</strong><span>OPEN UNIVERSITY</span>
        </div>

        <h1 className="p19r-title">Commissioning<br />complete</h1>

        <p className="p19r-score-label">Final score</p>
        <div className="p19r-score">
          <strong>{score ?? '—'}</strong>
          <span className="p19r-outof">/ 100</span>
          <span className={`fm-chip ${passed ? 'fm-chip-good' : 'fm-chip-review'} p19r-verdict`}>
            <i aria-hidden="true" />{passed ? 'Pass' : 'Review'}
          </span>
          <span className="sr-live">
            {score === null ? '' : `${score} out of 100, pass mark ${passMark}`}
          </span>
        </div>

        <p className="p19r-where">
          <PinIcon size={20} />
          <span>Awolowo Way<i /> · <i />LP12</span>
        </p>

        <div className="fm-hairline p19r-line" />

        <button className="fm-btn fm-btn-primary p19r-action" type="button" onClick={onReview}>
          <span className="p19r-action-glyph"><BarsIcon size={22} /></span>
          <span className="p19r-action-label">Review Performance</span>
          <ArrowRight size={24} />
        </button>

        <button className="fm-btn fm-btn-secondary p19r-action" type="button" onClick={onRestart}>
          <span className="p19r-action-glyph is-quiet"><RestartIcon size={22} /></span>
          <span className="p19r-action-label">Restart</span>
          <ArrowRight size={24} />
        </button>
      </section>
    </ReferenceStage>
  )
}
