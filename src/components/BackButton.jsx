import { CaretLeft } from '@phosphor-icons/react'

/**
 * The one way back, on every page that has somewhere to go back to.
 *
 * One component rather than a control per page, so the affordance sits in the
 * same place, at the same size, with the same glass, wherever the learner is.
 * A page that cannot go back (the welcome, and the commissioning screen, which
 * has already frozen the result) simply does not render it.
 *
 * WHY TOP-RIGHT, when back buttons are usually top-left.
 *
 * The top-left corner is already taken on most of these pages — Page 03's
 * locate capsule sits at 4.5vw/5.5vh, the assembly instruction at 5.5vw/10vh,
 * the network test's title panel at 1.675%/3.826%. Putting the control there
 * would mean moving those panels, and their positions came out of the redesign
 * spec. The top-right corner is free on all nineteen pages, so the control can
 * be genuinely in the same place everywhere without touching a single approved
 * layout. Moving it to the left is one rule in field-master.css if that trade
 * is not the right one.
 *
 * `busy` is the same lock the forward controls use: while a clip is playing or
 * a stage is settling, going back would leave the model mid-pose.
 */
export default function BackButton({ onBack, busy = false, label = 'Back', onDark = false }) {
  if (!onBack) return null
  return (
    <button
      type="button"
      className={`fm-glass fm-back${onDark ? ' is-onDark' : ''}`}
      onClick={onBack}
      disabled={busy}
      aria-label={`${label} to the previous step`}
    >
      <CaretLeft size={16} weight="bold" aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}
