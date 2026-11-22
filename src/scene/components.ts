import * as T from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { basinGeometry, dropInSinkGeometry } from './basin.ts'
import { wallCellGeometry } from './wall-geometry.ts'
import { fixtureColor, fixtureOptics } from './fixture-optics.ts'
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
    mat: T.Material | T.Material[],
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
  // Joinery receives a small edge break and a consistent 3 mm total reveal.
  const panel = (W: number, H: number, D: number, x = 0, y = H / 2, z = 0, mat: T.Material = material) =>
    mesh(new RoundedBoxGeometry(W, H, D, 1, Math.min(0.0005, W / 8, H / 8, D / 8)), mat, x, y, z)
  const timber = materials.get('oak') ?? material,
    dark = materials.get('ink') ?? metal,
    fixture = e.params?.fixture,
    style = e.params?.designStyle,
    furnitureForm = e.params?.furnitureForm,
    cabinetFace = e.params?.cabinetFace,
    lightForm = e.params?.lightForm
  const optics = fixtureOptics(e)
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
  function ellipsoid(rx: number, ry: number, rz: number, x: number, y: number, z: number, mat = material) {
    const part = mesh(new T.SphereGeometry(1, 24, 16), mat, x, y, z)
    part.scale.set(rx, ry, rz)
    return part
  }
  function rail(from: T.Vector3, to: T.Vector3, radius: number, mat = dark) {
    const direction = to.clone().sub(from), center = from.clone().add(to).multiplyScalar(.5)
    const part = cylinder(radius, direction.length(), center.x, center.y, center.z, mat)
    part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction.normalize())
    return part
  }
  function turnedLeg(x: number, z: number, height: number, radius: number) {
    taperedLeg(x, z, height, radius * .75, timber)
    for (const fraction of [.2, .76])
      ellipsoid(radius, Math.min(radius * 1.3, height * .12), radius, x, height * fraction, z, timber)
  }
  function styledChair() {
    const top = h * .56, thickness = h * .085
    cushion(w * .9, thickness, d * .85, 0, top - thickness / 2, d * .025, material, style === 'hitech' ? .012 : .055)
    if (furnitureForm) {
      const frame = furnitureForm === 'open-frame' ? metal : timber
      const padded = furnitureForm === 'club' || furnitureForm === 'sculptural'
      const foot = Math.min(w, d) * .034
      for (const side of [-1, 1]) {
        const x = side * w * .39
        rail(new T.Vector3(x, foot, d * .34), new T.Vector3(x * .86, top - thickness / 2, d * .25), foot, frame)
        rail(new T.Vector3(x, foot, -d * .39), new T.Vector3(x * .91, h * .91, -d * .32), foot, frame)
        for (const z of [-d * .39, d * .34]) cylinder(foot, foot * 1.1, x, foot * .55, z, frame)
        if (padded) cushion(w * .12, h * .12, d * .69, x, h * .68, -d * .045, material, .045)
      }
      if (padded) cushion(w * .86, h * .26, d * .19, 0, h * .83, -d * .36, material, .075)
      else box(w * .83, h * .13, d * .09, 0, h * .86, -d * .34, frame)
      return
    }
    if (style === 'japandi') {
      for (const x of [-w * .36, w * .36]) box(w * .055, h * .65, d * .055, x, h * .67, -d * .4, timber)
      for (const y of [h * .78, h * .91]) box(w * .82, h * .055, d * .1, 0, y, -d * .4, timber)
    } else if (style === 'classic') {
      cushion(w * .9, h * .41, d * .13, 0, h * .79, -d * .4, timber, .08)
      cushion(w * .72, h * .3, d * .05, 0, h * .79, -d * .31, material, .08)
    } else {
      cushion(w * .9, h * .35, d * .1, 0, h * .81, -d * .43, material, .012)
      for (const x of [-w * .38, w * .38]) box(w * .035, h * .45, d * .035, x, h * .66, -d * .43, dark)
    }
    for (const x of [-w * .36, w * .36]) for (const z of [-d * .32, d * .32]) {
      if (style === 'classic') turnedLeg(x, z, top - thickness, Math.min(w, d) * .04)
      else if (style === 'loft' || style === 'hitech') box(w * .035, top - thickness, d * .035, x, (top - thickness) / 2, z, dark)
      else taperedLeg(x, z, top - thickness, Math.min(w, d) * .04)
    }
  }
  function chair(office: boolean) {
    if ((style || furnitureForm) && !office) { styledChair(); return }
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
          wheel * 0.8,
          Math.sin(angle) * reach,
        )
        roller.scale.y = 0.8
        // The flattened tyre touches the floor; a stem joins its hub to the spoke.
        cylinder(wheel * 0.22, h * 0.07 - wheel * 0.8,
          Math.cos(angle) * reach, (h * 0.07 + wheel * 0.8) / 2,
          Math.sin(angle) * reach, dark)
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
      gap = 0.0015,
      scribe = mm(e.params?.cabinetTopScribe ?? 0),
      body = h - scribe,
      topTier = mm(e.params?.cabinetTopTier ?? 0),
      base = mm(e.params?.cabinetPlinth ?? 0),
      sliding = e.params?.cabinetDoorStyle === 'sliding',
      frontReserve = sliding ? 0.08 : t + 0.001,
      shellDepth = d - frontReserve,
      voids = (e.params?.cabinetVoids ?? []).map(v => ({ bottom: mm(v.bottom), top: mm(v.bottom + v.height), front: v.front !== false, keepBack: v.keepBack === true }))
    const clear = (bottom: number, top: number) => !voids.some(v => v.bottom < top - 1e-8 && v.top > bottom + 1e-8)
    const subtract = (bottom: number, top: number, front = false, back = false): [number, number][] => {
      let spans: [number, number][] = [[bottom, top]]
      for (const v of voids.filter(v => (!front || v.front) && (!back || !v.keepBack)))
        spans = spans.flatMap(([lo, hi]) => v.top <= lo || v.bottom >= hi ? [[lo, hi]] :
          [[lo, Math.min(hi, v.bottom)], [Math.max(lo, v.top), hi]].filter(([a,b]) => b-a > 1e-6) as [number,number][])
      return spans
    }
    // Carcasses end behind the door backs; no overlapping/coplanar face surfaces.
    for (const x of [-1, 1]) panel(t, body-base, shellDepth, x*(w-t)/2, (body+base)/2, -frontReserve/2)
    const horizontalPanels = [
      ...(e.params?.appliance === 'washer' ? [] : [base+t/2]),
      ...(fixture === 'sinkBase' ? [] : [body-t/2]),
    ]
    for (const y of horizontalPanels)
      if (clear(y-t/2,y+t/2)) panel(w-2*t,t,shellDepth,0,y,-frontReserve/2)
    for (const [lo,hi] of subtract(base+t,body-t,false,true))
      panel(w-2*t,hi-lo,t,0,(hi+lo)/2,-d/2+t/2)
    const n = e.params?.cabinetDoors ?? Math.max(1, Math.round(w / 0.55))
    const splits = [
      ...(e.params?.appliance === 'washer' ? [Math.min(0.92, body * 0.4)] : []),
      ...(topTier ? [body - topTier] : []),
    ].sort((a, b) => a - b)
    for (const split of splits)
      if (clear(split-t/2,split+t/2)) panel(w-2*t,t,shellDepth-t,0,split,(t-frontReserve)/2)
    // Aperture boundary shelves support appliances without occupying their cavities.
    for (const v of voids)
      for (const y of [v.bottom-t/2,v.top+t/2])
        if (y-t/2>=base+t && y+t/2<=body-t && clear(y-t/2,y+t/2) && !splits.some(s=>Math.abs(s-y)<t))
          panel(w-2*t,t,shellDepth-t,0,y,(t-frontReserve)/2)
    const levels = [base,...splits,body],
      rows = levels.slice(0,-1).flatMap((bottom,i)=>subtract(bottom,levels[i+1],true))
    if (fixture === 'blindCorner') panel(w-gap*2,body-base-gap*2,t,0,(body+base)/2,d/2-t/2)
    for (const [lo,hi] of fixture === 'blindCorner' ? [] : rows) {
      const bottom=lo+gap, top=hi-gap
      if (sliding) {
        const trackH=Math.min(0.01,(top-bottom)/10)
        for (const y of [bottom+trackH/2,top-trackH/2])
          panel(w-2*t,trackH,0.065,0,y,d/2-0.039,dark)
      }
      for (let i = 0; i < n; i++) {
        const overlap=sliding && n>1 ? 0.04 : 0,
          panelWidth=(w+(n-1)*overlap)/n-gap*2,
          x=n===1 ? 0 : -w/2+(panelWidth+gap*2)/2+i*(w-panelWidth-gap*2)/(n-1),
          track=sliding ? (i%2)*(t+0.006) : 0,
          inset=sliding ? 0.012 : 0
        if (cabinetFace || (style && !sliding)) cabinetFront(panelWidth, top-bottom-inset*2, x, (bottom+top)/2, t, d/2-track)
        else panel(panelWidth,top-bottom-inset*2,t,x,(bottom+top)/2,d/2-t/2-track)
      }
    }
    if (base) panel(w,base,t,0,base/2,d/2-0.06-t/2)
    if (scribe) {
      // A separately fitted top filler reaches the finished ceiling, while the
      // carcass/doors stop below it. The recess leaves the door swing unobstructed.
      panel(w, scribe, t, 0, body + scribe / 2, d / 2 - t / 2 - 0.008)
      const scribeReserve=Math.max(frontReserve,t+0.009)
      for (const x of [-1, 1]) panel(t,scribe,d-scribeReserve,x*(w-t)/2,body+scribe/2,-scribeReserve/2)
    }
  }
  function builtInAppliance() {
    const type=e.params!.appliance, integrated=e.params?.integrated === true,
      base=mm(e.params?.cabinetPlinth ?? 0), bw=w-0.036,
      sheet=0.006, bodyTop=h-0.003, bodyDepth=d-0.02,
      inner=type==='fridge' ? white : metal,
      gap=0.0015
    // Thin case walls enclose real space; there is no solid box filling the niche.
    for (const x of [-1,1]) panel(sheet,bodyTop-base,bodyDepth,x*(bw-sheet)/2,(bodyTop+base)/2,-0.01,inner)
    for (const y of [base+sheet/2,bodyTop-sheet/2]) panel(bw-sheet*2,sheet,bodyDepth,0,y,-0.01,inner)
    panel(bw-sheet*2,bodyTop-base-sheet*2,sheet,0,(bodyTop+base)/2,-d/2+sheet/2,inner)
    if (base) {
      const radius=Math.min(0.018,bw/10)
      for (const x of [-bw*.34,bw*.34])
        for (const z of [-d/2+0.07,d/2-0.10]) cylinder(radius,base,x,base/2,z,dark)
    }
    if (integrated) {
      const split=type==='fridge' ? Math.min(base+0.77,h*.45) : 0,
        rows=split ? [[base,split],[split,h]] : [[base,h]]
      for (const [bottom,top] of rows)
        panel(w-gap*2,top-bottom-gap*2,0.018,0,(bottom+top)/2,d/2-0.009)
      if (type==='fridge')
        for (let i=1;i<=4;i++) panel(bw-sheet*2,0.005,bodyDepth-0.025,0,base+(bodyTop-base)*i/5,-0.016,white)
      else {
        for (const y of [base+(h-base)*.3,base+(h-base)*.68]) {
          for (const x of [-bw*.4,bw*.4]) panel(0.008,0.025,bodyDepth*.78,x,y,-.015,metal)
          for (let i=0;i<6;i++) panel(bw*.8,0.004,0.004,0,y,-bodyDepth*.34+i*bodyDepth*.68/5,metal)
        }
      }
      return
    }
    const microwave=type==='microwave', frame=Math.min(0.026,h*.08),
      controls=microwave ? Math.min(0.105,w*.19) : 0,
      windowLeft=-w/2+frame, windowRight=w/2-frame-controls,
      windowBottom=base+frame, windowTop=microwave ? h-frame : h-Math.min(.09,h*.18),
      centerX=(windowLeft+windowRight)/2, windowWidth=windowRight-windowLeft,
      front=d/2-0.004
    // The microwave has a side control column and a turntable; the oven has a
    // full-width top control rail and horizontal cooking racks.
    panel(w,windowBottom-base,0.008,0,(windowBottom+base)/2,front,dark)
    if (microwave) panel(w,h-windowTop,0.008,0,(h+windowTop)/2,front,dark)
    else {
      panel(w,frame,0.008,0,h-frame/2,front,dark)
      const controlRail=panel(w,h-windowTop-frame,0.008,0,(h-frame+windowTop)/2,front-.01,dark)
      controlRail.userData.appliancePart='control-rail'
    }
    panel(frame,windowTop-windowBottom,0.008,-w/2+frame/2,(windowTop+windowBottom)/2,front,dark)
    panel(frame,windowTop-windowBottom,0.008,w/2-frame/2,(windowTop+windowBottom)/2,front,dark)
    if (microwave) {
      const controlRail=panel(controls,windowTop-windowBottom,.008,w/2-frame-controls/2,
        (windowTop+windowBottom)/2,front-.01,dark)
      controlRail.userData.appliancePart='control-rail'
    }
    const glass=(materials.get('glass')??white).clone()
    glass.name='appliance-smoked-glass'; glass.color.set('#52615e'); glass.roughness=.12; glass.transmission=.55
    panel(windowWidth,windowTop-windowBottom,.003,centerX,(windowTop+windowBottom)/2,d/2-.013,glass)
    if (microwave) {
      const controlX=w/2-frame-controls/2
      const display=panel(controls*.68,h*.10,.003,controlX,h*.76,d/2-.0085,glass)
      display.userData.appliancePart='display'
      for (const y of [h*.40,h*.55]) {
        const knob=cylinder(Math.min(.014,controls*.17),.008,controlX,y,d/2-.006,metal)
        knob.rotation.x=Math.PI/2
        knob.userData.appliancePart='control'
      }
      const turntable=cylinder(Math.min(bw*.28,bodyDepth*.29),.006,0,base+.025,-.015,glass)
      turntable.userData.appliancePart='turntable'
      panel(.012,(windowTop-windowBottom)*.6,.008,windowRight-.018,(windowTop+windowBottom)/2,d/2-.004,metal)
      for (const sign of [-1,1]) panel(.012,.012,.0035,windowRight-.018,
        (windowTop+windowBottom)/2+sign*(windowTop-windowBottom)*.27,d/2-.00975,metal)
    } else {
      for (const x of [-w*.32,w*.32]) {
        const knob=cylinder(.017,.008,x,h-.045,d/2-.006,metal)
        knob.rotation.x=Math.PI/2
        knob.userData.appliancePart='control'
      }
      const display=panel(w*.32,.025,.003,0,h-.045,d/2-.0085,glass)
      display.userData.appliancePart='display'
      panel(windowWidth*.8,.014,.008,centerX,windowTop-.035,d/2-.004,metal)
      for (const sign of [-1,1]) panel(.014,.014,.0035,centerX+sign*windowWidth*.37,
        windowTop-.035,d/2-.00975,metal)
      for (const y of [base+h*.3,base+h*.52])
        for (let i=0;i<7;i++) panel(bw*.84,.004,.004,0,y,-bodyDepth*.36+i*bodyDepth*.72/6,metal)
    }
  }
  function cabinetFront(W: number, H: number, x: number, y: number, thickness: number, face: number) {
    const relief = thickness * .32, front = face - relief / 2,
      railWidth = Math.min(.045, W * .12, H * .12)
    box(W, H, thickness - relief, x, y, face - relief - (thickness - relief) / 2)
    if (cabinetFace === 'split') {
      const reveal = Math.min(.004, H * .05), lower = H * .38 - reveal / 2, upper = H - lower - reveal
      box(W, lower, relief, x, y - (H - lower) / 2, front, timber)
      box(W, upper, relief, x, y + (H - upper) / 2, front)
      box(W * .48, reveal, relief * .35, x, y - H * .12, face - relief * .83, dark)
    } else if (cabinetFace === 'recessed') {
      const groove = Math.min(.023, H * .16), lip = Math.min(.007, groove * .3)
      box(W, H - groove, relief, x, y - groove / 2, front)
      box(W, groove - lip, relief * .45, x, y + (H - groove - lip) / 2, face - relief * .7, dark)
      box(W, lip, relief, x, y + (H - lip) / 2, front)
    } else if (style === 'classic' || style === 'loft') {
      const trim = style === 'loft' ? dark : material
      for (const side of [-1, 1]) box(railWidth, H, relief, x + side * (W - railWidth) / 2, y, front, trim)
      for (const side of [-1, 1]) box(W - railWidth * 2, railWidth, relief, x, y + side * (H - railWidth) / 2, front, trim)
      if (style === 'classic') {
        const bead = railWidth * .25
        for (const side of [-1, 1]) box(bead, H - railWidth * 2.7, relief * .65, x + side * (W / 2 - railWidth * 1.4), y, face - relief * .325)
      }
      // Small pull is recessed into the reserved front envelope.
      box(Math.min(.1, W * .3), .006, relief, x, y - H * .22, front, metal)
    } else if (style === 'japandi') {
      const count = Math.max(3, Math.min(16, Math.round(W / .045))), pitch = W / count
      for (let i = 0; i < count; i++) box(pitch * .65, H, relief, x - W / 2 + pitch * (i + .5), y, front, material)
      box(W * .35, .006, relief, x, y - H * .3, front, timber)
    } else {
      // Handleless plane with a continuous dark recessed finger channel.
      box(W, H * .94, relief, x, y - H * .025, front)
      box(W * .9, Math.min(.012, H * .03), relief * .4, x, y + H * .46, face - relief * .8, dark)
    }
  }
  function wallPanel() {
    const treatment = e.params?.treatment ?? 'flat'
    if (treatment === 'flat') { box(w, h, d); return }
    box(w, h, d * .3, 0, h / 2, -d * .35)
    if (treatment === 'arch') {
      const arch = (width: number, height: number, bottom: number, depth: number, z: number, finish: T.Material) => {
        const shape = new T.Shape()
        const radius = Math.min(width * .5, height * .42), spring = bottom + height - radius
        shape.moveTo(-width / 2, bottom)
        shape.lineTo(width / 2, bottom)
        shape.lineTo(width / 2, spring)
        shape.bezierCurveTo(width / 2, spring + radius * 1.32, -width / 2, spring + radius * 1.32, -width / 2, spring)
        shape.closePath()
        mesh(new T.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 16 }), finish, 0, 0, z)
      }
      arch(w * .88, h * .94, h * .03, d * .42, -d * .20, timber)
      arch(w * .81, h * .88, h * .06, d * .28, d * .22, material)
    } else if (treatment === 'band') {
      const lower = h * .41, seam = Math.min(.018, h * .028)
      box(w, lower, d * .7, 0, lower / 2, d * .15, timber)
      box(w, h - lower - seam, d * .45, 0, (h + lower + seam) / 2, d * .025)
      box(w, seam, d * .7, 0, lower + seam / 2, d * .15, dark)
    } else if (treatment === 'slats') {
      const count = Math.max(2, Math.min(64, Math.ceil(w / .055))), pitch = w / count
      for (let i = 0; i < count; i++) box(pitch * .62, h, d * .7, -w / 2 + pitch * (i + .5), h / 2, d * .15)
    } else {
      const count = Math.max(1, Math.min(3, Math.round(w / .85))), pitch = w / count,
        border = Math.min(.035, pitch * .08, h * .06), frameWidth = pitch * .82, frameHeight = h * .84
      for (let i = 0; i < count; i++) {
        const x = -w / 2 + pitch * (i + .5)
        for (const side of [-1, 1]) {
          box(border, frameHeight, d * .7, x + side * (frameWidth - border) / 2, h / 2, d * .15)
          box(frameWidth - border * 2, border, d * .7, x, h / 2 + side * (frameHeight - border) / 2, d * .15)
        }
      }
    }
  }
  function studySofa() {
    const open = furnitureForm === 'open-frame', low = furnitureForm === 'low-slung', club = furnitureForm === 'club'
    const width = w * (open ? .88 : .82), baseY = open ? .24 : .13, seatY = open ? .39 : .29
    const seatTop = seatY + .09, armWidth = (w - width) / 2
    if (open) {
      const beam = Math.min(.038, w * .06, d * .08)
      box(w, beam, beam, 0, h * .22, d * .35, timber)
      box(w, beam, beam, 0, h * .22, -d * .35, timber)
      for (const side of [-1, 1]) {
        const x = side * (w / 2 - armWidth / 2)
        for (const z of [-d * .32, d * .32]) box(beam, h * .65, beam, x, h * .325, z, timber)
        box(armWidth * .86, beam, d * .87, x, h * .65 - beam / 2, 0, timber)
      }
      cushion(width, h * .14, d * .86, 0, h * baseY, 0, material, .022)
    } else {
      const plinth = low ? .64 : .79
      cushion(w * plinth, h * .12, d * plinth, 0, h * .06, 0, dark, .03)
      cushion(w, h * .2, d, 0, h * baseY, 0, material, club ? .095 : .07)
      for (const side of [-1, 1]) {
        const x = side * (w - armWidth) / 2
        const armHeight = club ? .49 : low ? .33 : .39
        cushion(armWidth, h * armHeight, d * .89, x, h * (.2 + armHeight / 2), d * .015, material, .1)
      }
    }
    const count = fixture === 'armchair' || furnitureForm === 'sculptural' ? 1 : Math.max(1, Math.round(w / 1.2))
    const seatWidth = width / count, gap = Math.min(.012, seatWidth * .05)
    for (let i = 0; i < count; i++) {
      const x = -width / 2 + seatWidth * (i + .5)
      cushion(seatWidth - gap, h * .18, d * .72, x, h * seatY, d * .09, material, club ? .09 : .06)
      const backHeight = low ? .4 : club ? .58 : .48
      const back = cushion(seatWidth - gap, h * backHeight, d * .24, x, h * (seatTop + backHeight * .47), -d * .31, material, .12)
      if (furnitureForm === 'sculptural') back.rotation.x = -.12
    }
  }
  function styledSofa() {
    if (furnitureForm) { studySofa(); return }
    const arm = Math.min(w * .12, .18), seats = fixture === 'armchair' ? 1 : Math.max(1, Math.min(3, Math.round(w / .85))),
      seatWidth = (w - arm * 2) / seats
    if (style === 'hitech') {
      box(w * .82, h * .11, d * .8, 0, h * .055, 0, dark)
      cushion(w, h * .24, d, 0, h * .23, 0, material, .018)
      cushion(w, h * .48, d * .16, 0, h * .65, -d * .42, material, .018)
      for (const x of [-w / 2 + arm / 2, w / 2 - arm / 2]) box(arm, h * .3, d * .94, x, h * .39, d * .03)
    } else if (style === 'classic') {
      for (const x of [-w * .38, w * .38]) for (const z of [-d * .34, d * .34]) turnedLeg(x, z, h * .15, Math.min(w, d) * .035)
      cushion(w, h * .25, d, 0, h * .275, 0, material, .05)
      cushion(w, h * .65, d * .19, 0, h * .675, -d * .405, material, .08)
      for (const x of [-w / 2 + arm / 2, w / 2 - arm / 2]) {
        cushion(arm, h * .3, d * .94, x, h * .4, d * .03)
        const roll = mesh(new T.CylinderGeometry(arm / 2, arm / 2, d * .92, 24), material, x, h * .59, d * .02)
        roll.rotation.x = Math.PI / 2
      }
      for (let row = 0; row < 2; row++) for (let i = 0; i < seats * 3; i++)
        ellipsoid(.007, .007, .003, -w / 2 + arm + (w - arm * 2) * (i + .5) / (seats * 3), h * (.68 + row * .16), -d * .305, dark)
    } else {
      const frame = style === 'loft' ? dark : timber
      for (const x of [-w * .4, w * .4]) for (const z of [-d * .34, d * .34])
        box(w * .022, h * .18, d * .035, x, h * .09, z, frame)
      box(w, h * .12, d, 0, h * .2, 0, frame)
      if (style === 'japandi') {
        const count = Math.max(4, Math.round(w / .17))
        for (let i = 0; i < count; i++) box(w / count * .48, h * .62, d * .06, -w / 2 + w * (i + .5) / count, h * .57, -d * .46, timber)
      } else box(w, h * .045, d * .055, 0, h * .83, -d * .46, frame)
      for (const x of [-w / 2 + arm / 2, w / 2 - arm / 2]) {
        box(arm * .55, h * .055, d * .92, x, h * .58, 0, frame)
        for (const z of [-d * .36, d * .36]) box(arm * .25, h * .36, d * .04, x, h * .4, z, frame)
      }
    }
    for (let i = 0; i < seats; i++) {
      const x = -w / 2 + arm + seatWidth * (i + .5), radius = style === 'hitech' || style === 'loft' ? .025 : .07
      cushion(seatWidth - .01, h * .16, d * .72, x, h * .39, d * .08, material, radius)
      cushion(seatWidth - .01, h * .4, d * .18, x, h * .67, -d * .29, material, radius)
    }
  }
  function roundedTabletop(thickness: number) {
    const x = w / 2, z = d / 2, radius = Math.min(.14, x, z)
    const shape = new T.Shape()
    shape.moveTo(-x + radius, -z)
    shape.lineTo(x - radius, -z)
    shape.quadraticCurveTo(x, -z, x, -z + radius)
    shape.lineTo(x, z - radius)
    shape.quadraticCurveTo(x, z, x - radius, z)
    shape.lineTo(-x + radius, z)
    shape.quadraticCurveTo(-x, z, -x, z - radius)
    shape.lineTo(-x, -z + radius)
    shape.quadraticCurveTo(-x, -z, -x + radius, -z)
    const slab = new T.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
    slab.rotateX(-Math.PI / 2)
    mesh(slab, material, 0, h - thickness)
  }
  function styledTable() {
    const top = Math.min(.055, h * .12), legHeight = h - top
    if (fixture === 'bench') {
      cushion(w, h * .2, d, 0, h * .9, 0, material, style === 'hitech' ? .01 : .05)
      for (const x of [-w * .36, w * .36]) for (const z of [-d * .3, d * .3])
        style === 'classic' ? turnedLeg(x, z, h * .8, Math.min(w, d) * .04) : taperedLeg(x, z, h * .8, Math.min(w, d) * .035, style === 'loft' || style === 'hitech' ? dark : timber)
      return
    }
    if (fixture === 'roundedTable') roundedTabletop(top)
    else if (fixture === 'roundTable' || style === 'japandi' || furnitureForm === 'sculptural') {
      const slab = mesh(new T.CylinderGeometry(.5, .5, top, 64), material, 0, h - top / 2, 0)
      slab.scale.set(w, 1, d)
    } else cushion(w, top, d, 0, h - top / 2, 0, material, style === 'classic' ? .025 : .008)
    if (furnitureForm === 'sculptural') {
      const pedestal = mesh(new T.CylinderGeometry(.38, .52, legHeight, 32), timber, 0, legHeight / 2, 0)
      pedestal.scale.set(w * .48, 1, d * .48)
      for (let i = 0; i < 12; i++) {
        const angle = i * Math.PI / 6
        const rib = box(Math.min(w, d) * .025, legHeight * .83, d * .025, Math.cos(angle) * w * .22, legHeight * .45, Math.sin(angle) * d * .22, timber)
        rib.rotation.y = -angle
      }
    } else if (furnitureForm === 'open-frame') {
      const tube = Math.min(.022, w * .04, d * .04)
      for (const side of [-1, 1]) {
        const x = side * w * .33
        for (const z of [-d * .33, d * .33]) rail(new T.Vector3(x, tube / 2, z), new T.Vector3(x * .88, legHeight, z * .81), tube, metal)
        box(tube * 2, tube, d * .71, x, tube / 2, 0, metal)
      }
    } else if (furnitureForm === 'low-slung') {
      for (const x of [-w * .27, w * .27]) cushion(w * .17, legHeight, d * .62, x, legHeight / 2, 0, timber, .05)
    } else if (furnitureForm === 'club') {
      for (const x of [-w * .33, w * .33]) for (const z of [-d * .32, d * .32]) turnedLeg(x, z, legHeight, Math.min(w, d) * .048)
      box(w * .76, h * .10, d * .68, 0, legHeight - h * .05, 0, timber)
    } else if (style === 'hitech') {
      box(w * .42, h * .045, d * .48, 0, h * .0225, 0, metal)
      box(w * .12, legHeight, d * .12, 0, legHeight / 2, 0, metal)
    } else if (style === 'loft') {
      const tube = Math.min(w, d) * .055
      for (const x of [-w * .33, w * .33]) {
        for (const z of [-d * .35, d * .35]) box(tube, legHeight, tube, x, legHeight / 2, z, dark)
        // Open rectangular steel trestle silhouette instead of four timber legs.
        for (const y of [h * .0175, legHeight - h * .0175]) box(tube * 1.2, h * .035, d * .8, x, y, 0, dark)
      }
    } else if (style === 'classic') {
      for (const x of [-w * .34, w * .34]) for (const z of [-d * .3, d * .3]) turnedLeg(x, z, legHeight, Math.min(w, d) * .05)
      for (const z of [-d * .35, d * .35]) box(w * .76, h * .12, d * .035, 0, h - top - h * .06, z, timber)
    } else {
      for (const x of [-w * .24, w * .24]) box(w * .14, legHeight, d * .63, x, legHeight / 2, 0, timber)
    }
  }
  function styledBed() {
    const fabric = materials.get('linen') ?? material, bedding = materials.get('rug') ?? material,
      frame = style === 'loft' || style === 'hitech' ? dark : timber
    if (furnitureForm) {
      const low = furnitureForm === 'low-slung', open = furnitureForm === 'open-frame', club = furnitureForm === 'club'
      const frameTop = h * (low ? .19 : .27), mattressTop = frameTop + h * .2
      const foot = h * (open ? .17 : .06)
      for (const x of [-w * .39, w * .39]) for (const z of [-d * .36, d * .36])
        taperedLeg(x, z, foot, Math.min(w, d) * .022, open ? metal : timber)
      cushion(w, frameTop - foot, d, 0, (frameTop + foot) / 2, 0, frame, .08)
      if (open) {
        const depth = d * .036
        for (let i = 0; i < 8; i++) box(w * .034, h * .69, depth, w * ((i + .5) / 8 - .5), h * .61, -d / 2 + depth / 2, timber)
        for (const y of [.34, .93]) box(w, h * .04, depth, 0, h * y, -d / 2 + depth / 2, timber)
      } else {
        const count = club ? 5 : furnitureForm === 'sculptural' ? 2 : 1, pitch = w / count
        for (let i = 0; i < count; i++) {
          const height = h * (low ? .56 : .75), depth = d * (club ? .093 : .075)
          cushion(pitch * .972, height, depth, w * ((i + .5) / count - .5), frameTop + height / 2 - h * .055, -d / 2 + depth / 2, fabric, .12)
        }
      }
      cushion(w * .95, h * .2, d * .87, 0, mattressTop - h * .1, d * .061, bedding, .055)
      cushion(w * .95, h * .042, d * .5, 0, mattressTop + h * .021, d * .213, fabric, .04)
      for (const x of [-w * .23, w * .23]) cushion(w * .42, h * .105, d * .19, x, mattressTop + h * .05, -d * .27, bedding, .05)
      return
    }
    box(w, h * .14, d, 0, h * .2, 0, frame)
    for (const x of [-w * .4, w * .4]) for (const z of [-d * .38, d * .38]) {
      if (style === 'classic') turnedLeg(x, z, h * .15, Math.min(w, d) * .025)
      else box(w * .025, h * .15, d * .025, x, h * .075, z, frame)
    }
    if (style === 'loft') {
      for (let i = 0; i < 7; i++) box(w * .045, h * .7, d * .04, -w * .43 + w * .86 * i / 6, h * .55, -d * .48, frame)
      for (const y of [h * .25, h * .9]) box(w, h * .06, d * .04, 0, y, -d * .48, frame)
    } else if (style === 'japandi') {
      for (const x of [-w * .43, w * .43]) box(w * .05, h * .62, d * .045, x, h * .46, -d * .4775, timber)
      for (const y of [h * .35, h * .54, h * .73]) box(w, h * .12, d * .045, 0, y, -d * .4775, timber)
    } else {
      cushion(w, h * .85, d * .07, 0, h * .575, -d * .465, style === 'classic' ? timber : fabric, style === 'classic' ? .08 : .012)
      if (style === 'classic') cushion(w * .86, h * .61, d * .035, 0, h * .61, -d * .41, fabric, .065)
    }
    cushion(w * .94, h * .22, d * .86, 0, h * .38, d * .055, bedding)
    cushion(w * .95, h * .055, d * .54, 0, h * .52, d * .19, fabric)
    for (const x of [-w * .23, w * .23]) cushion(w * .41, h * .12, d * .19, x, h * .55, -d * .29, bedding)
  }
  function studyPendant() {
    const radius = Math.min(w, d) / 2
    const canopy = Math.min(.025, h * .1)
    const cord = Math.min(.004, radius * .07)
    const shadeHeight = Math.min(h * .56, radius * 1.42)
    cylinder(Math.min(.062, radius * .5), canopy, 0, h - canopy / 2, 0, metal)
    if (lightForm === 'cluster') {
      const globe = Math.min(w * .115, d * .17, h * .105)
      const chandelierTop = h - canopy
      const railHeight = Math.min(canopy, .018)
      box(w * .82, railHeight, d * .18, 0, chandelierTop - railHeight / 2, 0, metal)
      for (const { center: [x, y] } of optics) {
        const top = y + globe
        cylinder(cord, chandelierTop - top, x, (chandelierTop + top) / 2, 0, metal)
        cylinder(globe * .43, globe * .35, x, top, 0, timber)
      }
      return
    }
    const stem = (bottom: number) => cylinder(cord, h - canopy - bottom, 0, (h - canopy + bottom) / 2, 0, metal)
    if (lightForm === 'lantern') {
      const ring = Math.min(radius * .09, shadeHeight * .08), x = w * .41, z = d * .41
      stem(shadeHeight)
      for (const y of [ring / 2, shadeHeight - ring / 2]) {
        for (const side of [-1, 1]) {
          box(x * 2 + ring, ring, ring, 0, y, side * z, metal)
          box(ring, ring, z * 2 - ring, side * x, y, 0, metal)
        }
      }
      for (const X of [-x, x]) for (const Z of [-z, z]) box(ring, shadeHeight, ring, X, shadeHeight / 2, Z, metal)
    } else if (lightForm === 'disc') {
      const rim = shadeHeight * .18
      const disc = cylinder(w * .49, rim, 0, rim * .67, 0, material)
      disc.scale.z = d / w
      const upper = mesh(new T.CylinderGeometry(w * .22, w * .49, shadeHeight * .44, 32), timber, 0, rim * 1.17 + shadeHeight * .22, 0)
      upper.scale.z = d / w
      stem(rim * 1.17 + shadeHeight * .44)
    } else if (lightForm === 'ribbed') {
      stem(shadeHeight)
      for (let index = 0; index < 24; index++) {
        const angle = index * Math.PI / 12
        const x = Math.cos(angle), z = Math.sin(angle)
        const path = new T.CatmullRomCurve3([
          new T.Vector3(x * w * .17, shadeHeight * .08, z * d * .17),
          new T.Vector3(x * w * .44, shadeHeight * .5, z * d * .44),
          new T.Vector3(x * w * .17, shadeHeight * .92, z * d * .17),
        ])
        mesh(new T.TubeGeometry(path, 8, Math.min(.005, radius * .065), 6, false), timber)
      }
    } else {
      stem(shadeHeight)
      cylinder(radius * .21, Math.min(.03, shadeHeight * .15), 0, shadeHeight, 0, metal)
    }
  }
  function styledPendant() {
    if (lightForm) { studyPendant(); return }
    const radius = Math.min(w, d) / 2, shadeHeight = Math.min(h * .34, radius * 1.1), cord = Math.min(.004, radius * .04)
    cylinder(Math.min(radius * .22, .045), Math.min(.02, h * .08), 0, h - Math.min(.01, h * .04), 0, dark)
    if (style === 'hitech') {
      const barHeight = Math.min(h * .12, .045), barDepth = Math.min(d * .65, .07)
      const thickness = optics[0].size[1]
      box(w, barHeight - thickness, barDepth, 0, (barHeight + thickness) / 2, 0, dark)
      for (const x of [-w * .3, w * .3]) cylinder(cord, h - barHeight, x, (h + barHeight) / 2, 0, metal)
    } else if (style === 'classic') {
      const globe = Math.min(radius * .21, h * .09), centerY = Math.max(globe * 1.6, h * .2)
      cylinder(cord * 2, h - centerY, 0, (h + centerY) / 2, 0, metal)
      for (const { center: [x, , z] } of optics) {
        rail(new T.Vector3(0, centerY, 0), new T.Vector3(x, centerY, z), Math.min(.008, radius * .045), metal)
        cylinder(globe * .3, globe * 1.2, x, centerY + globe * .6, z, metal)
      }
    } else if (style === 'japandi') {
      const ry = Math.min(h * .32, radius * .72), bottom = ry
      cylinder(cord, h - ry * 2, 0, (h + ry * 2) / 2, 0, dark)
      for (let i = 1; i < 6; i++) {
        const y = -ry + ry * 2 * i / 6, scale = Math.sqrt(1 - (y / ry) ** 2)
        const rib = mesh(new T.TorusGeometry(1, .007, 4, 48), timber, 0, bottom + y, 0)
        rib.rotation.x = Math.PI / 2; rib.scale.set(w * .485 * scale, d * .485 * scale, Math.min(w, d) * .3)
      }
    } else {
      cylinder(cord, h - shadeHeight, 0, (h + shadeHeight) / 2, 0, dark)
      const cone = mesh(new T.CylinderGeometry(radius * .22, radius, shadeHeight, 32, 1, true), dark, 0, shadeHeight / 2, 0)
      cone.scale.z = d / w
    }
  }
  if (e.kind === 'WallPanel') wallPanel()
  else if (e.kind === 'Socket' || e.kind === 'Switch') {
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
    const cells = wallCells(len, v.height, v.openings)
    const sideMaterials = [v.materials?.edge, v.materials?.left, v.materials?.right]
      .map(id => id ? materials.get(id)! : material)
    const wallMaterial = sideMaterials.every(m => m === sideMaterials[0]) ? sideMaterials[0] : sideMaterials
    for (const c of cells) {
      const origin = [mm(c.x + c.width / 2), mm(c.y + c.height / 2), 0]
      const part = mesh(wallCellGeometry(c, cells, v.thickness), wallMaterial,
        origin[0], origin[1], 0, wall)
      // UVs stay continuous over opening cells and follow wall length at any angle.
      part.userData.wallUV = { origin, length: mm(len), thickness: mm(v.thickness) }
    }
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
    // The full-width rails own the corners. Jambs meet their underside instead
    // of overlapping coplanar faces, which produce dark corner artifacts.
    const sill = e.kind === 'Window' ? t : 0,
      jambHeight = H - t - sill
    for (const x of [left + t / 2, left + W - t / 2])
      box(t, jambHeight, mm(v.thickness), x, bottom + sill + jambHeight / 2, 0, material, aligned)
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
      const pane = box(
        W - 2 * t,
        H - 2 * t,
        0.008,
        left + W / 2,
        bottom + H / 2,
        0,
        materials.get('glass') ?? material,
        aligned,
      )
      pane.userData.windowPane = true
      // Realtime shadow maps cannot transmit light through a dielectric.
      pane.castShadow = false
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
    box(w, body, d - 0.002, 0, body / 2, -0.001)
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
    // Four concealed stand-offs reach the rear mounting plane inside the given depth.
    for (const x of [-w*.43,w*.43]) for (const y of [h*.15,h*.85]) {
      const stand=cylinder(Math.min(.009,d*.12),d/2,x,y,-d/4,white)
      stand.rotation.x=Math.PI/2
      stand.userData.fixturePart='standoff'
    }
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
    const filterW=w*.68, filterD=d*.65, filterZ=d*.03, side=(w-filterW)/2,
      rear=filterZ-filterD/2+d/2, frontDepth=d/2-filterZ-filterD/2
    // The canopy has a real underside opening, rather than covering its filter.
    for (const sign of [-1,1]) panel(side,h*.1,d,sign*(w+filterW)/4,h*.05)
    panel(filterW,h*.1,rear,0,h*.05,-d/2+rear/2)
    panel(filterW,h*.1,frontDepth,0,h*.05,d/2-frontDepth/2)
    box(w * 0.42, h * 0.9, d * 0.62, 0, h * 0.55, -d * 0.19)
    const filter=panel(filterW,Math.min(.003,h*.05),filterD,0,Math.min(.003,h*.05)/2,filterZ,metal)
    filter.userData.fixturePart='filter'
  } else if (fixture === 'bathShower250') {
    // Product-size shower head/arm; installation height and body profile remain
    // a design envelope, not a manufacturer's mounting template.
    const rear = -d / 2 + .07, headZ = rear + .39, mixerY = .25
    const pipe = new T.CatmullRomCurve3([
      new T.Vector3(0, mixerY, rear), new T.Vector3(0, h - .09, rear),
      new T.Vector3(0, h - .045, rear + .06),
      new T.Vector3(0, h - .045, headZ - .04),
      new T.Vector3(0, h - .12, headZ),
    ], false, 'centripetal')
    mesh(new T.TubeGeometry(pipe, 64, .011, 12, false), metal)
    const head = cylinder(.125, .015, 0, h - .125, headZ, metal)
    head.userData.fixturePart = 'overhead-250'
    const mixer = cylinder(.03, w, 0, mixerY, rear, metal)
    mixer.rotation.z = Math.PI / 2
    for (const x of [-.075, .075]) {
      const mount = cylinder(.025, .07, x, mixerY, rear - .035, metal)
      mount.rotation.x = Math.PI / 2
    }
    box(.045, .025, .18, 0, mixerY, rear + .09, metal)
    const hand = cylinder(.055, .016, .08, .95, rear + .045, metal)
    hand.rotation.x = Math.PI / 2
    cylinder(.012, .18, .08, .81, rear + .045, metal)
    box(.1, .02, .04, .04, .75, rear + .025, metal)
    const hose = new T.CatmullRomCurve3([
      new T.Vector3(0, mixerY - .03, rear + .02),
      new T.Vector3(-.04, .04, rear + .08),
      new T.Vector3(.08, .04, rear + .1),
      new T.Vector3(.08, .72, rear + .045),
    ])
    mesh(new T.TubeGeometry(hose, 36, .007, 8, false), metal)
  } else if (e.kind === 'Shower') {
    const r = Math.min(w * 0.3, d * 0.24)
    cylinder(Math.min(0.012, d * 0.06), h * 0.895, 0, h * 0.5025, -d * 0.35)
    box(w, h * 0.045, d * 0.3, 0, h * 0.1, -d * 0.35, metal)
    box(w * 0.06, h * 0.02, d * 0.6, 0, h * 0.95, -d * 0.05, metal)
    cylinder(r, h * 0.015, 0, h * 0.9325 + Math.min(.001,h*.001), d * 0.25, metal)
  } else if (e.kind === 'GlassPartition') box(w, h, d)
  else if (e.kind === 'Appliance' && (e.params?.builtIn || e.params?.integrated || e.params?.appliance === 'microwave')) builtInAppliance()
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
    box(w-frame*2, h-frame*2, d * 0.4, 0, h / 2, -d * 0.3, timber)
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
  } else if (fixture === 'curtainTrack') {
    box(w, h * 0.8, d, 0, h * 0.6, 0, white)
    box(w - 0.008, h * 0.2, d * 0.28, 0, h * 0.1, 0, metal)
  } else if (fixture === 'bathCurtain') {
    // Folded textile, not a glass box. The lower hem slopes into the bath.
    const cloth = material.clone()
    cloth.side = T.DoubleSide
    const geometry = new T.PlaneGeometry(w, h - 0.03, 60, 16)
    const positions = geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i) + (h - 0.03) / 2
      const tuck = Math.max(0, 1-y/0.25) * 0.04
      positions.setXYZ(i, x, y, Math.sin((x/w+0.5)*Math.PI*20)*0.018-tuck)
    }
    geometry.computeVertexNormals()
    mesh(geometry, cloth)
    for (let i = 0; i < 11; i++) box(0.006, 0.03, 0.006, -w/2+i*w/10, h-0.015, 0, white)
  } else if (fixture === 'mediaScreen' || fixture === 'monitor') mediaScreen(fixture === 'monitor')
  else if (fixture === 'rug') {
    // A fine bound edge remains within the declared textile footprint.
    const seam = Math.min(0.004, h * 0.2)
    cushion(w, h-seam, d, 0, (h-seam)/2, 0, material, Math.min(w, d) * 0.035)
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
  } else if (e.kind === 'Countertop' && fixture === 'joineryPanel') panel(w,h,d)
  else if (e.kind === 'Countertop') {
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
    if (style === 'loft' || style === 'hitech') {
      const post = Math.min(.025, w * .08, d * .08)
      for (const x of [-w / 2 + post / 2, w / 2 - post / 2]) for (const z of [-d / 2 + post / 2, d / 2 - post / 2]) box(post, h, post, x, h / 2, z, style === 'loft' ? dark : metal)
    } else {
      box(0.025, h, d, -w / 2 + 0.0125)
      box(0.025, h, d, w / 2 - 0.0125)
      if (style === 'classic') for (const y of [.025, h - .025]) box(w, .05, d, 0, y)
      if (style === 'japandi') for (let i = 0; i < 7; i++) box(w / 18, h, .015, -w * .4 + w * .8 * i / 6, h / 2, -d / 2 + .0075, timber)
    }
  } else if (e.kind === 'Table') {
    if (style || furnitureForm) styledTable()
    else {
    const topThickness = Math.min(0.035, h * 0.1)
    if (fixture === 'bench') {
      cushion(w, h * 0.2, d, 0, h * 0.9, 0)
      for (const x of [-w * 0.38, w * 0.38])
        for (const z of [-d * 0.32, d * 0.32]) taperedLeg(x, z, h * 0.8, Math.min(w, d) * 0.045)
    } else if (fixture === 'roundedTable') {
      roundedTabletop(topThickness)
      const foot = Math.min(.025, h * .08), columnHeight = h - topThickness - foot
      box(w * .62, foot, d * .48, 0, foot / 2, 0, dark)
      box(w * .16, columnHeight, d * .16, 0, foot + columnHeight / 2, 0, dark)
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
    }
  } else if (e.kind === 'Bed') {
    if (style || furnitureForm) styledBed()
    else {
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
    }
  } else if (e.kind === 'Sofa') {
    if (fixture === 'diningChair' || fixture === 'officeChair') chair(fixture === 'officeChair')
    else if (style || furnitureForm) styledSofa()
    else {
      const arm = Math.min(w * 0.12, 0.16),
        seats = fixture === 'armchair' ? 1 : Math.max(1, Math.min(3, Math.round(w / 0.85))),
        seatWidth = (w - arm * 2) / seats,
        gap = Math.min(0.012, seatWidth * 0.025)
      for (const x of [-w * 0.39, w * 0.39])
        for (const z of [-d * 0.34, d * 0.34])
          taperedLeg(x, z, h * 0.12, Math.min(w, d) * 0.027, dark)
      // Hidden backing ends inside the arms, avoiding duplicate exterior side planes.
      const trim=Math.min(.004,w*.01,d*.01)
      cushion(w-trim, h * 0.27, d-trim, 0, h * 0.255, 0)
      const backrest=cushion(w-trim, h * 0.64, d * 0.16, 0, h * 0.68, -d * 0.42)
      backrest.userData.upholsteryPart='backrest'
      for (const x of [-w / 2 + arm / 2, w / 2 - arm / 2])
        cushion(arm, h * 0.49, d * 0.95, x, h * 0.455, d * 0.025)
      for (let i = 0; i < seats; i++) {
        const x = -w / 2 + arm + seatWidth * (i + 0.5)
        const seat=cushion(seatWidth - gap, h * 0.13, d * 0.72, x, h * 0.455, d * 0.08)
        seat.userData.upholsteryPart='seat'
        const pillow=cushion(seatWidth - gap, h * 0.4, d * 0.19, x, h * 0.705, -d * 0.245)
        pillow.userData.upholsteryPart='back-cushion'
      }
    }
  } else if (e.kind === 'TrackLight') {
    if (style === 'hitech') {
      box(w, h * .35, d, 0, h * .825, 0, dark)
    } else if (style === 'classic' || style === 'japandi') {
      box(w, h * .12, d * .3, 0, h * .94, 0, style === 'classic' ? metal : timber)
      for (const { center: [x], size: [diameter] } of optics) {
        cylinder(diameter * .075, h * .5, x, h * .65, 0, metal)
      }
    } else {
      const railHeight = Math.min(.035, h * .2)
      box(w, railHeight, Math.min(.04, d), 0, h - railHeight / 2, 0, style ? dark : metal)
      for (const { center: [x], size: [diameter, thickness] } of optics) {
        cylinder(diameter / 1.68, h * .7 - thickness, x, h * .45 + thickness / 2, 0, style ? dark : metal)
      }
    }
  } else if (e.kind === 'Spotlight') {
    if (style === 'hitech') {
      const thickness = optics[0].size[1]
      box(w, h - thickness, d, 0, (h + thickness) / 2, 0, dark)
    } else {
      const radius = Math.min(w, d) / 2, diffuserRadius = optics[0].size[0] / 2
      const recess = Math.min(.004, h * .2)
      // Closed annular housing: its central opening exposes and seats the diffuser.
      mesh(new T.LatheGeometry([
        new T.Vector2(0, recess), new T.Vector2(diffuserRadius, recess),
        new T.Vector2(diffuserRadius, 0), new T.Vector2(radius, 0),
        new T.Vector2(radius, h), new T.Vector2(0, h),
      ], 48), metal)
      if (style === 'classic') {
        const ring = mesh(new T.TorusGeometry(Math.min(w, d) * .455, Math.min(w, d, h) * .025, 8, 32), metal, 0, h * .06, 0)
        ring.rotation.x = Math.PI / 2
      }
    }
  } else if (e.kind === 'Pendant') {
    if (style || lightForm) styledPendant()
    else {
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
    }
  }
  if (optics.length) {
    const diffuser = (materials.get(e.roomId === 'bathroom' ? 'bathroom-light' : 'light') ?? white).clone()
    diffuser.color.set('#aaa8a3')
    diffuser.emissive.set(fixtureColor(e))
    diffuser.emissiveIntensity = Math.max(1.5, diffuser.emissiveIntensity)
    for (const { shape, center: [x, y, z], size: [width, height, depth] } of optics) {
      const lightSurface = shape === 'globe'
        ? ellipsoid(width / 2, height / 2, depth / 2, x, y, z, diffuser)
        : shape === 'disc' ? cylinder(width / 2, height, x, y, z, diffuser)
          : box(width, height, depth, x, y, z, diffuser)
      if (shape === 'disc') lightSurface.scale.z = depth / width
      lightSurface.userData.fixtureDiffuser = true
    }
  }
  // DimensionLine / RoomLabel are presentation annotations, built separately.
  g.updateMatrixWorld(true)
  return g
}
