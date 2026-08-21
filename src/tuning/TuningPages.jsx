import {
  BentoCard, TuningSlider, ArcSlider, ApplyButton, SignalBars, MetricLine, ProgressBar,
  CircularGauge, SampleSparkline, DualSparkline, OverlapRadar, ConfirmedValue,
} from './TuningPrimitives'
import {
  TUNING_LIMITS, COMPLETION_METRICS,
  deriveIntervalReadings, deriveHysteresisReadings, deriveTriggerReadings,
} from './tuning-config'

/**
 * The four tuning pages.
 *
 * All three control pages use the same six card slots in the same positions —
 * only the content inside them changes — so nothing shifts as the learner
 * progresses. The completion page is the one deliberate exception the guide
 * allows: its summary spans the full width, with the grid edges still aligned
 * to the pages before it.
 *
 * Every card on a control page is a readout of that page's control. The
 * reference's RSRP, Cell Overlap and Overlap Map cards are gone: RSRP is the
 * downlink power at a fixed spot and cell overlap is network geometry, so
 * neither moves when the reporter is retuned. Presented as instruments they
 * only ever showed the same number, which teaches the learner that the panel
 * is decoration. Each has been replaced by a quantity the control genuinely
 * drives, and every replacement still reads the guide's locked figure when the
 * control is at target.
 */

/** Shared shape for the "cost of getting it wrong" cards. */
function StatCard({ className = 'slot-d lp12-centered-card', eyebrow, value, unit, caption, tone }) {
  return (
    <BentoCard className={className}>
      <span className="lp12-card-eyebrow">{eyebrow}</span>
      <strong className="lp12-secondary-value">{value}<small>{unit}</small></strong>
      {caption && <span className={tone === 'green' ? 'lp12-success-caption' : 'lp12-caption'}>{caption}</span>}
    </BentoCard>
  )
}

/* ------------------------------------------------- 1. Measurement Interval */
export function MeasurementIntervalPage({ value, onChange, onApply, hint, nudge }) {
  const l = TUNING_LIMITS.intervalMs
  const live = deriveIntervalReadings(value)
  return (
    <div className="lp12-bento-grid lp12-page-enter">
      <BentoCard className="slot-a lp12-control-card">
        <TuningSlider
          label="Measurement Interval" value={value}
          min={l.min} max={l.max} step={l.step} target={l.target} unit="ms"
          onChange={onChange} nudge={nudge}
        />
        <ApplyButton id="apply-interval" onClick={onApply}>Apply</ApplyButton>
        <p className="lp12-hint">{hint}</p>
      </BentoCard>

      {/* The cost side of the same dial: sampling faster detects sooner and
          drains more. Seeing both is what makes a middle value obviously right. */}
      <BentoCard className="slot-b lp12-centered-card">
        <span className="lp12-card-eyebrow">Battery Cost</span>
        <strong className="lp12-secondary-value">
          {live.batteryCostPerHour}<small>%/h</small>
        </strong>
        <SignalBars active={Math.max(1, Math.min(5, Math.round(Number(live.batteryCostPerHour))))} />
      </BentoCard>

      <BentoCard className="slot-c">
        <span className="lp12-card-eyebrow">Sampling</span>
        <strong className="lp12-secondary-value">
          {live.samplingPerSecond}<small>/s</small>
        </strong>
      </BentoCard>

      <BentoCard className="slot-d">
        <span className="lp12-card-eyebrow">Samples (Last 60s)</span>
        <SampleSparkline seed={11} axis={['20', '0', '-20', '-40']} height={82}
                         samples={live.samplesPerMinute} />
      </BentoCard>

      {/* These are how well the reporter can characterise the cell, which is a
          function of how many reports it took — not fixed site data. */}
      <BentoCard className="slot-e">
        <span className="lp12-card-eyebrow">Report Confidence</span>
        <MetricLine label="PCI Consistency" value={live.reporting.pciConsistency} />
        <MetricLine label="Timing Advance" value={live.reporting.timingAdvance} />
        <MetricLine label="Uplink Quality" value={live.reporting.uplinkQuality} />
      </BentoCard>

      <BentoCard className="slot-f lp12-centered-card">
        <span className="lp12-card-eyebrow">Network Health</span>
        <CircularGauge value={live.networkHealth} tone="green"
                       caption={live.networkHealth >= 90 ? 'Excellent' : 'Degraded'} />
      </BentoCard>
    </div>
  )
}

/* -------------------------------------------------------- 2. Hysteresis */
export function HysteresisPage({ value, onChange, onApply, hint, nudge }) {
  const l = TUNING_LIMITS.hysteresisDb
  const live = deriveHysteresisReadings(value)
  return (
    <div className="lp12-bento-grid lp12-page-enter">
      <BentoCard className="slot-a lp12-control-card">
        <TuningSlider
          label="Hysteresis" value={value} displayValue={value.toFixed(1)}
          min={l.min} max={l.max} step={l.step} target={l.target} unit="dB"
          onChange={onChange} nudge={nudge}
        />
        <ApplyButton id="apply-hysteresis" onClick={onApply}>Apply</ApplyButton>
        <p className="lp12-hint">{hint}</p>
      </BentoCard>

      <BentoCard className="slot-b lp12-centered-card">
        <span className="lp12-card-eyebrow">Boundary Stability</span>
        <CircularGauge value={live.boundaryStability} tone="green"
                       caption={live.boundaryStability >= 90 ? 'Stable' : 'Unsettled'} />
      </BentoCard>

      {/* The two opposing failure modes. Too small a margin bounces the phone
          between cells; too large strands it on a dying one. Showing both is
          what makes the middle value visibly correct rather than asserted. */}
      <BentoCard className="slot-c">
        <span className="lp12-card-eyebrow">Ping-Pong Handovers</span>
        <strong className="lp12-small-value">{live.pingPongPerHour}<small> /h</small></strong>
        <ProgressBar value={Math.min(100, live.pingPongPerHour * 3.5)} tone="blue" />
      </BentoCard>

      <StatCard eyebrow="Late Handover Risk" value={live.lateHandoverRisk} unit="%"
                caption={live.lateHandoverRisk <= 40 ? 'Acceptable' : 'Rising'}
                tone={live.lateHandoverRisk <= 40 ? 'green' : undefined} />

      <BentoCard className="slot-e">
        <span className="lp12-card-eyebrow">Boundary Crossings</span>
        <SampleSparkline seed={29} axis={['6', '3', '0']} height={82}
                         crossings={live.crossings} />
      </BentoCard>

      <BentoCard className="slot-f lp12-centered-card">
        <span className="lp12-card-eyebrow">Handover Zone</span>
        <OverlapRadar spread={live.boundaryStability / 100} />
      </BentoCard>
    </div>
  )
}

/* --------------------------------------------------- 3. Time-to-Trigger */
export function TimeToTriggerPage({ value, onChange, onApply, hint, nudge }) {
  const l = TUNING_LIMITS.timeToTriggerMs
  const live = deriveTriggerReadings(value)
  return (
    <div className="lp12-bento-grid lp12-page-enter">
      <BentoCard className="slot-a lp12-control-card">
        <ArcSlider
          label="Time-to-Trigger" value={value}
          min={l.min} max={l.max} step={l.step} target={l.target} unit="ms"
          onChange={onChange} nudge={nudge}
        />
        <p className="lp12-caption" style={{ textAlign: 'center' }}>{l.min}–{l.max} ms</p>
        <ApplyButton id="confirm-ttt" onClick={onApply}>Confirm</ApplyButton>
        <p className="lp12-hint">{hint}</p>
      </BentoCard>

      {/* Both extremes cost the same currency. Fire early and handovers fail
          and get retried; fire late and the phone waits on a cell it should
          have left. The floor of that curve is the answer. */}
      <BentoCard className="slot-b lp12-centered-card">
        <span className="lp12-card-eyebrow">Handover Delay</span>
        <strong className="lp12-secondary-value">
          {live.handoverDelayMs}<small>ms</small>
        </strong>
        <span className="lp12-caption">Average · 100–180 ms</span>
      </BentoCard>

      <BentoCard className="slot-c">
        <span className="lp12-card-eyebrow">Trigger State</span>
        <strong className="lp12-small-value">
          {live.triggerStatePercent >= 90 ? 'Stable' : 'Premature'}
        </strong>
        <ProgressBar value={live.triggerStatePercent} tone="green" />
      </BentoCard>

      <StatCard eyebrow="Interruption" value={live.interruptionMs} unit="ms"
                caption={live.interruptionMs <= 9 ? 'Very Low' : 'Noticeable'}
                tone={live.interruptionMs <= 9 ? 'green' : undefined} />

      <BentoCard className="slot-e">
        <span className="lp12-card-eyebrow">Trigger Response</span>
        <DualSparkline height={82} triggerAt={(value - l.min) / (l.max - l.min)} />
      </BentoCard>

      <BentoCard className="slot-f lp12-centered-card">
        <span className="lp12-card-eyebrow">Network Health</span>
        <CircularGauge value={live.networkHealth} tone="green"
                       caption={live.networkHealth >= 90 ? 'Excellent' : 'Degraded'} />
      </BentoCard>
    </div>
  )
}

/* ----------------------------------------------- 4. Optimisation Complete */
export function OptimisationCompletePage({ onContinue }) {
  return (
    <div className="lp12-completion-grid lp12-page-enter">
      <BentoCard className="completion-summary">
        <div className="lp12-success-heading">
          <span className="lp12-check" aria-hidden="true">✓</span>
          <h2>Reporter Optimised</h2>
        </div>
        <div className="lp12-confirmed-values">
          <ConfirmedValue value="128" unit="ms" label="Measurement Interval" />
          <ConfirmedValue value="2.5" unit="dB" label="Hysteresis" />
          <ConfirmedValue value="480" unit="ms" label="Time-to-Trigger" />
        </div>
      </BentoCard>

      <BentoCard className="completion-kpi">
        <span className="lp12-card-eyebrow">Handover Stability</span>
        <strong className="lp12-kpi-success">
          {COMPLETION_METRICS.handoverStabilityPercent}<small>%</small>
        </strong>
        <span className="lp12-success-caption">Excellent</span>
      </BentoCard>

      <BentoCard className="completion-kpi">
        <span className="lp12-card-eyebrow">Battery Cost</span>
        <strong className="lp12-kpi">
          {COMPLETION_METRICS.batteryCostPercentPerHour}<small>%/h</small>
        </strong>
        <span className="lp12-blue-caption">Low</span>
      </BentoCard>

      <BentoCard className="completion-kpi">
        <span className="lp12-card-eyebrow">Interruption</span>
        <strong className="lp12-kpi">
          {COMPLETION_METRICS.interruptionMs}<small>ms</small>
        </strong>
        <span className="lp12-blue-caption">Very Low</span>
      </BentoCard>

      <button id="continue-corridor" type="button"
              className="lp12-completion-button" onClick={onContinue}>
        Continue to Corridor Test
      </button>
    </div>
  )
}
