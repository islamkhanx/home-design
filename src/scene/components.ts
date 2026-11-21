import * as T from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { basinGeometry, dropInSinkGeometry } from './basin.ts'
import type { Object3D } from 'three/src/core/Object3D.js'
import { mm, deg, wallCells } from '../domain/math.ts'
import type { Entity, Apartment } from '../domain/schema.ts'

/** One factory registry for FAST and GLB; Blender never reconstructs these shapes. */
export function createEntity(
  e: Entity,
  a: Apartment,
  materials: Map<string, T.MeshPhysicalMaterial>,
): T.Group {
  const g = new T.Group()
  g.name = e.id
  g.userData = {
    entityId: e.id,
    kind: e.kind,
    roomId: e.roomId,
    evidence: e.evidence,
    generated: e.generated ?? false,
  }
  g.position.set(...(e.position.map(mm) as [number, number, number]))
  g.rotation.set(...(e.rotation.map(deg) as [number, number, number]))
  const [w, h, d] = e.size.map(mm),
    material = materials.get(e.material)!,
    white = materials.get('white') ?? material,
    metal = materials.get('metal') ?? material
  let index = 0
  function mesh(
    geometry: T.BufferGeometry,
    mat: T.Material,
    x = 0,
    y = 0,
    z = 0,
    parent: Object3D = g,
  ) {
    const m = new T.Mesh(geometry, mat)
    m.position.set(x, y, z)
    m.castShadow = m.receiveShadow = true
    const partId = e.id + '__' + index++
    m.name = partId
    m.userData = { ...g.userData, partId }
    parent.add(m)
    return m
  }
  const box = (
    W: number,
    H: number,
    D: number,
    x = 0,
    y = H / 2,
    z = 0,
    mat: T.Material = material,
    parent: Object3D = g,
  ) =>
    mesh(
      ['Wall', 'Floor', 'Ceiling', 'LEDStrip', 'GlassPartition'].includes(e.kind)
        ? new T.BoxGeometry(Math.max(0.001, W), Math.max(0.001, H), Math.max(0.001, D))
        : new RoundedBoxGeometry(
            Math.max(0.001, W),
            Math.max(0.001, H),
            Math.max(0.001, D),
            2,
            Math.min(0.003, W / 8, H / 8, D / 8),
          ),
      mat,
      x,
      y,
      z,
      parent,
    )
  const cylinder = (
    r: number,
    H: number,
    x: number,
    y: number,
    z: number,
    mat: T.Material = metal,
  ) => mesh(new T.CylinderGeometry(r, r, H, 24), mat, x, y, z)
  const timber = materials.get('oak') ?? material,
    dark = materials.get('ink') ?? metal,
    fixture = e.params?.fixture
  /** Upholstery radii belong to the canonical mesh, including the Blender export. */
  function cushion(
    W: number,
    H: number,
    D: number,
    x: number,
    y: number,
    z: number,
    mat: T.Material = material,
    radius = 0.055,
  ) {
    return mesh(
      new RoundedBoxGeometry(W, H, D, 4, Math.min(radius, W * 0.24, H * 0.24, D * 0.24)),
      mat,
      x,
      y,
      z,
    )
  }
  function taperedLeg(x: number, z: number, height: number, radius: number, mat = timber) {
    mesh(new T.CylinderGeometry(radius * 0.72, radius, height, 16), mat, x, height / 2, z)
  }
  function chair(office: boolean) {
    const seatTop = h * 0.57,
      seatThickness = Math.min(0.075, h * 0.09),
      seatBottom = seatTop - seatThickness
    cushion(w * 0.93, seatThickness, d * 0.88, 0, seatTop - seatThickness / 2, d * 0.025)
    cushion(w * 0.9, h * 0.38, d * 0.12, 0, h * 0.81, -d * 0.43)
    if (office) {
      // Five-spoke base and lift, instead of an armchair standing at the desk.
      cylinder(
        Math.min(w, d) * 0.055,
        seatBottom - h * 0.07,
        0,
        (seatBottom + h * 0.07) / 2,
        0,
        dark,
      )
      const reach = Math.min(w, d) * 0.39,
        wheel = Math.min(w, d) * 0.043
      for (let i = 0; i < 5; i++) {
        const angle = (i * Math.PI * 2) / 5
        const spoke = box(
          reach,
          h * 0.035,
          wheel * 1.5,
          (Math.cos(angle) * reach) / 2,
          h * 0.07,
          (Math.sin(angle) * reach) / 2,
          dark,
        )
        spoke.rotation.y = -angle
        const roller = mesh(
          new T.SphereGeometry(wheel, 12, 8),
          dark,
          Math.cos(angle) * reach,
          wheel,
          Math.sin(angle) * reach,
        )
        roller.scale.y = 0.8
      }
      box(w * 0.12, h * 0.34, d * 0.07, 0, seatBottom + h * 0.13, -d * 0.39, dark)
    } else {
      for (const x of [-w * 0.36, w * 0.36])
        for (const z of [-d * 0.32, d * 0.32]) taperedLeg(x, z, seatBottom, Math.min(w, d) * 0.043)
      // Slender supports connect the upholstered back to the rear seat frame.
      for (const x of [-w * 0.32, w * 0.32])
        box(w * 0.045, h * 0.28, d * 0.045, x, seatTop + h * 0.1, -d * 0.41, timber)
    }
  }
  function mediaScreen(monitor: boolean) {
    // Conventional front is +Z. Legacy thin-X records are also supported (+X).
    const thinX = w < d,
      width = thinX ? d : w,
      depth = thinX ? w : d
    const screenHeight = monitor ? h * 0.78 : h,
      bottom = monitor ? h * 0.22 : 0,
      frame = Math.min(width * 0.016, screenHeight * 0.025),
      // A monitor's depth includes its foot; only the wall-mounted TV uses
      // almost the whole envelope for its display housing.
      thickness = Math.max(0.001, monitor ? Math.min(0.035, depth * 0.18) : depth * 0.82)
    const part = (
      W: number,
      H: number,
      D: number,
      x: number,
      y: number,
      z: number,
      mat: T.Material,
    ) => {
      const m = box(W, H, D, thinX ? z : x, y, thinX ? -x : z, mat)
      if (thinX) m.rotation.y = Math.PI / 2
      return m
    }
    part(width, screenHeight, thickness, 0, bottom + screenHeight / 2, 0, dark)
    // Recessed glass produces restrained reflections without emitting fake TV light.
    const screen = (materials.get('ink') ?? material).clone()
    screen.name = 'screen-glass'
    screen.color.set('#18201f')
    screen.metalness = 0.3
    screen.roughness = 0.16
    part(
      width - frame * 2,
      screenHeight - frame * 2,
      depth * 0.035,
      0,
      bottom + screenHeight / 2,
      thickness / 2 + depth * 0.018,
      screen,
    )
    if (monitor) {
      part(width * 0.035, h * 0.25, Math.min(0.035, depth * 0.16), 0, h * 0.15, 0, dark)
      part(width * 0.32, h * 0.035, depth * 0.98, 0, h * 0.0175, 0, dark)
    }
  }
  function cabinet() {
    const t = Math.min(0.018, w / 10, d / 10),
      gap = 0.003
    // Shell and actual door panels: the washer remains inside a serviceable cavity.
    for (const x of [-1, 1]) box(t, h, d, (x * (w - t)) / 2, h / 2)
    // A washing machine stands on the room floor, not on a thin furniture panel.
    const horizontalPanels =
      e.params?.appliance === 'washer'
        ? [h - t / 2]
        : fixture === 'sinkBase'
          ? [t / 2]
          : [t / 2, h - t / 2]
    for (const y of horizontalPanels) box(w - 2 * t, t, d, 0, y)
    box(w - 2 * t, h - 2 * t, t, 0, h / 2, -d / 2 + t / 2)
    const n = e.params?.cabinetDoors ?? Math.max(1, Math.round(w / 0.55))
    const split = e.params?.appliance === 'washer' ? Math.min(0.92, h * 0.4) : 0
    if (split) box(w - 2 * t, t, d - t, 0, split)
    const rows = split
      ? [
          [gap, split - gap],
          [split + gap, h - gap],
        ]
      : [[gap, h - gap]]
    for (const [bottom, top] of fixture === 'blindCorner' ? [] : rows)
      for (let i = 0; i < n; i++) {
        const panelWidth = w / n - gap * 2
        box(
          panelWidth,
          top - bottom,
          t,
          -w / 2 + (w * (i + 0.5)) / n,
          (bottom + top) / 2,
          d / 2 - t / 2,
        )
      }
  }
  if (e.kind === 'Socket' || e.kind === 'Switch') {
    const count = e.electrical?.gangs ?? 1
    box(w, h, d - 0.006, 0, h / 2, -0.003, material)
    const face = d / 2 - 0.005
    const dark = materials.get('ink') ?? metal
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * 0.071
      if (e.kind === 'Switch') {
        box(0.053, 0.056, 0.004, x, h / 2, face + 0.002, white)
        box(0.018, 0.002, 0.001, x, h * 0.3, face + 0.0045, dark)
      } else {
        mesh(new T.CircleGeometry(0.022, 24), white, x, h / 2, face + 0.0005)
        for (const dx of [-0.009, 0.009])
          mesh(new T.CircleGeometry(0.003, 12), dark, x + dx, h / 2, face + 0.001)
        box(0.004, 0.007, 0.002, x, h / 2 + 0.02, face + 0.002, metal)
        box(0.004, 0.007, 0.002, x, h / 2 - 0.02, face + 0.002, metal)
      }
    }
  } else if (e.kind === 'Wall' && e.wall) {
    const v = e.wall,
      dx = v.end[0] - v.start[0],
      dz = v.end[1] - v.start[1],
      len = Math.hypot(dx, dz)
    const wall = new T.Group()
    wall.position.set(mm(v.start[0]), 0, mm(v.start[1]))
    wall.rotation.y = -Math.atan2(dz, dx)
    g.add(wall)
    for (const c of wallCells(len, v.height, v.openings))
      box(
        mm(c.width),
        mm(c.height),
        mm(v.thickness),
        mm(c.x + c.width / 2),
        mm(c.y + c.height / 2),
        0,
        material,
        wall,
      )
  } else if ((e.kind === 'Floor' || e.kind === 'Ceiling' || e.kind === 'Countertop') && e.surface) {
    const s = e.surface,
      shape = new T.Shape(s.polygon.map((p) => new T.Vector2(mm(p[0]), mm(p[1]))))
    for (const hole of s.holes ?? [])
      shape.holes.push(new T.Path(hole.map((p) => new T.Vector2(mm(p[0]), mm(p[1])))))
    const geo = new T.ExtrudeGeometry(shape, {
      depth: mm(s.thickness),
      bevelEnabled: false,
      steps: 1,
      curveSegments: 1,
    })
    geo.rotateX(Math.PI / 2)
    mesh(geo, material, 0, e.kind === 'Ceiling' ? mm(s.thickness) : 0, 0)
  } else if ((e.kind === 'Door' || e.kind === 'Window') && e.attach) {
    const wall = a.objects.find((v) => v.id === e.attach!.wallId)!,
      v = wall.wall!,
      q = v.openings.find((v) => v.id === e.attach!.openingId)!
    // Follow the host wall transform, including its arbitrary local angle and entity rotation.
    const host = new T.Group()
    host.position.set(...(wall.position.map(mm) as [number, number, number]))
    host.rotation.set(...(wall.rotation.map(deg) as [number, number, number]))
    g.add(host)
    const aligned = new T.Group()
    aligned.position.set(mm(v.start[0]), 0, mm(v.start[1]))
    aligned.rotation.y = -Math.atan2(v.end[1] - v.start[1], v.end[0] - v.start[0])
    host.add(aligned)
    const W = mm(q.width),
      H = mm(q.height),
      t = 0.04,
      bottom = mm(q.bottom),
      left = mm(q.offset)
    for (const x of [left + t / 2, left + W - t / 2])
      box(t, H, mm(v.thickness), x, bottom + H / 2, 0, material, aligned)
    box(W, t, mm(v.thickness), left + W / 2, bottom + H - t / 2, 0, material, aligned)
    if (e.kind === 'Door') {
      const hinge = new T.Group()
      hinge.position.set(left + t, bottom, 0)
      hinge.rotation.y = deg(e.params?.doorAngle ?? 0)
      aligned.add(hinge)
      box(W - 2 * t, H - t, 0.035, (W - 2 * t) / 2, (H - t) / 2, 0, material, hinge)
      box(0.1, 0.015, 0.06, W - 2 * t - 0.12, H * 0.46, 0.04, metal, hinge)
    } else {
      box(W, t, mm(v.thickness), left + W / 2, bottom + t / 2, 0, material, aligned)
      box(
        W - 2 * t,
        H - 2 * t,
        0.008,
        left + W / 2,
        bottom + H / 2,
        0,
        materials.get('glass') ?? material,
        aligned,
      )
    }
  } else if (e.kind === 'Bathtub') {
    mesh(basinGeometry(w, h, d, Math.min(0.065, w * 0.08, d * 0.1)), white)
    cylinder(0.028, 0.004, -w * 0.32, Math.min(h * 0.2, 0.08) + 0.002, 0, metal)
  } else if (e.kind === 'Sink') {
    mesh(
      fixture === 'dropInSink'
        ? dropInSinkGeometry(w, h, d)
        : basinGeometry(w, h, d, Math.min(0.025, w * 0.08, d * 0.08)),
      white,
    )
  } else if (e.kind === 'Vanity') {
    const top = h * 0.75,
      basinHeight = h * 0.17,
      body = top - basinHeight
    box(w, body, d, 0, body / 2)
    for (const y of [body * 0.47, body * 0.94])
      box(w * 0.94, 0.003, 0.002, 0, y, d / 2 - 0.001, metal)
    mesh(basinGeometry(w, basinHeight, d, Math.min(0.045, w * 0.08, d * 0.1)), white, 0, body, 0)
    cylinder(0.018, 0.004, 0, body + Math.min(basinHeight * 0.2, 0.08) + 0.002, 0)
    cylinder(Math.min(0.012, w * 0.025), h * 0.23, 0, top + h * 0.115, -d * 0.4)
    box(w * 0.045, h * 0.02, d * 0.25, 0, h - h * 0.01, -d * 0.275, metal)
  } else if (e.kind === 'Toilet') {
    const base = mesh(new T.SphereGeometry(1, 24, 16), white, 0, h * 0.44, 0)
    base.scale.set(w / 2, h * 0.44, d / 2)
    mesh(new RoundedBoxGeometry(w, h * 0.1, d, 4, Math.min(w, d) * 0.045), white, 0, h * 0.95, 0)
  } else if (e.params?.fixture === 'hygienicShower') {
    cylinder(0.018, h * 0.32, w * 0.25, h * 0.77, 0, metal)
    box(w * 0.24, h * 0.08, d * 0.75, w * 0.25, h * 0.95, d * 0.12, metal)
    box(w * 0.28, h * 0.12, d * 0.7, -w * 0.25, h * 0.7, 0, metal)
    const hose = new T.CatmullRomCurve3([
      new T.Vector3(-w * 0.25, h * 0.64, 0),
      new T.Vector3(-w * 0.32, h * 0.2, d * 0.2),
      new T.Vector3(0, h * 0.04, d * 0.25),
      new T.Vector3(w * 0.3, h * 0.2, d * 0.2),
      new T.Vector3(w * 0.25, h * 0.61, 0),
    ])
    mesh(new T.TubeGeometry(hose, 32, 0.008, 8, false), metal)
  } else if (e.params?.fixture === 'towelWarmer') {
    for (const x of [-w * 0.43, w * 0.43]) cylinder(0.018, h, x, h / 2, 0, white)
    for (let i = 0; i < 7; i++) {
      const bar = mesh(
        new T.CylinderGeometry(0.012, 0.012, w * 0.86, 12),
        white,
        0,
        h * (0.1 + i * 0.13),
        0,
      )
      bar.rotation.z = Math.PI / 2
    }
  } else if (fixture === 'kitchenTap') {
    const curve = new T.CatmullRomCurve3([
      new T.Vector3(0, 0.012, -d * 0.2),
      new T.Vector3(0, h * 0.7, -d * 0.2),
      new T.Vector3(0, h * 0.94, 0),
      new T.Vector3(0, h * 0.88, d * 0.36),
      new T.Vector3(0, h * 0.65, d * 0.36),
    ])
    mesh(new T.TubeGeometry(curve, 32, 0.011, 12, false), metal)
    cylinder(0.025, 0.012, 0, 0.006, -d * 0.2)
    box(w * 0.32, 0.014, 0.018, w * 0.18, h * 0.25, -d * 0.2, metal)
  } else if (fixture === 'extractorHood') {
    box(w, h * 0.1, d, 0, h * 0.05)
    box(w * 0.42, h * 0.9, d * 0.62, 0, h * 0.55, -d * 0.19)
    box(w * 0.68, 0.003, d * 0.65, 0, 0.002, d * 0.03, metal)
  } else if (e.kind === 'Shower') {
    const r = Math.min(w * 0.3, d * 0.24)
    cylinder(Math.min(0.012, d * 0.06), h * 0.85, 0, h * 0.48, -d * 0.35)
    box(w, h * 0.045, d * 0.3, 0, h * 0.1, -d * 0.35, metal)
    box(w * 0.06, h * 0.02, d * 0.6, 0, h * 0.95, -d * 0.05, metal)
    cylinder(r, h * 0.015, 0, h * 0.93, d * 0.25, metal)
  } else if (e.kind === 'GlassPartition') box(w, h, d)
  else if (e.kind === 'Appliance') {
    const trim = Math.min(0.04, d * 0.1)
    box(w, h, d - trim, 0, h / 2, -trim / 2, e.params?.appliance === 'oven' ? dark : white)
    if (e.params?.appliance === 'washer') {
      const ring = mesh(
        new T.TorusGeometry(Math.min(w, h) * 0.29, trim * 0.45, 12, 32),
        metal,
        0,
        h * 0.46,
        d / 2 - trim * 0.5,
      )
      const glass = mesh(
        new T.CircleGeometry(Math.min(w, h) * 0.26, 32),
        materials.get('glass') ?? white,
        0,
        h * 0.46,
        d / 2 - trim * 0.3,
      )
      ring.rotation.set(0, 0, 0)
      glass.rotation.set(0, 0, 0)
      box(w * 0.9, h * 0.08, trim, 0, h * 0.89, d / 2 - trim / 2, metal)
    } else if (e.params?.appliance === 'fridge') {
      box(w, 0.004, trim * 0.5, 0, h * 0.3, d / 2 - trim * 0.5, metal)
      box(w * 0.04, h * 0.35, trim, w * 0.34, h * 0.65, d / 2 - trim / 2, metal)
    } else {
      box(w * 0.8, h * 0.6, trim * 0.3, 0, h * 0.45, d / 2 - trim * 0.5, dark)
      box(w * 0.7, h * 0.03, trim, 0, h * 0.85, d / 2 - trim / 2, metal)
    }
  } else if (fixture === 'artwork') {
    const frame = Math.min(w, h) * 0.022,
      paper = materials.get('rug') ?? material,
      neutral = materials.get('linen') ?? paper,
      green = materials.get('sage') ?? neutral,
      reliefDepth = Math.max(0.0005, d * 0.05)
    // Local +Z is the front of the framed canvas. Every relief is inset inside the frame.
    box(w, h, d * 0.4, 0, h / 2, -d * 0.3, timber)
    box(w - frame * 2, h - frame * 2, d * 0.5, 0, h / 2, -d * 0.05, paper)
    for (const x of [-w / 2 + frame / 2, w / 2 - frame / 2]) box(frame, h, d, x, h / 2, 0, timber)
    for (const y of [frame / 2, h - frame / 2]) box(w - frame * 2, frame, d, 0, y, 0, timber)
    const circle = mesh(new T.CircleGeometry(1, 64), neutral, -w * 0.16, h * 0.67, d * 0.23)
    circle.scale.set(w * 0.23, h * 0.19, 1)
    const shape = new T.Shape()
    shape.moveTo(-w * 0.31, h * 0.22)
    shape.lineTo(w * 0.31, h * 0.22)
    shape.lineTo(w * 0.31, h * 0.42)
    shape.bezierCurveTo(w * 0.24, h * 0.64, -w * 0.04, h * 0.64, -w * 0.12, h * 0.48)
    shape.bezierCurveTo(-w * 0.2, h * 0.4, -w * 0.31, h * 0.42, -w * 0.31, h * 0.22)
    shape.closePath()
    mesh(
      new T.ExtrudeGeometry(shape, { depth: reliefDepth, bevelEnabled: false, curveSegments: 24 }),
      green,
      0,
      0,
      d * 0.25,
    )
    box(w * 0.4, h * 0.008, reliefDepth, -w * 0.1, h * 0.17, d * 0.32, neutral)
  } else if (fixture === 'mediaScreen' || fixture === 'monitor') mediaScreen(fixture === 'monitor')
  else if (fixture === 'rug') {
    cushion(w, h, d, 0, h / 2, 0, material, Math.min(w, d) * 0.035)
    // A fine bound edge remains within the declared textile footprint.
    const seam = Math.min(0.004, h * 0.2)
    for (const x of [-w / 2 + 0.012, w / 2 - 0.012])
      box(seam, seam, Math.max(0.01, d - 0.024), x, h - seam / 2, 0, material)
  } else if (e.kind === 'KitchenCabinet' || e.kind === 'Wardrobe') cabinet()
  else if (e.kind === 'Countertop' && e.params?.sinkCutout) {
    const shape = new T.Shape([
      new T.Vector2(-w / 2, -d / 2),
      new T.Vector2(w / 2, -d / 2),
      new T.Vector2(w / 2, d / 2),
      new T.Vector2(-w / 2, d / 2),
    ])
    const [cx, cz] = e.params.sinkCutout.center.map(mm),
      [cw, cd] = e.params.sinkCutout.size.map(mm)
    shape.holes.push(
      new T.Path([
        new T.Vector2(cx - cw / 2, cz - cd / 2),
        new T.Vector2(cx - cw / 2, cz + cd / 2),
        new T.Vector2(cx + cw / 2, cz + cd / 2),
        new T.Vector2(cx + cw / 2, cz - cd / 2),
      ]),
    )
    const geo = new T.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, steps: 1 })
    geo.rotateX(Math.PI / 2)
    mesh(geo, material, 0, h, 0)
  } else if (e.kind === 'Countertop') {
    box(w, fixture === 'hob' ? h * 0.8 : h, d)
    if (fixture === 'hob')
      for (const x of [-w * 0.25, w * 0.25])
        for (const z of [-d * 0.25, d * 0.25]) {
          const ring = mesh(
            new T.TorusGeometry(Math.min(w, d) * 0.16, 0.0008, 6, 40),
            metal,
            x,
            h * 0.85,
            z,
          )
          ring.rotation.x = Math.PI / 2
        }
  } else if (e.kind === 'Shelf') {
    const n = Math.max(1, Math.min(20, e.params?.shelves ?? 4))
    for (let i = 0; i < n; i++)
      box(w, 0.025, d, 0, 0.0125 + (i * (h - 0.025)) / Math.max(1, n - 1), 0)
    box(0.025, h, d, -w / 2 + 0.0125)
    box(0.025, h, d, w / 2 - 0.0125)
  } else if (e.kind === 'Table') {
    const topThickness = Math.min(0.035, h * 0.1)
    if (fixture === 'bench') {
      cushion(w, h * 0.2, d, 0, h * 0.9, 0)
      for (const x of [-w * 0.38, w * 0.38])
        for (const z of [-d * 0.32, d * 0.32]) taperedLeg(x, z, h * 0.8, Math.min(w, d) * 0.045)
    } else if (fixture === 'roundTable') {
      const top = mesh(
        new T.CylinderGeometry(0.5, 0.5, topThickness, 64),
        material,
        0,
        h - topThickness / 2,
        0,
      )
      top.scale.set(w, 1, d)
      const radius = Math.min(w, d) * 0.16
      mesh(
        new T.CylinderGeometry(radius * 0.75, radius, h - topThickness, 32),
        material,
        0,
        (h - topThickness) / 2,
        0,
      )
    } else {
      cushion(w, topThickness, d, 0, h - topThickness / 2, 0, material, 0.025)
      for (const x of [-w * 0.4, w * 0.4])
        for (const z of [-d * 0.34, d * 0.34])
          taperedLeg(x, z, h - topThickness, Math.min(0.026, w * 0.04, d * 0.05), material)
    }
  } else if (e.kind === 'Bed') {
    const fabric = materials.get('linen') ?? material,
      bedding = materials.get('rug') ?? material,
      headDepth = d * 0.065
    // Raised upholstered frame, softly dressed mattress and a separate padded headboard.
    for (const x of [-w * 0.4, w * 0.4])
      for (const z of [-d * 0.36, d * 0.36])
        taperedLeg(x, z, h * 0.12, Math.min(w, d) * 0.018, dark)
    cushion(w * 0.98, h * 0.25, d * 0.94, 0, h * 0.245, d * 0.03)
    cushion(w * 0.95, h * 0.2, d * 0.89, 0, h * 0.47, d * 0.045, bedding)
    cushion(w, h * 0.85, headDepth, 0, h * 0.575, -d / 2 + headDepth / 2, fabric)
    cushion(w * 0.96, h * 0.055, d * 0.58, 0, h * 0.59, d * 0.19, fabric)
    for (const x of [-w * 0.24, w * 0.24])
      cushion(w * 0.42, h * 0.12, d * 0.19, x, h * 0.64, -d * 0.29, bedding)
    cushion(w * 0.96, h * 0.025, d * 0.17, 0, h * 0.63, d * 0.34, materials.get('sage') ?? fabric)
  } else if (e.kind === 'Sofa') {
    if (fixture === 'diningChair' || fixture === 'officeChair') chair(fixture === 'officeChair')
    else {
      const arm = Math.min(w * 0.12, 0.16),
        seats = fixture === 'armchair' ? 1 : Math.max(1, Math.min(3, Math.round(w / 0.85))),
        seatWidth = (w - arm * 2) / seats,
        gap = Math.min(0.012, seatWidth * 0.025)
      for (const x of [-w * 0.39, w * 0.39])
        for (const z of [-d * 0.34, d * 0.34])
          taperedLeg(x, z, h * 0.12, Math.min(w, d) * 0.027, dark)
      cushion(w, h * 0.27, d, 0, h * 0.255, 0)
      cushion(w, h * 0.64, d * 0.16, 0, h * 0.68, -d * 0.42)
      for (const x of [-w / 2 + arm / 2, w / 2 - arm / 2])
        cushion(arm, h * 0.49, d * 0.95, x, h * 0.455, d * 0.025)
      for (let i = 0; i < seats; i++) {
        const x = -w / 2 + arm + seatWidth * (i + 0.5)
        cushion(seatWidth - gap, h * 0.13, d * 0.72, x, h * 0.455, d * 0.08)
        cushion(seatWidth - gap, h * 0.4, d * 0.19, x, h * 0.735, -d * 0.235)
      }
    }
  } else if (e.kind === 'TrackLight') {
    box(w, 0.035, 0.04, 0, h - 0.018, 0, metal)
    for (let i = 0; i < 3; i++)
      cylinder(0.035, h * 0.7, -w * 0.33 + i * w * 0.33, h * 0.45, 0, metal)
  } else if (e.kind === 'Spotlight') {
    cylinder(Math.min(w, d) / 2, h, 0, h / 2, 0)
    cylinder(
      Math.min(w, d) * 0.42,
      0.003,
      0,
      0.002,
      0,
      materials.get(e.roomId === 'bathroom' ? 'bathroom-light' : 'light') ??
        materials.get('light') ??
        white,
    )
  } else if (e.kind === 'Pendant') {
    const shadeHeight = Math.min(h * 0.3, w * 0.42)
    cylinder(
      Math.min(0.004, w * 0.05, d * 0.05),
      h - shadeHeight,
      0,
      (h + shadeHeight) / 2,
      0,
      metal,
    )
    cylinder(Math.min(w * 0.18, 0.045), 0.02, 0, h - 0.01, 0, metal)
    const dome = mesh(
      new T.SphereGeometry(w / 2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      material,
      0,
      0,
      0,
    )
    dome.scale.set(1, shadeHeight / (w / 2), d / w)
  } else if (e.kind === 'LEDStrip') box(w, h, d)
  // DimensionLine / RoomLabel are presentation annotations, built separately.
  g.updateMatrixWorld(true)
  return g
}
