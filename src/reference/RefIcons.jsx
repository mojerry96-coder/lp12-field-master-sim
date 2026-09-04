/**
 * Icons for the replicated screens.
 *
 * The kit ships these as text glyphs — "△", "◷", "⌁", "⏱", "▥" — which render
 * as whatever the system font has, at the wrong weight and baseline, and in the
 * references they are plainly drawn marks. So they are SVG here, sized in the
 * reference render's own pixels and inheriting `currentColor` so a card can
 * recolour its own icon.
 */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function PinIcon({ size = 24 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0
               9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
    </svg>
  )
}

export function PlayIcon({ size = 24 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d="M8.5 5.4v13.2L19 12z" />
    </svg>
  )
}

export function ArrowRight({ size = 24 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path {...stroke} strokeWidth={2} d="M4 12h15m-6-6 6 6-6 6" />
    </svg>
  )
}

export function ChevronLeft({ size = 20 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path {...stroke} strokeWidth={2} d="M15 6l-6 6 6 6" />
    </svg>
  )
}

export function CheckIcon({ size = 20 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="currentColor" />
      <path fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"
            strokeLinejoin="round" d="M7.8 12.3l2.9 2.9L16.4 9.5" />
    </svg>
  )
}

export function CheckRing({ size = 20 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="9" {...stroke} />
      <path {...stroke} d="M8 12.3l2.8 2.8L16.2 9.6" />
    </svg>
  )
}

export function WarningIcon({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path {...stroke} d="M12 4.6 2.9 20h18.2z" />
      <path {...stroke} d="M12 10.4v4.1" />
      <circle cx="12" cy="17.4" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  )
}

/* --- the four tuning settings, one mark each ------------------------------ */

export function DowntiltIcon({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path {...stroke} d="M12 4.6v9.6" />
      <path {...stroke} d="m8.2 10.6 3.8 3.8 3.8-3.8" />
      <path {...stroke} d="M4.4 19h15.2" />
    </svg>
  )
}

export function IntervalIcon({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" {...stroke} />
      <path {...stroke} d="M12 7.4V12l3.1 1.9" />
    </svg>
  )
}

export function HysteresisIcon({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path {...stroke} d="M2.6 12h3.6l2.6-6 3.6 12 2.6-6h4.4" />
    </svg>
  )
}

export function TriggerIcon({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="13.2" r="7.4" {...stroke} />
      <path {...stroke} d="M12 9.6v3.6l2.4 1.5M9.6 3h4.8" />
    </svg>
  )
}

export function BarsIcon({ size = 20 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="3" y="14" width="3.2" height="6.5" rx="1" fill="currentColor" />
      <rect x="8.6" y="10" width="3.2" height="10.5" rx="1" fill="currentColor" />
      <rect x="14.2" y="5.5" width="3.2" height="15" rx="1" fill="currentColor" />
    </svg>
  )
}

export function SignalIcon({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path {...stroke} d="M5 9.4a9 9 0 0 1 14 0M8 12.7a5 5 0 0 1 8 0" />
      <circle cx="12" cy="16.6" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function GearIcon({ size = 20 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="3.1" {...stroke} />
      <path {...stroke} d="M12 3.2v2.4M12 18.4v2.4M20.8 12h-2.4M5.6 12H3.2
               M18.2 5.8l-1.7 1.7M7.5 16.5l-1.7 1.7M18.2 18.2l-1.7-1.7M7.5 7.5 5.8 5.8" />
    </svg>
  )
}

export function RestartIcon({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path {...stroke} d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path {...stroke} d="M19.6 3.6v4.2h-4.2" />
    </svg>
  )
}
