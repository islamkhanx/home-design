import { PerspectiveCamera, Vector3, MathUtils } from 'three'

/** Walking stays horizontal; zoom changes the lens, never the eye point. */
export function indoorView(
  camera: PerspectiveCamera,
  canStand: (p: number[]) => boolean = () => false,
) {
  const direction = camera.getWorldDirection(new Vector3())
  let yaw = Math.atan2(direction.x, direction.z)
  let pitch = Math.asin(MathUtils.clamp(direction.y, -1, 1))
  return {
    walk(forward: number, right: number, seconds: number, fast = false) {
      const magnitude = Math.hypot(forward, right)
      if (!magnitude || seconds <= 0) return false
      // Cap tab-resume deltas and sweep in 2 cm steps to prevent tunnelling.
      const distance = (Math.min(seconds, 0.1) * (fast ? 2 : 1.1)) / Math.max(1, magnitude)
      const dx = (Math.sin(yaw) * forward - Math.cos(yaw) * right) * distance
      const dz = (Math.cos(yaw) * forward + Math.sin(yaw) * right) * distance
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.02)),
        before = camera.position.clone()
      for (let i = 0; i < steps; i++) {
        const x = camera.position.x,
          z = camera.position.z,
          sx = dx / steps,
          sz = dz / steps
        if (canStand([x + sx, z + sz])) {
          camera.position.x += sx
          camera.position.z += sz
        } else if (canStand([x + sx, z])) camera.position.x += sx
        else if (canStand([x, z + sz])) camera.position.z += sz
      }
      camera.updateMatrixWorld()
      return !camera.position.equals(before)
    },
    look(dx: number, dy: number) {
      yaw += dx * 0.004
      pitch = MathUtils.clamp(pitch + dy * 0.004, -Math.PI * 0.44, Math.PI * 0.44)
      camera.lookAt(
        camera.position
          .clone()
          .add(
            new Vector3(
              Math.sin(yaw) * Math.cos(pitch),
              Math.sin(pitch),
              Math.cos(yaw) * Math.cos(pitch),
            ),
          ),
      )
      camera.updateMatrixWorld()
    },
    zoom(delta: number) {
      camera.fov = MathUtils.clamp(camera.fov + delta * 0.035, 38, 85)
      camera.updateProjectionMatrix()
    },
  }
}

export function bindIndoorControls(
  camera: PerspectiveCamera,
  canvas: HTMLCanvasElement,
  changed: () => void,
  canStand: (p: number[]) => boolean,
) {
  const view = indoorView(camera, canStand),
    pressed = new Set<string>()
  let animation = 0,
    lastTime = 0,
    disposed = false
  const walkKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'])
  function animate(time: number) {
    if (disposed) return
    const dt = lastTime ? (time - lastTime) / 1000 : 0
    lastTime = time
    if (
      view.walk(
        Number(pressed.has('KeyW')) - Number(pressed.has('KeyS')),
        Number(pressed.has('KeyD')) - Number(pressed.has('KeyA')),
        dt,
        pressed.has('ShiftLeft') || pressed.has('ShiftRight'),
      )
    )
      changed()
    if (pressed.size) animation = requestAnimationFrame(animate)
    else {
      animation = 0
      lastTime = 0
    }
  }
  function stop() {
    pressed.clear()
    cancelAnimationFrame(animation)
    animation = 0
    lastTime = 0
  }
  const previous = {
    touchAction: canvas.style.touchAction,
    cursor: canvas.style.cursor,
    tabIndex: canvas.getAttribute('tabindex'),
  }
  let pointer: { id: number; x: number; y: number } | null = null
  canvas.style.touchAction = 'none'
  canvas.style.cursor = 'grab'
  canvas.tabIndex = 0
  function down(event: PointerEvent) {
    if (event.button !== 0 || pointer) return
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
    canvas.setPointerCapture(event.pointerId)
    canvas.focus({ preventScroll: true })
    canvas.style.cursor = 'grabbing'
  }
  function move(event: PointerEvent) {
    if (!pointer || pointer.id !== event.pointerId) return
    view.look(event.clientX - pointer.x, event.clientY - pointer.y)
    pointer.x = event.clientX
    pointer.y = event.clientY
    changed()
  }
  function up(event: PointerEvent) {
    if (pointer?.id !== event.pointerId) return
    pointer = null
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    canvas.style.cursor = 'grab'
  }
  function wheel(event: WheelEvent) {
    event.preventDefault()
    view.zoom(
      event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1),
    )
    changed()
  }
  function key(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (walkKeys.has(event.code)) {
      event.preventDefault()
      pressed.add(event.code)
      if (!animation) animation = requestAnimationFrame(animate)
      return
    }
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [20, 0],
      ArrowRight: [-20, 0],
      ArrowUp: [0, 20],
      ArrowDown: [0, -20],
    }
    if (!arrows[event.key]) return
    event.preventDefault()
    view.look(...arrows[event.key])
    changed()
  }
  function keyUp(event: KeyboardEvent) {
    pressed.delete(event.code)
  }
  function visibility() {
    if (document.hidden) stop()
  }
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)
  canvas.addEventListener('lostpointercapture', up)
  canvas.addEventListener('wheel', wheel, { passive: false })
  canvas.addEventListener('keydown', key)
  canvas.addEventListener('keyup', keyUp)
  canvas.addEventListener('blur', stop)
  window.addEventListener('blur', stop)
  document.addEventListener('visibilitychange', visibility)
  return () => {
    disposed = true
    stop()
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', up)
    canvas.removeEventListener('pointercancel', up)
    canvas.removeEventListener('lostpointercapture', up)
    canvas.removeEventListener('wheel', wheel)
    canvas.removeEventListener('keydown', key)
    canvas.removeEventListener('keyup', keyUp)
    canvas.removeEventListener('blur', stop)
    window.removeEventListener('blur', stop)
    document.removeEventListener('visibilitychange', visibility)
    if (pointer && canvas.hasPointerCapture(pointer.id)) canvas.releasePointerCapture(pointer.id)
    canvas.style.touchAction = previous.touchAction
    canvas.style.cursor = previous.cursor
    if (previous.tabIndex === null) canvas.removeAttribute('tabindex')
    else canvas.setAttribute('tabindex', previous.tabIndex)
  }
}
