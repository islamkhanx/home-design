import type { Apartment, Entity } from './schema.ts'
import { parseApartment } from './schema.ts'

export const ELECTRICAL_KINDS = ['Socket', 'Switch']
/** Locations are a design proposal; no cable routes, ratings or compliance claim. */
export function generateElectrical(input: Apartment): Apartment {
  const a = structuredClone(input)
  a.objects = a.objects.filter((o) => !(o.generated && o.electrical))
  a.revision = 7
  const note =
    'Электрика: автоматическое предложение. Высоты до центра от условного чистого пола; сверить по обмерам, мебели и инженерному проекту. Трассы и защита не назначены.'
  if (!a.notes.includes(note)) a.notes.push(note)
  const mount = (
    id: string,
    roomId: string,
    kind: 'Socket' | 'Switch',
    wallId: string,
    offset: number,
    height: number,
    side: 1 | -1,
    gangs: number,
    purpose: string,
    controls: string[] = [],
  ) => {
    const host = a.objects.find((o) => o.id === wallId)!,
      wall = host.wall!
    const dx = wall.end[0] - wall.start[0],
      dz = wall.end[1] - wall.start[1],
      len = Math.hypot(dx, dz)
    const nx = (-dz / len) * side,
      nz = (dx / len) * side,
      depth = 14,
      width = gangs * 71 + 10
    if (offset - width / 2 < 0 || offset + width / 2 > len)
      throw new Error(`${id}: outside host wall`)
    if (
      wall.openings.some(
        (q) =>
          offset + width / 2 > q.offset &&
          offset - width / 2 < q.offset + q.width &&
          height + 40 > q.bottom &&
          height - 40 < q.bottom + q.height,
      )
    )
      throw new Error(`${id}: intersects opening`)
    const distance = wall.thickness / 2 + depth / 2 + 1
    const o: Entity = {
      id,
      name: purpose,
      kind,
      roomId,
      position: [
        wall.start[0] + (dx / len) * offset + nx * distance,
        height - 40,
        wall.start[1] + (dz / len) * offset + nz * distance,
      ],
      rotation: [0, (Math.atan2(nx, nz) * 180) / Math.PI || 0, 0],
      size: [width, 80, depth],
      material: 'paint',
      evidence: 'assumed',
      generated: true,
      note,
      electrical: { wallId, offset, side, gangs, purpose, controls },
    }
    a.objects.push(o)
  }
  const atZ = (wallId: string, z: number) =>
    z - a.objects.find((o) => o.id === wallId)!.wall!.start[1]
  mount(
    'E01',
    'bathroom',
    'Socket',
    'wall-west',
    atZ('wall-west', 1400),
    1100,
    -1,
    2,
    'Тумба · две розетки, зоны проверить',
  )
  mount(
    'E02',
    'bathroom',
    'Socket',
    'wall-east',
    atZ('wall-east', 2200),
    1250,
    1,
    1,
    'Стиральная машина · доступный отсек колонны',
  )
  mount(
    'S01',
    'hall',
    'Switch',
    'wall-east',
    atZ('wall-east', 2000),
    900,
    -1,
    2,
    'Санузел · свет и зеркало',
    ['spot-0', 'spot-1', 'mirror-light-0', 'mirror-light-1'],
  )
  mount(
    'E03',
    'kitchen',
    'Socket',
    'source-kitchen-west',
    atZ('source-kitchen-west', 3700),
    1100,
    -1,
    2,
    'Рабочая поверхность · блок 1',
  )
  mount(
    'E04',
    'kitchen',
    'Socket',
    'source-kitchen-west',
    atZ('source-kitchen-west', 4900),
    1100,
    -1,
    2,
    'Рабочая поверхность · блок 2',
  )
  mount(
    'E05',
    'kitchen',
    'Socket',
    'source-kitchen-west',
    atZ('source-kitchen-west', 4000),
    300,
    -1,
    1,
    'Духовка · соседний отсек, доступ уточнить',
  )
  mount(
    'E06',
    'kitchen',
    'Socket',
    'source-kitchen-west',
    atZ('source-kitchen-west', 5280),
    300,
    -1,
    1,
    'Холодильник · доступ уточнить',
  )
  mount(
    'E07',
    'kitchen',
    'Socket',
    'source-kitchen-west',
    atZ('source-kitchen-west', 4350),
    2200,
    -1,
    1,
    'Вытяжка · модель уточнить',
  )
  mount(
    'E08',
    'living',
    'Socket',
    'source-living-west',
    atZ('source-living-west', 7300),
    1200,
    -1,
    3,
    'ТВ и медиатехника',
  )
  mount(
    'E09',
    'living',
    'Socket',
    'source-living-west',
    atZ('source-living-west', 9000),
    950,
    -1,
    3,
    'Рабочее место',
  )
  mount(
    'E10',
    'living',
    'Socket',
    'source-living-west',
    atZ('source-living-west', 6400),
    300,
    -1,
    1,
    'Уборка / свободная розетка',
  )
  mount(
    'E11',
    'living',
    'Socket',
    'source-living-east',
    atZ('source-living-east', 7700),
    450,
    1,
    2,
    'У дивана',
  )
  mount(
    'E12',
    'living',
    'Socket',
    'source-living-east',
    atZ('source-living-east', 4600),
    300,
    1,
    1,
    'У обеденной зоны',
  )
  mount(
    'S02',
    'living',
    'Switch',
    'source-living-east',
    atZ('source-living-east', 2750),
    900,
    1,
    3,
    'Гостиная / стол / кухня',
    ['auto-living-Основной свет', 'auto-living-Подвес над столом', 'auto-kitchen-Основной свет'],
  )
  mount(
    'E13',
    'bedroom',
    'Socket',
    'source-bedroom-west',
    atZ('source-bedroom-west', -3750),
    650,
    -1,
    2,
    'Прикроватный блок 1',
  )
  mount(
    'E14',
    'bedroom',
    'Socket',
    'source-bedroom-west',
    atZ('source-bedroom-west', -1750),
    650,
    -1,
    2,
    'Прикроватный блок 2',
  )
  mount(
    'E15',
    'bedroom',
    'Socket',
    'source-bedroom-east',
    atZ('source-bedroom-east', -2750),
    1200,
    1,
    3,
    'ТВ в спальне',
  )
  mount(
    'E16',
    'bedroom',
    'Socket',
    'source-bedroom-west',
    atZ('source-bedroom-west', -1050),
    300,
    -1,
    1,
    'Свободная розетка спальни',
  )
  mount(
    'S03',
    'bedroom',
    'Switch',
    'source-bedroom-entry',
    1150,
    900,
    -1,
    1,
    'Спальня · основной свет',
    ['auto-bedroom-Основной свет', 'auto-bedroom-Подвес'],
  )
  mount(
    'E17',
    'hall',
    'Socket',
    'source-hall-north',
    400,
    300,
    1,
    1,
    'Прихожая · свободная розетка',
  )
  mount('S04', 'hall', 'Switch', 'source-entry', 1550, 900, 1, 1, 'Прихожая · основной свет', [
    'auto-hall-Основной свет',
  ])
  mount(
    'E18',
    'loggia',
    'Socket',
    'source-loggia-west',
    atZ('source-loggia-west', -4750),
    300,
    -1,
    1,
    'Лоджия · исполнение по условиям эксплуатации',
  )
  mount(
    'S05',
    'loggia',
    'Switch',
    'source-loggia-access',
    3050,
    900,
    -1,
    1,
    'Лоджия · основной свет',
    ['auto-loggia-Основной свет'],
  )
  return parseApartment(a)
}
