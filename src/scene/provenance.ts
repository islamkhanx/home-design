import type { Apartment } from '../domain/schema.ts'

export function renderNotice(a: Apartment, room: string): string[] {
  if (!a.generation) return []
  const generated = a.objects.some((o) => o.generated && !o.electrical && (room === 'all' || o.roomId === room))
  const incomplete = a.rooms.some((r) => !r.polygon)
  return [
    generated
      ? 'Интерьер сгенерирован автоматически'
      : 'Автоматическая визуализация · выбранная композиция',
    incomplete
      ? 'Неполная модель · геометрия на сверке · размеры условные'
      : 'Контур по исходному плану · масштаб по окну · нужен обмер',
  ]
}

/** Burn the notice into exported pixels; DOM overlays are absent from WebGL screenshots. */
export function screenshotWithNotice(source: HTMLCanvasElement, lines: string[]): string {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(source, 0, 0)
  if (lines.length) {
    const size = Math.max(12, Math.round(canvas.width / 85))
    const pad = size,
      height = size * 4.6
    ctx.fillStyle = '#f9f8f4ee'
    ctx.fillRect(0, canvas.height - height, canvas.width, height)
    ctx.fillStyle = '#42523d'
    ctx.font = `600 ${size}px sans-serif`
    ctx.fillText(lines[0], pad, canvas.height - height + size * 1.7, canvas.width - pad * 2)
    ctx.font = `${size * 0.85}px sans-serif`
    ctx.fillText(lines[1], pad, canvas.height - height + size * 3.2, canvas.width - pad * 2)
  }
  return canvas.toDataURL('image/png')
}
