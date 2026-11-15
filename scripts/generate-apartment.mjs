import { readFile, writeFile } from 'node:fs/promises'
import { restoreSourcePlan } from '../src/domain/source-plan.ts'
import { generateSourceInteriors } from '../src/domain/interior-preset.ts'
import { generateElectrical } from '../src/domain/electrical.ts'
import { parseApartment } from '../src/domain/schema.ts'
const file = new URL('../src/data/apartment.json', import.meta.url)
const a = parseApartment(JSON.parse(await readFile(file, 'utf8')))
const bathroom = JSON.parse(
  await readFile(new URL('../src/data/bathroom-interior.json', import.meta.url), 'utf8'),
)
const result = generateElectrical(generateSourceInteriors(restoreSourcePlan(a, bathroom)))
await writeFile(file, JSON.stringify(result, null, 2) + '\n')
console.log(
  'Generated furnishings in the traced source plan. Scale from 2400 mm window; not a measured construction plan.',
)
