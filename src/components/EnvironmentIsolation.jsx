/**
 * Environment isolation.
 *
 * Section 2.4 / 6 of the build specification: pressing Begin Installation takes
 * the city to zero, not to a blur. Buildings, roads, cars, trees and street
 * furniture go; the pole and the LP12 stay. A blurred city is still a city
 * competing for attention with the component being fitted, which is exactly
 * what the isolation exists to stop.
 *
 * Wrapping rather than unmounting, because the environment comes back on the
 * network-coverage page and remounting it there would pay the GLB's setup cost
 * a second time. `pointerEvents` follows the opacity so an invisible city can
 * never intercept a drop meant for the pole.
 */
export default function EnvironmentIsolation({ isolated, children }) {
  return (
    <div
      aria-hidden={isolated ? 'true' : undefined}
      style={{
        position: 'absolute',
        inset: 0,
        opacity: isolated ? 0 : 1,
        transition: 'opacity 520ms cubic-bezier(.22,1,.36,1)',
        pointerEvents: isolated ? 'none' : 'auto',
      }}
    >
      {children}
    </div>
  )
}
