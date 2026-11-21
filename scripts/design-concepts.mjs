import { createHash } from 'node:crypto'
import { architecturalSnapshot } from '../src/domain/design-composition.ts'
export { architecturalSnapshot, entityBox, featurePanels, applyConceptComposition } from '../src/domain/design-composition.ts'
export { DESIGN_CONCEPTS } from '../src/domain/design-variants.ts'

export const architectureFingerprint = apartment => createHash('sha256').update(JSON.stringify(architecturalSnapshot(apartment))).digest('hex')
