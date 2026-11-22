import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera, Vector3 } from 'three'
import { indoorView, bindIndoorControls } from '../src/scene/indoor-controls.ts'
import { readFileSync } from 'node:fs'
import { buildCanonical, disposeTree } from '../src/scene/canonical.ts'
import {
  prepareWalkthroughApartment,
  walkingSpace,
  safeWalkingStart,
} from '../src/scene/walking-space.ts'
import { roomSelectionView } from '../src/scene/cameras.ts'

test('room selection enters the room, while explicit technical views remain selected', () => {
  for (const mode of ['dollhouse', 'free', 'interior'] as const) {
    assert.equal(roomSelectionView(mode, 'bathroom'), 'interior')
    assert.equal(roomSelectionView(mode, 'all'), 'dollhouse')
  }
  for (const mode of ['plan', 'electrical', 'ceiling'] as const)
    assert.equal(roomSelectionView(mode, 'bedroom'), mode)
})
test('walking is horizontal, follows facing direction, slides and cannot cross a wall', () => {
  const c = new PerspectiveCamera()
  c.position.set(0, 1.6, 0)
  c.lookAt(0, 1.6, -1)
  const controls = indoorView(c, (p) => p[1] > -0.35)
  for (let i = 0; i < 50; i++) controls.walk(1, 0, 0.1, true)
  assert.ok(c.position.z > -0.35 && c.position.z < -0.3)
  const before = c.position.clone()
  controls.walk(1, 1, 0.1)
  assert.ok(c.position.x > before.x, 'strafe slides along wall')
  assert.equal(c.position.y, 1.6)
  const start = c.position.clone()
  controls.walk(-1, 0, 100, true)
  assert.ok(c.position.distanceTo(start) <= 0.201, 'stalled frame must not teleport')
})
test('every room starts in a free walking position and only internal doors are posed open', async () => {
  const a = JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8'))
  const before = JSON.stringify(a),
    staged = prepareWalkthroughApartment(a),
    root = await buildCanonical(staged)
  try {
    const space = walkingSpace(staged, root)
    for (const r of staged.rooms) {
      const p = r.interiorCamera!.position
      const safe = safeWalkingStart(
        [p[0] / 1000, p[2] / 1000],
        space,
        r.polygon!.map((p) => p.map((n) => n / 1000)),
      )
      assert.ok(space.free(safe), r.id)
    }
    assert.equal(staged.objects.find((o) => o.id === 'door-entry')?.params?.doorAngle, 0)
    assert.equal(JSON.stringify(a), before)
  } finally {
    disposeTree(root)
  }
})

test('a live proposal corrects an occupied eye point and clears hidden furniture from navigation', async () => {
  const source = JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8'))
  const model = prepareWalkthroughApartment(source)
  const sofa = model.objects.find(o => o.kind === 'Sofa' && o.roomId === 'living' && !o.params?.fixture)!
  const eye = [sofa.position[0] / 1000, sofa.position[2] / 1000]
  const root = await buildCanonical(model)
  try {
    const occupied = walkingSpace(model, root)
    assert.equal(occupied.free(eye), false)
    const movedEye = safeWalkingStart(eye, occupied)
    assert.ok(occupied.free(movedEye))
    assert.ok(Math.hypot(movedEye[0] - eye[0], movedEye[1] - eye[1]) <= 0.8)

    sofa.visible = false
    const clear = walkingSpace(model, root)
    assert.equal(clear.free(eye), true)
    assert.deepEqual(safeWalkingStart(eye, clear), eye)
  } finally {
    disposeTree(root)
  }
})
test('losing focus or disposing controls stops held movement and removes listeners', () => {
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    request: globalThis.requestAnimationFrame,
    cancel: globalThis.cancelAnimationFrame,
  }
  const windowMock = new EventTarget(),
    documentMock = new EventTarget(),
    canvas = new EventTarget() as any
  Object.assign(canvas, {
    style: { touchAction: '', cursor: '' },
    getAttribute: () => null,
    removeAttribute: () => {},
    setAttribute: () => {},
    hasPointerCapture: () => false,
  })
  const pending = new Map<number, FrameRequestCallback>()
  let id = 0
  Object.assign(globalThis, {
    window: windowMock,
    document: documentMock,
    requestAnimationFrame: (f: FrameRequestCallback) => {
      pending.set(++id, f)
      return id
    },
    cancelAnimationFrame: (i: number) => pending.delete(i),
  })
  const tick = (time: number) => {
    const callbacks = [...pending.values()]
    pending.clear()
    callbacks.forEach((f) => f(time))
  }
  const key = (type: string, code: string) =>
    canvas.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code }))
  let dispose: (() => void) | undefined
  try {
    const c = new PerspectiveCamera()
    c.position.set(0, 1.6, 0)
    c.lookAt(0, 1.6, -1)
    dispose = bindIndoorControls(
      c,
      canvas,
      () => {},
      () => true,
    )
    key('keydown', 'KeyW')
    tick(10)
    tick(60)
    assert.ok(c.position.z < 0)
    windowMock.dispatchEvent(new Event('blur'))
    const stopped = c.position.clone()
    tick(500)
    assert.deepEqual(c.position.toArray(), stopped.toArray())
    assert.equal(pending.size, 0)
    key('keydown', 'KeyW')
    dispose()
    key('keydown', 'KeyW')
    tick(600)
    assert.equal(pending.size, 0)
    assert.deepEqual(c.position.toArray(), stopped.toArray())
  } finally {
    dispose?.()
    Object.assign(globalThis, {
      window: original.window,
      document: original.document,
      requestAnimationFrame: original.request,
      cancelAnimationFrame: original.cancel,
    })
  }
})
test('indoor dragging and zooming cannot orbit or move the eye through a wall', () => {
  const camera = new PerspectiveCamera(66, 16 / 9, 0.02, 200)
  camera.position.set(1.6, 1.6, 1.3)
  camera.lookAt(0.3, 1.1, 0.95)
  const eye = camera.position.clone(),
    before = camera.getWorldDirection(new Vector3()),
    controls = indoorView(camera)
  controls.look(200, 60)
  assert.ok(camera.getWorldDirection(new Vector3()).distanceTo(before) > 0.1)
  for (let i = 0; i < 100; i++) {
    controls.look(100, 100)
    controls.zoom(1000)
  }
  assert.deepEqual(camera.position.toArray(), eye.toArray())
  assert.equal(camera.fov, 85)
  controls.zoom(-100000)
  assert.equal(camera.fov, 38)
  assert.ok(Math.abs(camera.getWorldDirection(new Vector3()).y) < 0.99)
  assert.deepEqual(camera.position.toArray(), eye.toArray())
})
