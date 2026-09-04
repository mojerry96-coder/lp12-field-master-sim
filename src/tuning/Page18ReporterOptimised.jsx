import { COMPLETION_METRICS, TUNING_LIMITS } from './tuning-config'

/**
 * PAGE 18 — Reporter Optimised.
 *
 * The three decisions, confirmed, and what they bought. Same tablet and the
 * same full-artboard screen as the tuning steps before it — the specification
 * asks for perfect continuity across 15 to 18, and this is the page that pays
 * it off.
 *
 * The CTA is "Complete Commissioning". Section 2.9 is explicit about why: the
 * old "Continue to Corridor Test" led straight to completion and there was no
 * corridor test, so the button named a step that did not exist.
 *
 * The three settings are read from what the learner actually confirmed, and so
 * is the mark against each one.
 *
 * They used to carry an unconditional green tick, on the reasoning that they
 * "can only be the targets — every step gates on its own value before it will
 * advance". That gate is gone: the steps now accept whatever the learner dials
 * in and the corridor test judges it afterwards. So this page was handing a
 * green tick to a time-to-trigger the debrief had just faulted, on the screen
 * immediately after the one that faulted it.
 *
 * Each row is now marked against the same tolerance the corridor test used, so
 * the two screens cannot contradict each other. This is not a second verdict —
 * the learner has already been told and has already chosen to commission as it
 * stands — it is the summary agreeing with what it is summarising.
 */
const isOnTarget = (key, value) => {
  const l = TUNING_LIMITS[key]
  return Math.abs(value - l.target) <= (l.tolerance || 0)
}

export default function Page18ReporterOptimised({ values, onComplete }) {
  const settings = [
    { label: 'Measurement Interval', value: values.intervalMs.toFixed(0), unit: 'ms',
      ok: isOnTarget('intervalMs', values.intervalMs) },
    { label: 'Hysteresis', value: values.hysteresisDb.toFixed(1), unit: 'dB',
      ok: isOnTarget('hysteresisDb', values.hysteresisDb) },
    { label: 'Time-to-Trigger', value: values.timeToTriggerMs.toFixed(0), unit: 'ms',
      ok: isOnTarget('timeToTriggerMs', values.timeToTriggerMs) },
  ]
  const allOk = settings.every((s) => s.ok)

  const results = [
    { value: COMPLETION_METRICS.handoverStabilityPercent, unit: '%', label: 'Stability' },
    { value: COMPLETION_METRICS.batteryCostPercentPerHour, unit: '%/h', label: 'Battery' },
    { value: COMPLETION_METRICS.interruptionMs, unit: 'ms', label: 'Interruption' },
  ]

  return (
    <div className="p18">
      {/* The heading follows the settings rather than asserting over them: a
          reporter with a value off target has not been optimised, and saying so
          is the whole reason the corridor test sent them back. */}
      <h1 className="p18-title">{allOk ? 'Reporter optimised' : 'Reporter configured'}</h1>

      <dl className="p18-settings">
        {settings.map((s) => (
          <div key={s.label}>
            <dt>{s.label}</dt>
            <dd className={s.ok ? 'is-ok' : 'is-review'}>
              {s.value} <small>{s.unit}</small>
              {s.ok ? (
                <svg viewBox="0 0 24 24" width="16" height="16" role="img"
                     aria-label="on target">
                  <path fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"
                        strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="16" height="16" role="img"
                     aria-label="off target, needs review">
                  <path fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"
                        strokeLinejoin="round" d="M12 6.5v7M12 17.4v.2" />
                </svg>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <div className="p18-results">
        {results.map((r) => (
          <div key={r.label} className="p18-result">
            <strong>{r.value}<small>{r.unit}</small></strong>
            <span>{r.label}</span>
          </div>
        ))}
      </div>

      <button id="complete-commissioning" type="button" className="p18-cta"
              onClick={onComplete}>
        Complete Commissioning
      </button>
    </div>
  )
}

