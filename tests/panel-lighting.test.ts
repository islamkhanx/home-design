import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { entityBox, featurePanels } from '../src/domain/design-composition.ts'
import type { StudyRoom } from '../src/domain/design-composition.ts'
import { DESIGN_STUDIES } from '../src/domain/design-studies.ts'
import { pointInPolygon } from '../src/domain/math.ts'
import { parseApartment } from '../src/domain/schema.ts'

test('veneered wall panels reserve room for continuous and side light profiles', () => {
  const source = parseApartment(JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')))
  const base = DESIGN_STUDIES.find(study => study.id === 'atelier-walnut')!
  const study = {
    ...base,
    wallLight: false,
    panelLighting: { layout: 'outline' as const, rooms: ['living', 'bedroom'] },
  }
  for (const id of ['living', 'bedroom', 'hall']) {
    const room = source.rooms.find(item => item.id === id && item.polygon) as StudyRoom
    const { objects } = featurePanels(source, room, study, 'oak', {})
    const strips = objects.filter(object => object.kind === 'LEDStrip')
    const panels = objects.filter(object => object.kind === 'WallPanel')
    assert.equal(strips.length, id === 'hall' ? 0 : 3, id)
    for (const strip of strips) {
      const box = entityBox(strip)
      const collisions = [...panels, ...source.objects.filter(object => object.electrical)]
        .map(entityBox)
        .filter(other => box.min.every((min, axis) => min < other.max[axis] && box.max[axis] > other.min[axis]))
      assert.equal(collisions.length, 0, strip.id)
      assert.ok(box.corners.every(point => pointInPolygon(point, room.polygon)), strip.id)
      assert.equal(strip.params?.group, 'accent')
      const continuous = strip.id.endsWith('underline')
      assert.ok(continuous ? strip.size[0] >= 1800 : strip.size[1] >= 1000, strip.id)
    }
  }
})
