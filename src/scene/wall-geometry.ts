import * as T from 'three'
import { mm } from '../domain/math.ts'
import type { Cell } from '../domain/math.ts'

/** Keep one collision volume per opening cell, but omit buried internal faces. */
export function wallCellGeometry(cell: Cell, cells: Cell[], thickness: number): T.BufferGeometry {
  const geometry = new T.BoxGeometry(mm(cell.width), mm(cell.height), mm(thickness))
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-7
  const xNeighbour = (x: number, end: boolean) => cells.some(c => c !== cell &&
    same(end ? c.x + c.width : c.x, x) && same(c.y, cell.y) && same(c.height, cell.height))
  const yNeighbour = (y: number, end: boolean) => cells.some(c => c !== cell &&
    same(end ? c.y + c.height : c.y, y) && same(c.x, cell.x) && same(c.width, cell.width))
  // BoxGeometry order: +X, -X, +Y, -Y, +Z (left), -Z (right).
  const visible = [
    !xNeighbour(cell.x + cell.width, false), !xNeighbour(cell.x, true),
    !yNeighbour(cell.y + cell.height, false), !yNeighbour(cell.y, true), true, true,
  ]
  const original = geometry.index!, indices: number[] = [], counts = [0, 0, 0]
  for (let face = 0; face < 6; face++) {
    if (!visible[face]) continue
    const group = geometry.groups[face], material = face < 4 ? 0 : face - 3
    for (let i = group.start; i < group.start + group.count; i++) indices.push(original.getX(i))
    counts[material] += group.count
  }
  geometry.setIndex(indices)
  geometry.clearGroups()
  let start = 0
  for (let material = 0; material < counts.length; material++) {
    if (counts[material]) geometry.addGroup(start, counts[material], material)
    start += counts[material]
  }
  return geometry
}
