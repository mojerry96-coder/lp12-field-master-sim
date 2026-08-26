/**
 * Vehicle asset registry, brief section 21.
 *
 * Ten files, one per vehicle type, each carrying LOD0/LOD1/LOD2 as sibling
 * nodes. One request per type rather than three, and the level is chosen at
 * runtime by distance without a second fetch.
 *
 * The environment GLB deliberately does NOT contain these. The environment
 * merges its geometry because none of it repeats; the vehicles repeat
 * constantly — 36 instances across ten meshes — so they load once and clone.
 */

export const VEHICLE_ASSETS = {
  VEH_BUS_CITY_01:    '/models/vehicles/veh_bus_city_01.glb',
  VEH_TRUCK_SEMI_01:  '/models/vehicles/veh_truck_semi_01.glb',
  VEH_TRUCK_BOX_01:   '/models/vehicles/veh_truck_box_01.glb',
  VEH_TRUCK_PANEL_01: '/models/vehicles/veh_truck_panel_01.glb',
  VEH_VAN_CARGO_01:   '/models/vehicles/veh_van_cargo_01.glb',
  VEH_CAR_SEDAN_01:   '/models/vehicles/veh_car_sedan_01.glb',
  VEH_CAR_COMPACT_01: '/models/vehicles/veh_car_compact_01.glb',
  VEH_CAR_COUPE_01:   '/models/vehicles/veh_car_coupe_01.glb',
  VEH_SCOOTER_01:     '/models/vehicles/veh_scooter_01.glb',
  VEH_E_SCOOTER_01:   '/models/vehicles/veh_e_scooter_01.glb',
}

export const VEHICLE_PLACEMENTS_URL = '/models/vehicles/vehicle_placements.json'

/**
 * Body colours for the variation system, section 13.
 *
 * Applied as a material override on each clone rather than baked into the mesh.
 * A mesh per colour would multiply the library by five for no geometric
 * difference at all, and the clones already share their source geometry.
 */
export const VEHICLE_VARIANTS = {
  MAT_VEHICLE_OFFWHITE: '#F2F1EC',
  MAT_VEHICLE_BLUE:     '#4C6FDC',
  MAT_VEHICLE_YELLOW:   '#D9B457',
  MAT_VEHICLE_RED:      '#B85B54',
}

/**
 * Distance bands for LOD selection, section 21.
 *
 * Measured from the camera to the vehicle. The near band is generous because
 * the studio anchors sit between 4 and 33 m from the pole, so most of the
 * traffic a learner ever looks at closely is inside it; past 120 m a vehicle is
 * a few pixels wide and LOD2's outline is all that survives anyway.
 */
export const LOD_BANDS = { near: 55, mid: 120 }

export function lodForDistance(d) {
  if (d < LOD_BANDS.near) return 0
  if (d < LOD_BANDS.mid) return 1
  return 2
}
