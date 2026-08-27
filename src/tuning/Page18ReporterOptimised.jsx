import { COMPLETION_METRICS } from './tuning-config'

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
 * The three settings are read from what the learner actually confirmed, not
 * written down. They can only be the targets — every step gates on its own
 * value before it will advance — but printing the live figures means the page
 * cannot start lying if a limit is ever retuned.
 */
export default function Page18ReporterOptimised({ values, onComplete }) {
  const settings = [
    { label: 'Measurement Interval', value: values.intervalMs.toFixed(0), unit: 'ms' },
    { label: 'Hysteresis', value: values.hysteresisDb.toFixed(1), unit: 'dB' },
    { label: 'Time-to-Trigger', value: values.timeToTriggerMs.toFixed(0), unit: 'ms' },
  ]

  const results = [
    { value: COMPLETION_METRICS.handoverStabilityPercent, unit: '%', label: 'Stability' },
    { value: COMPLETION_METRICS.batteryCostPercentPerHour, unit: '%/h', label: 'Battery' },
    { value: COMPLETION_METRICS.interruptionMs, unit: 'ms', label: 'Interruption' },
  ]

  return (
    <div className="p18">
      <h1 className="p18-title">Reporter optimised</h1>

      <dl className="p18-settings">
        {settings.map((s) => (
          <div key={s.label}>
            <dt>{s.label}</dt>
            <dd>
              {s.value} <small>{s.unit}</small>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"
                      strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
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

