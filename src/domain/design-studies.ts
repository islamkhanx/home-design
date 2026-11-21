import { deg } from './math.ts'
import type { V3 } from './math.ts'
import type { DesignConcept, MaterialFinish } from './design-composition.ts'
import type { Entity, MaterialDef } from './schema.ts'

const finish = (
  color: string,
  surface: MaterialDef['surface'] = 'plain',
  roughness = 0.85,
  metalness = 0,
): MaterialFinish => ({ color, surface, roughness, metalness })

/** The existing integrated kitchen remains one run. Contrast the appliance
 * fronts and tall cabinets as a group, aligned with the units below them. */
const steelKitchen: NonNullable<DesignConcept['scene']> = (apartment, room, materials) => {
  if (room.id !== 'kitchen') return
  for (const object of apartment.objects.filter((object) => object.roomId === room.id)) {
    const integrated = object.kind === 'Appliance' && object.params?.integrated
    const fascia =
      object.kind === 'Countertop' &&
      object.params?.fixture === 'joineryPanel' &&
      object.position[1] < 900
    if (integrated || object.kind === 'KitchenCabinet' || fascia) {
      object.material = materials.get('metal') ?? object.material
    } else if (object.kind === 'Wardrobe') {
      object.material = materials.get('oak') ?? object.material
    }
  }
}

const gradedJoinery: NonNullable<DesignConcept['scene']> = (apartment, room, materials) => {
  for (const object of apartment.objects.filter((object) => object.roomId === room.id)) {
    const joinery =
      ['KitchenCabinet', 'Wardrobe'].includes(object.kind) ||
      (object.kind === 'Appliance' && object.params?.integrated) ||
      (object.kind === 'Countertop' &&
        object.params?.fixture === 'joineryPanel' &&
        object.material === materials.get('paint'))
    if (joinery && object.position[1] + object.size[1] <= 920) {
      object.material = materials.get('sage') ?? object.material
    }
  }
}

type JoineryFinish = 'oak' | 'ink'

/** Paint remains a wall finish. The two cabinet banks, appliance fronts and
 * matching edge panels are assigned by their role in the joinery run. */
function contrastJoinery({
  kitchenBase,
  kitchenTop,
  bedroom,
  hall,
  media,
}: {
  kitchenBase: JoineryFinish
  kitchenTop: JoineryFinish
  bedroom: JoineryFinish
  hall: JoineryFinish
  media: JoineryFinish
}): NonNullable<DesignConcept['scene']> {
  return (apartment, room, materials) => {
    if (!['living', 'kitchen', 'bedroom', 'hall'].includes(room.id)) return
    for (const object of apartment.objects) {
      if (object.roomId !== room.id || object.sharedWith?.includes('bathroom')) continue
      const integrated = object.kind === 'Appliance' && object.params?.integrated === true
      const matchingPanel =
        object.kind === 'Countertop' &&
        object.params?.fixture === 'joineryPanel' &&
        object.material === materials.get('paint')
      if (
        !integrated &&
        !matchingPanel &&
        object.kind !== 'KitchenCabinet' &&
        object.kind !== 'Wardrobe'
      )
        continue

      let finish: JoineryFinish
      if (room.id === 'kitchen') {
        const belowWorktop = object.position[1] + object.size[1] <= 920
        finish = belowWorktop ? kitchenBase : kitchenTop
      } else if (room.id === 'living') finish = media
      else finish = room.id === 'bedroom' ? bedroom : hall

      object.material = materials.get(finish) ?? object.material
    }
  }
}

function warmDiffuser(color: string, intensity: number): MaterialFinish {
  return { ...finish('#fff3db', 'plain', 0.35), emissive: color, emissiveIntensity: intensity }
}

const redDiningSeat: NonNullable<DesignConcept['scene']> = (apartment, room, materials) => {
  if (room.id !== 'living') return
  for (const object of apartment.objects.filter((object) => object.roomId === room.id)) {
    if (object.params?.fixture === 'diningChair' || object.id.endsWith('-Обеденный стол')) {
      object.material = materials.get('sage') ?? object.material
    }
    if (object.kind === 'Sofa' && object.params?.fixture === undefined) {
      object.material = materials.get('linen') ?? object.material
    }
  }
}

const deskInClay: NonNullable<DesignConcept['scene']> = (apartment, room, materials) => {
  if (room.id !== 'living') return
  const desk = apartment.objects.find(
    (object) => object.roomId === room.id && object.id.endsWith('-Рабочий стол'),
  )
  if (desk) desk.material = materials.get('sage') ?? desk.material
}

const mirrorWall: NonNullable<DesignConcept['scene']> = (apartment, room, materials) => {
  // A single panoramic reflector is enough to illustrate the idea during a walk.
  if (room.id !== 'living') return
  const panel = apartment.objects.find(
    (object) =>
      object.roomId === room.id &&
      object.kind === 'WallPanel' &&
      object.material === materials.get('feature'),
  )
  if (panel && apartment.materials.some((material) => material.id === 'mirror'))
    panel.material = 'mirror'
}

/** Dress one wall as a small display library. Fit the backing, shelf and
 * face-out books inside the previously checked decorative panel envelope. */
const faceOutLibrary: NonNullable<DesignConcept['scene']> = (apartment, room, materials) => {
  if (room.id !== 'living' && room.id !== 'bedroom') return
  const panels = apartment.objects.filter(
    (object) =>
      object.roomId === room.id &&
      object.kind === 'WallPanel' &&
      object.material === materials.get('feature'),
  )
  if (panels.length === 0) return
  const panel = panels.reduce((largest, candidate) =>
    candidate.size[0] > largest.size[0] ? candidate : largest,
  )
  const [width, height, depth] = panel.size
  if (width < 800 || height < 700 || depth < 70) return
  const angle = deg(panel.rotation[1])
  const [x, y, z] = panel.position
  const local = (dx: number, dy: number, dz: number): V3 => [
    x + Math.cos(angle) * dx + Math.sin(angle) * dz,
    y + dy,
    z - Math.sin(angle) * dx + Math.cos(angle) * dz,
  ]
  const railDepth = depth - 12
  const shelf: Entity = {
    ...panel,
    id: panel.id + '-shelf',
    kind: 'Shelf',
    name: 'Книжные полки вдоль стены',
    position: local(0, 0, 6),
    size: [width - 18, height, railDepth],
    params: { designStyle: 'hitech', shelves: 3 },
    material: materials.get('oak') ?? panel.material,
  }
  const colours = ['sage', 'linen', 'ink', 'stone', 'rug']
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 5; col++) {
      const pageWidth = Math.min(100 + (col % 3) * 17, width / 9)
      const book: Entity = {
        id: `${shelf.id}-book-${row}-${col}`,
        kind: 'Countertop',
        name: 'Книга на выставочной полке',
        roomId: room.id,
        evidence: 'assumed',
        generated: true,
        position: local(
          ((col - 2) * width) / 7,
          25 + (row * (height - 25)) / 2,
          14 + (col % 2) * 4,
        ),
        rotation: [...panel.rotation],
        size: [pageWidth, 125 + (col % 4) * 35, 16 + (col % 3) * 5],
        material: materials.get(colours[(row * 2 + col) % colours.length]) ?? shelf.material,
        params: { fixture: 'joineryPanel' },
      }
      apartment.objects.push(book)
    }
  }
  panel.position = local(0, 0, -depth / 2 + 5)
  panel.size = [width, height, 10]
  apartment.objects.push(shelf)
}

export const DESIGN_STUDIES: DesignConcept[] = [
  {
    id: 'birch-steel',
    designStyle: 'hitech',
    label: 'Берёза и сталь',
    description:
      'Спокойная берёзовая мебель вокруг отражающего стального блока. Мелкое терраццо собирает общую зону в одно целое.',
    swatches: ['#d0ae7a', '#acb9bf', '#cecabf'],
    reference: {
      title: 'M02',
      studio: 'MINIMO',
      url: 'https://www.archdaily.com/931921/m02-minimo',
      lesson:
        'В двух квартирах по 45 м² берёзовая столярка задаёт границы зон, а стальной объём работает со светом. Здесь этот приём перенесён на встроенную кухню и отражающие вставки.',
    },
    features: {
      walls: 'Три узкие вставки из шлифованного металла на светлой штукатурке',
      furniture: 'Тонкие рамы, берёзовый верх гарнитура и стальной рабочий ряд',
      lighting: 'Линейный потолочный свет и плоский диск над столом',
      materials: 'Берёзовый шпон, шлифованная сталь и терраццо',
    },
    materials: {
      paint: finish('#e9e3d6', 'plaster'),
      oak: finish('#d8b981', 'oak', 0.55),
      'floor-oak': finish('#d1cfc3', 'terrazzo', 0.57),
      linen: finish('#d7d3c7'),
      sage: finish('#68776a'),
      rug: finish('#b0ab93'),
      stone: finish('#cacdcb', 'brushed-metal', 0.34, 0.82),
      metal: finish('#b9c5c7', 'brushed-metal', 0.32, 0.88),
      ink: finish('#30383b', 'plain', 0.46, 0.35),
    },
    featureMaterial: finish('#c1cbcd', 'brushed-metal', 0.37, 0.82),
    treatment: 'flat',
    panelWidth: 2420,
    panelDepth: 15,
    panelParts: 3,
    panelGap: 24,
    panelBottom: 1140,
    panelHeight: 1350,
    lighting: { preset: 'clean', label: 'Нейтральный свет по стальным поверхностям' },
    color: '#fff0db',
    generalLumens: 2350,
    accentLumens: 620,
    generalKind: 'TrackLight',
    generalSize: [1210, 100, 100],
    cabinetFace: 'recessed',
    furnitureForms: { Sofa: 'open-frame', Table: 'open-frame' },
    accentLightForm: 'disc',
    accentSize: [420, 420],
    scene: steelKitchen,
  },
  {
    id: 'olive-cherry',
    designStyle: 'classic',
    label: 'Олива и вишня',
    description:
      'Зелёный минеральный пол с красноватой вишней и сливочной обивкой. Геометрия панелей отсылает к модернизму 1930-х.',
    swatches: ['#687353', '#a25c3a', '#eece94'],
    reference: {
      title: 'Apartamento PSDL19',
      studio: 'EstudioReciente',
      url: 'https://www.archdaily.com/976127/apartamento-psdl19-estudioreciente',
      lesson:
        'Зелёный известковый пол объединяет общую зону PSDL19. В нашем варианте зелёная линия соединяет прихожую, кухню и гостиную, а тёплое дерево отмечает хранение.',
    },
    features: {
      walls: 'Вишнёвая панель с горизонтальным поясом и участками сливочной штукатурки',
      furniture: 'Низкие оливковые фасады, тёплые деревянные филёнки и мягкие кресла',
      lighting: 'Опаловые шары и тёплый подвес над столом',
      materials: 'Минеральный пол, вишнёвый шпон, тёплая латунь, шерсть',
    },
    materials: {
      paint: finish('#dfd9c0', 'plaster'),
      oak: finish('#9a5938', 'oak', 0.52),
      'floor-oak': finish('#828b61', 'concrete', 0.73),
      linen: finish('#d0ad80'),
      sage: finish('#64744b'),
      rug: finish('#d4b67e'),
      stone: finish('#e2d4ae', 'stone', 0.62),
      metal: finish('#a68250', 'brushed-metal', 0.4, 0.74),
      ink: finish('#57382b'),
      'ceiling-white': finish('#f0e7d1'),
    },
    roomMaterials: {
      bedroom: { 'floor-oak': finish('#976b4a', 'herringbone', 0.7), linen: finish('#aac0bf') },
    },
    featureMaterial: finish('#d6ad6f', 'oak', 0.58),
    treatment: 'band',
    panelWidth: 2310,
    panelDepth: 31,
    panelParts: 2,
    panelGap: 26,
    panelBottom: 1010,
    panelHeight: 1340,
    lighting: { preset: 'clean', label: 'Мягкий тёплый свет, 2800 K' },
    color: '#ffdbac',
    generalLumens: 1680,
    accentLumens: 520,
    generalKind: 'Pendant',
    generalSize: [420, 480, 420],
    cabinetFace: 'split',
    furnitureForms: { Sofa: 'club', Table: 'sculptural' },
    lightForm: 'opal',
    accentLightForm: 'cluster',
    fixtureMaterial: 'metal',
    scene: gradedJoinery,
  },
  {
    id: 'mint-library',
    designStyle: 'hitech',
    label: 'Мятная библиотека',
    description:
      'Книжная полка вместо отдельной картины. Мятные фасады, берёза и тёплый паркет связывают рабочую зону с гостиной.',
    swatches: ['#8fbba7', '#c4a274', '#b95138'],
    reference: {
      title: 'Menta Renovation',
      studio: 'gon architects',
      url: 'https://www.archdaily.com/1002272/menta-renovation-gon-architects',
      lesson:
        'Периметральные шкафы в квартире 46 м² освобождают центр комнаты. Здесь используем те же принципы с неглубокими книжными полками, берёзой и мятными фасадами.',
    },
    features: {
      walls: 'Неглубокие выставочные полки над диваном и деревянные вставки',
      furniture: 'Закрытые мятные шкафы по периметру, берёзовые столы и низкая обивка',
      lighting: 'Монтажная рейка и опаловый подвес',
      materials: 'Мятный ламинат, берёза, паркет ёлочкой и красный акцент',
    },
    materials: {
      paint: finish('#c8ddce', 'plaster'),
      oak: finish('#c9a770', 'oak', 0.61),
      'floor-oak': finish('#b68d57', 'herringbone', 0.73),
      linen: finish('#d3a57a'),
      sage: finish('#6f9b87'),
      rug: finish('#b46c4f'),
      stone: finish('#ddc7a3', 'stone', 0.64),
      ink: finish('#414f4c'),
      metal: finish('#888f82', 'plain', 0.38, 0.68),
    },
    roomMaterials: { kitchen: { paint: finish('#92c3ae', 'plain', 0.5) } },
    featureMaterial: finish('#8ebaa2', 'plain', 0.6),
    treatment: 'flat',
    panelWidth: 1970,
    panelDepth: 106,
    panelParts: 1,
    panelBottom: 1120,
    panelHeight: 1260,
    lighting: { preset: 'clean', label: 'Общий нейтральный свет и тёплая зона чтения' },
    color: '#ffe5c1',
    generalLumens: 2180,
    accentLumens: 540,
    generalKind: 'TrackLight',
    generalSize: [1200, 105, 100],
    cabinetFace: 'split',
    furnitureForms: { Sofa: 'low-slung', Table: 'open-frame' },
    accentLightForm: 'opal',
    accentSize: [300, 300],
    scene: faceOutLibrary,
  },
  {
    id: 'cobalt-route',
    designStyle: 'hitech',
    label: 'Кобальтовый маршрут',
    description:
      'Синяя полоса пола ведёт от входа к обеденному столу. Пастельная штукатурка, стальной гарнитур и янтарная посадка обрамляют маршрут.',
    swatches: ['#294caa', '#c1b9ae', '#cf783a'],
    reference: {
      title: 'Tokyo Blue Apartment Renovation',
      studio: 'ROOVICE',
      url: 'https://www.archdaily.com/1015406/tokyo-blue-apartment-renovation-roovice',
      lesson:
        'Синий пол ведёт от входа к кухне, рядом с ним матовый минеральный пол и нержавеющая сталь. В этой квартире цвет выделяет маршрут между прихожей, кухней и столом.',
    },
    features: {
      walls: 'Узкие синие глазурованные плиточные вставки и световые швы',
      furniture: 'Лаконичные стальные рамы, янтарная обивка и светлые плоскости',
      lighting: 'Холоднее в зоне готовки и линейный свет над столом',
      materials: 'Кобальтовый модульный пол, сталь, молочная глазурь',
    },
    materials: {
      paint: finish('#e8e6dc', 'plaster'),
      oak: finish('#d3ccc2', 'plain', 0.54),
      'floor-oak': finish('#bdbaad', 'concrete', 0.75),
      linen: finish('#e6b177'),
      sage: finish('#bb6a32'),
      rug: finish('#b2ada3'),
      stone: finish('#c5cfd0', 'brushed-metal', 0.36, 0.81),
      metal: finish('#b8c1c4', 'brushed-metal', 0.36, 0.8),
      ink: finish('#36465c'),
    },
    roomMaterials: {
      kitchen: {
        'floor-oak': finish('#3159b2', 'glazed-tile', 0.62),
        paint: finish('#c9d8db', 'plain', 0.62),
      },
      hall: { 'floor-oak': finish('#3159b2', 'glazed-tile', 0.62) },
    },
    featureMaterial: finish('#3659a0', 'glazed-tile', 0.4),
    treatment: 'flat',
    panelWidth: 2450,
    panelDepth: 18,
    panelParts: 3,
    panelGap: 70,
    panelBottom: 1080,
    panelHeight: 1480,
    wallLight: true,
    lighting: { preset: 'clean', label: 'Линейный рабочий свет, 4000 K' },
    color: '#e6efff',
    generalLumens: 2260,
    accentLumens: 650,
    generalKind: 'TrackLight',
    generalSize: [1350, 90, 110],
    cabinetFace: 'recessed',
    furnitureForms: { Sofa: 'open-frame', Table: 'sculptural' },
    accentLightForm: 'disc',
    accentSize: [450, 450],
    scene: steelKitchen,
  },
  {
    id: 'clay-arch',
    designStyle: 'japandi',
    label: 'Глина и арки',
    description:
      'Тёплые стены с глиняной фактурой, арочная композиция и терракотовый рабочий стол. По мягкому пробковому полу проходит свет от широкого диска.',
    swatches: ['#dab38d', '#ad5738', '#8d5f39'],
    reference: {
      title: 'Ruiz Apartment',
      studio: 'StudioMadera',
      url: 'https://www.archdaily.com/1055203/ruiz-apartment-studiomadera',
      lesson:
        'Глиняная штукатурка и единая столярная композиция организуют квартиру 50 м². Терракотовую рабочую нишу переносим в существующее место у окна.',
    },
    features: {
      walls: 'Глиняный фон и две неглубокие арочные панели',
      furniture: 'Терракотовый рабочий стол, низкая посадка и тёплые фасады',
      lighting: 'Широкий матовый диск и рельефный керамический подвес',
      materials: 'Глиняная штукатурка, пробка, терракота, орех',
    },
    materials: {
      paint: finish('#dfb897', 'plaster', 0.96),
      oak: finish('#93643e', 'oak', 0.66),
      'floor-oak': finish('#b78e67', 'cork', 0.89),
      linen: finish('#ddc4a6'),
      sage: finish('#aa593e'),
      rug: finish('#d3a478'),
      stone: finish('#d29371', 'glazed-tile', 0.51),
      metal: finish('#857556', 'brushed-metal', 0.5, 0.63),
      ink: finish('#49392f'),
      'ceiling-white': finish('#f0e0ca', 'plaster'),
    },
    roomMaterials: {
      kitchen: {
        paint: finish('#d5a17d', 'plain', 0.78),
        'floor-oak': finish('#ad6f52', 'glazed-tile', 0.73),
      },
    },
    featureMaterial: finish('#ba7758', 'plaster', 0.96),
    treatment: 'arch',
    panelWidth: 2420,
    panelDepth: 28,
    panelParts: 2,
    panelGap: 72,
    panelBottom: 1030,
    panelHeight: 1550,
    lighting: { preset: 'clean', label: 'Рассеянный тёплый свет по штукатурке' },
    color: '#ffe1b5',
    generalLumens: 1740,
    accentLumens: 540,
    generalKind: 'Pendant',
    generalSize: [530, 430, 530],
    cabinetFace: 'recessed',
    furnitureForms: { Sofa: 'low-slung', Bed: 'low-slung', Table: 'sculptural' },
    lightForm: 'disc',
    accentLightForm: 'ribbed',
    fixtureMaterial: 'linen',
    scene: deskInClay,
  },
  {
    id: 'nordic-terra',
    designStyle: 'classic',
    label: 'Терракота и дуб',
    description:
      'Терракота во входной и кухонной зонах, дубовая ёлочка в комнатах и неглубокие филёнки с латунным светом.',
    swatches: ['#bc6a4b', '#a17c56', '#e1d9bc'],
    reference: {
      title: 'Plantagegatan Apartment Renovation',
      studio: 'mnmt',
      url: 'https://www.archdaily.com/1031409/plantagegatan-mnmt',
      lesson:
        'Терракотовая плитка связывает комнаты исторической квартиры. Здесь плитка отмечает более нагруженные вход и кухню, а дуб ведёт в комнаты.',
    },
    features: {
      walls: 'Узкие филёнки из дымчатого дуба, матовая штукатурка наверху',
      furniture: 'Светлые фасады в деревянной рамке, компактная мягкая мебель',
      lighting: 'Подвесы из опалового стекла и латуни',
      materials: 'Терракотовая плитка, дубовая ёлочка, масло, латунь',
    },
    materials: {
      paint: finish('#e3dcc6', 'plaster'),
      oak: finish('#967451', 'oak', 0.64),
      'floor-oak': finish('#ba946c', 'herringbone', 0.69),
      linen: finish('#c8ad92'),
      sage: finish('#829082'),
      rug: finish('#c88b70'),
      stone: finish('#d3c6b2', 'glazed-tile', 0.5),
      metal: finish('#b38a54', 'brushed-metal', 0.4, 0.75),
      ink: finish('#5f5044'),
    },
    roomMaterials: {
      hall: { 'floor-oak': finish('#a45f46', 'glazed-tile', 0.71) },
      kitchen: {
        'floor-oak': finish('#a45f46', 'glazed-tile', 0.71),
        paint: finish('#e3d8bd', 'plain', 0.65),
      },
      loggia: { 'floor-oak': finish('#a45f46', 'glazed-tile', 0.71) },
    },
    featureMaterial: finish('#c3a17a', 'oak', 0.71),
    treatment: 'moulding',
    panelWidth: 1850,
    panelDepth: 34,
    panelParts: 2,
    panelGap: 48,
    panelBottom: 1070,
    panelHeight: 1380,
    lighting: { preset: 'clean', label: 'Мягкий тёплый свет опаловых рассеивателей' },
    color: '#ffdfb7',
    generalLumens: 1820,
    accentLumens: 560,
    generalKind: 'Pendant',
    generalSize: [430, 510, 430],
    cabinetFace: 'split',
    furnitureForms: { Sofa: 'club', Table: 'open-frame' },
    lightForm: 'cluster',
    accentLightForm: 'opal',
    fixtureMaterial: 'metal',
  },
  {
    id: 'atelier-walnut',
    designStyle: 'loft',
    label: 'Кабинет из ореха',
    description:
      'Ореховая ТВ-тумба и массивный шпон над диваном. Мшистая обивка, дымчатый паркет и тонкая янтарная линия под панелями.',
    swatches: ['#6c4b32', '#59684a', '#c5baa3'],
    reference: {
      title: 'Magy Upper Apartment Renovation',
      studio: 'atelier tao+c',
      url: 'https://www.archdaily.com/1009597/magy-upper-apartment-renovation-atelier-tao-plus-c',
      lesson:
        'В квартире 45 м² встроенная мебель формирует места для сна, чтения и работы. Здесь этот приём задаёт линию из ореха от шкафа у входа до стола у окна.',
    },
    features: {
      walls: 'Панели из орехового шпона на фоне тёплой минеральной штукатурки',
      furniture: 'Ореховый шкаф и ТВ-тумба, графитовый низ кухни и ореховый верх',
      lighting: 'Горизонтальная линия под шпоном, направленный трек и подвес над столом',
      materials: 'Орех, тёмная сталь, тёплый паркет и мшистый текстиль',
    },
    materials: {
      paint: finish('#c5baa3', 'plaster'),
      oak: finish('#6c4b32', 'oak', 0.62),
      'floor-oak': finish('#946b4a', 'herringbone', 0.66),
      linen: finish('#b4a285'),
      sage: finish('#59684a'),
      rug: finish('#87725a'),
      stone: finish('#afac96', 'concrete', 0.72),
      metal: finish('#515751', 'brushed-metal', 0.5, 0.67),
      ink: finish('#393733', 'plain', 0.58, 0.1),
      light: warmDiffuser('#ffd4a2', 2.8),
    },
    roomMaterials: {
      kitchen: { paint: finish('#c4bca8', 'plaster') },
      bedroom: { paint: finish('#b6aa95', 'plaster') },
    },
    featureMaterial: finish('#725239', 'oak', 0.66),
    treatment: 'slats',
    panelWidth: 2850,
    panelDepth: 34,
    panelParts: 3,
    panelGap: 20,
    panelBottom: 1040,
    panelHeight: 1390,
    panelLighting: {
      layout: 'underline',
      rooms: ['living', 'bedroom'],
      lumensPerMeter: 185,
      color: '#ffd4a2',
    },
    lighting: { preset: 'clean', label: 'Тёплый трек и скрытый свет под орехом' },
    color: '#ffd3a0',
    generalLumens: 1900,
    accentLumens: 600,
    generalKind: 'TrackLight',
    generalSize: [1270, 130, 105],
    cabinetFace: 'recessed',
    furnitureForms: { Sofa: 'open-frame', Bed: 'low-slung', Table: 'open-frame' },
    accentLightForm: 'lantern',
    accentSize: [310, 270],
    scene: contrastJoinery({
      kitchenBase: 'ink',
      kitchenTop: 'oak',
      bedroom: 'oak',
      hall: 'oak',
      media: 'oak',
    }),
  },
  {
    id: 'walnut-after-dark',
    designStyle: 'loft',
    label: 'Орех после заката',
    description:
      'Гостиная с коньячным диваном и большой стеновой вставкой из дымчатого ореха. Тёплый свет вдоль шпона собирает зону отдыха, а стол у окна остаётся рабочим местом.',
    swatches: ['#62412d', '#a46138', '#81766a'],
    reference: {
      title: 'FL Apartment',
      studio: 'ZALC Arquitetura',
      url: 'https://www.archdaily.com/1061948/fl-apartment-zalc-arquitetura',
      lesson:
        'Деревянные объёмы и световые профили в столярке отделяют зоны. В этой квартире приём собирает стену за диваном и входное хранение в одну композицию.',
    },
    features: {
      walls: 'Гладкий дымчатый орех на стене гостиной, тёплая штукатурка вокруг',
      furniture: 'Коньячный диван, тёмные нижние фасады и высокие шкафы из шпона',
      lighting: 'Янтарная линия снизу и по краям шпона, тёплый подвес над столом',
      materials: 'Дымчатый орех, матовая латунь, карамельная обивка и тёмный паркет',
    },
    materials: {
      paint: finish('#81766a', 'plaster'),
      oak: finish('#65412b', 'oak', 0.56),
      'floor-oak': finish('#74523d', 'herringbone', 0.65),
      linen: finish('#a69278'),
      sage: finish('#aa633a', 'plain', 0.63),
      rug: finish('#5c5248'),
      stone: finish('#625c53', 'stone', 0.58),
      metal: finish('#a18669', 'brushed-metal', 0.46, 0.68),
      ink: finish('#34312e', 'plain', 0.58, 0.08),
      light: warmDiffuser('#ffc88f', 3.1),
    },
    roomMaterials: {
      bedroom: { paint: finish('#938575', 'plaster') },
      hall: { paint: finish('#989186', 'plaster') },
    },
    featureMaterial: finish('#75523b', 'oak', 0.55),
    treatment: 'flat',
    panelWidth: 2970,
    panelDepth: 34,
    panelParts: 1,
    panelBottom: 1050,
    panelHeight: 1400,
    panelLighting: {
      layout: 'outline',
      rooms: ['living', 'bedroom'],
      lumensPerMeter: 215,
      color: '#ffc88f',
    },
    lighting: { preset: 'evening', label: 'Вечерний свет вдоль шпона и над столом' },
    color: '#ffc88f',
    generalLumens: 1900,
    accentLumens: 730,
    generalKind: 'TrackLight',
    generalSize: [1270, 125, 105],
    cabinetFace: 'recessed',
    furnitureForms: { Sofa: 'club', Bed: 'low-slung', Table: 'sculptural' },
    accentLightForm: 'disc',
    accentSize: [390, 350],
    fixtureMaterial: 'metal',
    scene: contrastJoinery({
      kitchenBase: 'ink',
      kitchenTop: 'oak',
      bedroom: 'oak',
      hall: 'oak',
      media: 'oak',
    }),
  },
  {
    id: 'graphite-bronze',
    designStyle: 'hitech',
    label: 'Графит и бронза',
    description:
      'Строгий интерьер с графитовыми фасадами и вертикальными световыми швами. Бронза и дымчатый шпон дают тёплые акценты рядом с серым камнем.',
    swatches: ['#333b3b', '#a18668', '#a5a49c'],
    reference: {
      title: 'PK Apartment',
      studio: 'ZALC Arquitetura',
      url: 'https://www.archdaily.com/1085670/pk-apartment-zalc-arquitetura',
      lesson:
        'В квартире 48 м² тёмный гарнитур и ореховое изголовье задают характер. Здесь графит выделяет хранение, шпон согревает гостиную, а бронза и свет подчёркивают вертикальные швы.',
    },
    features: {
      walls: 'Ритм вертикальных шпонированных панелей на стене из серой штукатурки',
      furniture: 'Графитовый верх кухни, ореховые нижние фасады и тёмная ТВ-тумба',
      lighting: 'Вертикальные тёплые швы между панелями и линейный потолочный свет',
      materials: 'Графит, дымчатый шпон, бронзированный металл и серое терраццо',
    },
    materials: {
      paint: finish('#a5a49c', 'plaster'),
      oak: finish('#6d5542', 'oak', 0.54),
      'floor-oak': finish('#777871', 'terrazzo', 0.67),
      linen: finish('#999790'),
      sage: finish('#515957', 'plain', 0.77),
      rug: finish('#77756d'),
      stone: finish('#898880', 'concrete', 0.62),
      metal: finish('#a18668', 'brushed-metal', 0.42, 0.78),
      ink: finish('#333b3b', 'plain', 0.53, 0.16),
      light: warmDiffuser('#ffdcac', 3.2),
    },
    roomMaterials: {
      bedroom: { paint: finish('#a6a497', 'plaster') },
    },
    featureMaterial: finish('#514034', 'oak', 0.55),
    treatment: 'flat',
    panelWidth: 2980,
    panelDepth: 28,
    panelParts: 4,
    panelGap: 52,
    panelBottom: 1020,
    panelHeight: 1500,
    wallLight: true,
    panelLighting: {
      layout: 'flanks',
      rooms: ['living', 'bedroom'],
      lumensPerMeter: 140,
      color: '#ffdcac',
    },
    lighting: { preset: 'clean', label: 'Графичный потолочный свет и тёплые швы на стене' },
    color: '#ffe1bd',
    generalLumens: 2150,
    accentLumens: 620,
    generalKind: 'TrackLight',
    generalSize: [1210, 105, 110],
    cabinetFace: 'split',
    furnitureForms: { Sofa: 'low-slung', Bed: 'open-frame', Table: 'open-frame' },
    accentLightForm: 'cluster',
    accentSize: [460, 220],
    fixtureMaterial: 'metal',
    scene: contrastJoinery({
      kitchenBase: 'oak',
      kitchenTop: 'ink',
      bedroom: 'oak',
      hall: 'ink',
      media: 'ink',
    }),
  },
  {
    id: 'red-alcove',
    designStyle: 'classic',
    label: 'Красная столовая',
    description:
      'Бордовая обеденная зона в глубине квартиры. Тёплый свет даёт камерность за столом, а гостиная остаётся светлее.',
    swatches: ['#932e37', '#a77750', '#ede0be'],
    reference: {
      title: 'Apartment Filippo',
      studio: 'Studio Alexander Fehre',
      url: 'https://www.archdaily.com/784638/apartment-filippo-studio-alexander-fehre',
      lesson:
        'В квартире 45 м² обеденное место стало одной выразительной красной комнатой внутри общей кухни. Здесь похожий эффект создаёт участок отделки за столом и бордовые сиденья.',
    },
    features: {
      walls: 'Одна бордовая панель рядом с обеденным столом и светлая штукатурка вокруг',
      furniture: 'Красная обеденная мебель, кремовый диван и тёмные филёнки',
      lighting: 'Кластер из небольших опаловых шаров над столом',
      materials: 'Бордовый лак, тёмный шпон, матовая штукатурка, латунь',
    },
    materials: {
      paint: finish('#e6d7ba', 'plaster'),
      oak: finish('#896044', 'oak', 0.58),
      'floor-oak': finish('#ac8154', 'herringbone', 0.68),
      linen: finish('#ead8b6'),
      sage: finish('#8c3138', 'plain', 0.59),
      rug: finish('#c9ae8c'),
      stone: finish('#b8a183', 'terrazzo', 0.68),
      metal: finish('#b58e51', 'brushed-metal', 0.4, 0.78),
      ink: finish('#49362e'),
    },
    roomMaterials: { kitchen: { paint: finish('#8b2930', 'plain', 0.54) } },
    featureMaterial: finish('#8c3233', 'plain', 0.55),
    treatment: 'moulding',
    panelWidth: 1880,
    panelDepth: 30,
    panelParts: 1,
    panelBottom: 1030,
    panelHeight: 1570,
    panelFocus: 'dining',
    lighting: { preset: 'clean', label: 'Опаловый общий свет и тёплое пятно над столом' },
    color: '#ffd4a5',
    generalLumens: 1550,
    accentLumens: 810,
    generalKind: 'Pendant',
    generalSize: [410, 470, 410],
    cabinetFace: 'recessed',
    furnitureForms: { Sofa: 'club', Table: 'sculptural' },
    lightForm: 'opal',
    accentLightForm: 'cluster',
    fixtureMaterial: 'metal',
    accentSize: [470, 400],
    scene: redDiningSeat,
  },
  {
    id: 'mirror-pine',
    designStyle: 'japandi',
    label: 'Сосна и зеркала',
    description:
      'Цельная светлая столярка, отражающий участок стены и стойкая пробка на полу. Днём зеркало продолжает видимую линию окна.',
    swatches: ['#d5b476', '#d4dfe2', '#e9e8d4'],
    reference: {
      title: 'Stendhal Apartment',
      studio: 'miogui',
      url: 'https://www.archdaily.com/969706/stendhal-apartment-miogui',
      lesson:
        'Сосновая фанера объединяет функции кухни микроквартиры, зеркало даёт отражённую глубину. Здесь зеркало — отдельная вставка в проверенном свободном участке стены.',
    },
    features: {
      walls: 'Одна зеркальная вставка на светлом фоне',
      furniture: 'Сосновая столярка, низкая посадка и открытые деревянные опоры',
      lighting: 'Молочный диск и неглубокий подвес',
      materials: 'Сосновый шпон, зеркало, пробка, льняная обивка',
    },
    materials: {
      paint: finish('#e6dec6', 'plaster'),
      oak: finish('#d7b775', 'oak', 0.68),
      'floor-oak': finish('#bc946a', 'cork', 0.89),
      linen: finish('#e8ddba'),
      sage: finish('#bea786'),
      rug: finish('#dca177'),
      stone: finish('#e6d0a8', 'terrazzo', 0.65),
      metal: finish('#c2bdac', 'brushed-metal', 0.55, 0.66),
      ink: finish('#746a55'),
    },
    roomMaterials: { kitchen: { paint: finish('#d9bc81', 'oak', 0.62) } },
    featureMaterial: finish('#d9e5e8', 'plain', 0.05, 1),
    treatment: 'flat',
    panelWidth: 1480,
    panelDepth: 14,
    panelParts: 1,
    panelBottom: 1075,
    panelHeight: 1310,
    panelFocus: 'media',
    lighting: { preset: 'clean', label: 'Мягкий свет и отражение от зеркала' },
    color: '#ffebc9',
    generalLumens: 1790,
    accentLumens: 510,
    generalKind: 'Pendant',
    generalSize: [505, 375, 505],
    cabinetFace: 'recessed',
    furnitureForms: { Sofa: 'low-slung', Bed: 'low-slung', Table: 'open-frame' },
    lightForm: 'disc',
    accentLightForm: 'opal',
    fixtureMaterial: 'linen',
    scene: mirrorWall,
  },
  {
    id: 'blue-belt',
    designStyle: 'hitech',
    label: 'Синяя линия мебели',
    description:
      'Линия синего хранения идёт от прихожей через нижние кухонные фасады к тумбе гостиной. Верхние объёмы сливаются со стеной.',
    swatches: ['#376984', '#e8e7d8', '#c49b6d'],
    reference: {
      title: 'Central Apartment',
      studio: 'ARQLIQ arquitetura',
      url: 'https://www.archdaily.com/1055557/central-apartment-arqliq-arquitetura',
      lesson:
        'Низкая синяя мебель связывает кухню и гостиную, светлая верхняя часть даёт помещению воздух. Здесь синий пояс отмечает нижние фасады, сохраняющие общий объём встроенного хранения.',
    },
    features: {
      walls: 'Протяжённый неглубокий пояс и светлый верх стен',
      furniture: 'Синие нижние фасады, скрывающиеся на светлом фоне верхние шкафы и лёгкие столы',
      lighting: 'Линейный рабочий свет и широкий обеденный диск',
      materials: 'Синий матовый ламинат, шпон и светлое терраццо',
    },
    materials: {
      paint: finish('#e9e5d4', 'plaster'),
      oak: finish('#4f7990', 'plain', 0.62),
      'floor-oak': finish('#b68d61', 'herringbone', 0.74),
      linen: finish('#dbbf97'),
      sage: finish('#426c83'),
      rug: finish('#b5c2b6'),
      stone: finish('#d8d7bd', 'terrazzo', 0.62),
      metal: finish('#929a98', 'brushed-metal', 0.49, 0.78),
      ink: finish('#394c50'),
    },
    roomMaterials: {
      hall: { 'floor-oak': finish('#d4d5c2', 'terrazzo', 0.66) },
      kitchen: {
        'floor-oak': finish('#d4d5c2', 'terrazzo', 0.66),
        paint: finish('#e9e5d4', 'plain', 0.65),
      },
    },
    featureMaterial: finish('#e2ddca', 'plaster', 0.88),
    treatment: 'band',
    panelWidth: 2680,
    panelDepth: 26,
    panelParts: 1,
    panelBottom: 1000,
    panelHeight: 1050,
    lighting: { preset: 'clean', label: 'Линейный свет, нейтральный обеденный подвес' },
    color: '#ffebcf',
    generalLumens: 1950,
    accentLumens: 580,
    generalKind: 'TrackLight',
    generalSize: [1390, 85, 100],
    cabinetFace: 'split',
    furnitureForms: { Sofa: 'low-slung', Table: 'open-frame' },
    accentLightForm: 'disc',
    accentSize: [490, 490],
    scene: gradedJoinery,
  },
]
