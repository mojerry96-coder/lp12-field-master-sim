# Preserved environment assets

The hybrid build replaced the 3D environment with a background image, so these
are no longer served on the LP12 route. They are kept (not deleted) per the
hybrid brief, and moved out of `public/` only so they cannot be fetched and do
not bloat the production bundle.

- awolowo_day.glb / awolowo_night.glb — full 3D corridor
- environment.json — environment manifest

Source of truth remains ../../env_deliverables/.
