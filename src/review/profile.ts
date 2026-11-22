import type { PlacementConstraint } from './placement.ts'
import type { NavigationOptions } from './navigation.ts'

export type Hinge = 'min' | 'max'
export type MotionPlan =
  | { entityId: string; kind: 'cabinet'; hinges: Hinge[] }
  | { entityId: string; kind: 'appliance'; axis: 'x' | 'y'; hinge: Hinge }
  | { entityId: string; kind: 'pullout'; distanceMm: number }

export interface ReviewProfile {
  id: string
  apartmentId?: string
  placement: PlacementConstraint[]
  navigation?: NavigationOptions
  motions?: MotionPlan[]
  /** Unresolved decisions stay visible; they are not suppressed test failures. */
  manualReview?: string[]
}
