import type { Apartment, Entity, MaterialDef } from './schema.ts'
import budget from '../data/bathroom-budget.json' with { type: 'json' }
import spec from '../../docs/bathroom-spec.json' with { type: 'json' }

/** Apply the current bathroom procurement proposal without rebuilding architecture. */
export function applyBathroomPlan(input: Apartment): Apartment {
  const a = structuredClone(input)
  a.costPlanId = budget.id
  a.revision = Math.max(a.revision, 10)
  const finishes: MaterialDef[] = [
    {
      id: 'bathroom-light',
      name: 'Санузел · 4000 K · визуальное приближение',
      color: '#fff1e5',
      roughness: 0.5,
      metalness: 0,
      emissive: '#ffe4ce',
      emissiveIntensity: 1,
    },
    {
      id: 'bathroom-stone',
      name: 'Laparet Noa · кремовый · стены 60×120',
      color: '#ffffff',
      roughness: 0.82,
      metalness: 0,
      surface: 'stone',
      tileSize: [1.2, 0.6],
      texture: '/textures/laparet-noa/wall.jpg',
    },
    {
      id: 'floor-stone',
      name: 'Laparet Noa · кремовый · пол 60×60',
      color: '#ffffff',
      roughness: 0.82,
      metalness: 0,
      surface: 'stone',
      tileSize: [0.6, 0.6],
      texture: '/textures/laparet-noa/floor.jpg',
    },
  ]
  for (const material of finishes) {
    const i = a.materials.findIndex((m) => m.id === material.id)
    if (i < 0) a.materials.push(material)
    else a.materials[i] = material
  }
  // Face-specific finishes keep bathroom tile off the adjacent room's wall,
  // regardless of which room owns the shared wall entity.
  for (const o of a.objects)
    if (o.wall?.materials)
      for (const face of ['left', 'right', 'edge'] as const)
        if (o.wall.materials[face] === 'stone') o.wall.materials[face] = 'bathroom-stone'
  for (const o of a.objects.filter((o) => o.roomId === 'bathroom')) {
    if (o.kind === 'Floor') o.material = 'floor-stone'
    else if (o.material === 'stone') o.material = 'bathroom-stone'
    if (o.kind === 'LEDStrip' || o.kind === 'Spotlight') {
      const mirror = o.params?.group === 'mirror'
      o.params = {
        ...o.params,
        color: '#ffe4ce',
        lumens: mirror
          ? spec.working_lighting.mirror.lumens_each
          : spec.working_lighting.general.lumens_each,
      }
      if (o.kind === 'LEDStrip') o.material = 'bathroom-light'
      o.note =
        'Рабочий выбор: 4000 K, CRI ≥90, G1/G2 отдельно; зеркало диммируется. Световой поток предварительный; монтажные зоны и модель по обмеру. RGB — визуальное приближение, не фотометрия.'
    }
  }
  const fixtures: Entity[] = [
    {
      id: 'hygienic-shower',
      name: 'Гигиенический душ · обязательный',
      kind: 'Shower',
      roomId: 'bathroom',
      position: [230, 480, 2020],
      size: [180, 450, 100],
      rotation: [0, 90, 0],
      material: 'metal',
      evidence: 'assumed',
      params: { fixture: 'hygienicShower' },
      note: 'Наличие подтверждено 15.11.2026. Показано предварительное размещение у WC; модель, трасса, высота и сервисный доступ требуют проверки.',
    },
    {
      id: 'towel-warmer',
      name: 'Полотенцесушитель · кандидат 500×800',
      kind: 'Shelf',
      roomId: 'bathroom',
      position: [800, 850, 2372],
      size: [500, 800, 80],
      rotation: [0, 180, 0],
      material: 'white',
      evidence: 'assumed',
      params: { fixture: 'towelWarmer' },
      note: 'Наличие подтверждено; Equation 500×800 в смете — кандидат. Размещение и питание предварительные, проверить по обмеру.',
    },
  ]
  // Keep fixed bathroom fixtures before generated electrical points, so regeneration
  // is deterministic without moving existing, user-adjusted fixture coordinates.
  const ids = new Set(fixtures.map((o) => o.id))
  const current = fixtures.map((o) => a.objects.find((existing) => existing.id === o.id) ?? o)
  a.objects = a.objects.filter((o) => !ids.has(o.id))
  const electricalStart = a.objects.findIndex((o) => o.generated && o.electrical)
  a.objects.splice(electricalStart < 0 ? a.objects.length : electricalStart, 0, ...current)
  const note =
    'Смета Алматы 15.11.2026: гигиенический душ и работы обязательны; Laparet Noa показан фотографиями товара. Модели, монтажные привязки и количества требуют проверки; изображения не заменяют физический образец.'
  if (!a.notes.includes(note)) a.notes.push(note)
  return a
}
