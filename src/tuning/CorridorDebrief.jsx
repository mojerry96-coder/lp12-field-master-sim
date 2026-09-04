import ReferenceStage from '../reference/ReferenceStage'
import {
  ArrowRight, CheckRing, DowntiltIcon, HysteresisIcon, IntervalIcon,
  SignalIcon, TriggerIcon, WarningIcon,
} from '../reference/RefIcons'
import '../styles/ref-corridor.css'

/**
 * PAGE 06 in the kit — "The corridor found problems", against
 * `06-corridor-found-problems.png`.
 *
 * The kit's coordinates: the Network Test panel at 31/24 measuring 340 x 220,
 * the status panel at 1337/119 measuring 270 x 275, and the problems panel at
 * 399/94 measuring 891 x 762 on a 28px radius. No scrollbar anywhere.
 *
 * WHITE GLASS, and the kit is emphatic that this specifically replaces the
 * older dark-blue modal — over a bright isometric city, dark translucency lets
 * the environment contaminate the text.
 *
 * THE 2 x 2 GRID IS THE POINT. The kit requires the four review items side by
 * side so all of them are visible without scrolling, with the settings that
 * passed lifted out into full-width strips above. That split is data-driven
 * here rather than fixed at four-and-one: whatever the learner got right goes
 * in the strips, whatever faulted goes in the grid. The reference's example
 * happens to be one correct and four faulted.
 *
 * The diagnosis sentences and the values are the corridor's own findings, not
 * the reference's — the kit's rule is that the learner sees whether each of
 * their five decisions was effective, and that nothing here silently corrects
 * one.
 *
 * The background is the live corridor scene this page already renders, blurred
 * behind the glass. The kit asks for the isometric corridor "not heavily
 * dimmed", which is what the running test already is.
 */

const ICONS = {
  mountHeight: DowntiltIcon,
  downtilt: DowntiltIcon,
  measurementInterval: IntervalIcon,
  hysteresis: HysteresisIcon,
  timeToTrigger: TriggerIcon,
}

/* The kit's row labels for the live result panel, in its order. */
const STATUS_ROWS = ['coverage', 'stability', 'interruption']

function IssueCard({ decision, onAdjust }) {
  const Icon = ICONS[decision.key] ?? HysteresisIcon
  return (
    <article className="cdb-issue">
      <header>
        <i className="cdb-issue-icon"><Icon size={21} /></i>
        <h4>{decision.label}</h4>
        <b>{decision.value}<small>{decision.unit}</small></b>
      </header>
      <span className="fm-chip fm-chip-danger cdb-issue-chip">Needs review</span>
      <p>{decision.note}</p>
      <button className="cdb-adjust" type="button"
              onClick={() => onAdjust?.(decision.revisit)}>
        Adjust {decision.label.toLowerCase()}
      </button>
    </article>
  )
}

export default function CorridorDebrief({
  decisions, outcome, onAdjust, onCommission, onRetune,
}) {
  const passed = decisions.filter((d) => d.state === 'good')
  const faults = decisions.filter((d) => d.state !== 'good')
  const clean = faults.length === 0

  return (
    <ReferenceStage transparent className="cdb" label="Corridor test result">
      {/* ------------------------------------------------ left: the test */}
      <section className="fm-glass cdb-left">
        <div className="cdb-left-head">
          <i className="cdb-left-icon"><SignalIcon size={26} /><span /></i>
          <div>
            <h2>Network Test</h2>
            <p>Live corridor test</p>
          </div>
        </div>
        <div className="fm-hairline" />
        <div className="cdb-step">
          <span>07 / 09</span>
          <i className="is-on" /><i className="is-on" /><i className="is-on" />
          <i /><i /><i />
        </div>
        <small>Interactive Network Installation Simulation</small>
      </section>

      {/* ----------------------------------------------- right: the result */}
      <aside className="fm-glass cdb-status" aria-label="Live test result">
        {STATUS_ROWS.map((row) => (
          <div key={row} className={`cdb-status-row is-${outcome[row]}`}>
            <span>{row}</span>
            <i aria-hidden="true" />
          </div>
        ))}
        <div className={`cdb-status-row cdb-status-row--final is-${outcome.overall}`}>
          <span>Result</span>
          <b>{outcome.overall === 'good' ? 'Pass' : 'Review'}</b>
          <i aria-hidden="true" />
        </div>
      </aside>

      {/* ------------------------------------------------- the main panel */}
      <section className="fm-glass cdb-panel">
        <header className="cdb-head">
          <i className={`cdb-head-mark${clean ? ' is-good' : ''}`}>
            {clean ? <CheckRing size={26} /> : <WarningIcon size={26} />}
          </i>
          <div>
            <h2>{clean ? 'The corridor held' : 'The corridor found problems'}</h2>
            <p>
              {clean
                ? 'Every decision held up under load. The cell is ready to commission.'
                : `${faults.length} of your five decisions did not hold up.`}
              {!clean && <><br />Adjust them and run the corridor again, or commission
                the cell as it stands.</>}
            </p>
          </div>
        </header>

        {/* Full-width strips for what worked. */}
        {passed.map((d) => (
          <div className="cdb-correct" key={d.key}>
            <span>{d.label}</span>
            <b>{d.value}<small>{d.unit}</small></b>
            <span className="cdb-correct-chip"><CheckRing size={18} />Correct</span>
          </div>
        ))}

        {/* Two by two for what did not, so nothing scrolls. */}
        {!clean && (
          <div className="cdb-grid">
            {faults.map((d) => (
              <IssueCard key={d.key} decision={d} onAdjust={onAdjust} />
            ))}
          </div>
        )}

        <footer className="cdb-foot">
          <button className="fm-btn fm-btn-secondary cdb-commission" type="button"
                  onClick={onCommission}>
            Commission as is
          </button>
          <button className="fm-btn fm-btn-primary cdb-retune" type="button"
                  onClick={clean ? onCommission : onRetune}>
            <span>{clean ? 'Continue' : 'Retune settings'}</span>
            <ArrowRight size={24} />
          </button>
        </footer>
      </section>

      <div className="cdb-wordmark" aria-hidden="true">
        <strong>FIELD</strong>{' '}<span>MASTER</span>
        <small>LP12 Small-Cell Installation</small>
      </div>
    </ReferenceStage>
  )
}
