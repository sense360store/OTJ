// The club's two real venue areas, exactly as the owner drew them and
// exactly as migration 0043 seeds them. Test fixtures only, never a
// runtime source: the app reads venue_areas. The vertices are a visual
// approximation of the usable green, treated as given; do not resurvey or
// correct them.
import type { Boundary } from './venues'

// Flushdyke, about 2,260 m².
export const FLUSHDYKE: Boundary = [
  [53.68568155, -1.56218739],
  [53.68529301, -1.56243823],
  [53.68517449, -1.56162951],
  [53.68550302, -1.56145621],
]

// Haggs Hill main field, about 7,445 m².
export const HAGGS_HILL: Boundary = [
  [53.67594325, -1.5545456],
  [53.67614254, -1.55348528],
  [53.67696607, -1.55416899],
  [53.67681938, -1.55521524],
]
