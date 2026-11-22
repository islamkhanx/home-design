import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reviewApartment } from '../src/review/review.ts'
import { homeReviewProfile } from '../src/review/home-profile.ts'

const project = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

export function parseReviewArgs(args) {
  const result = {
    input: path.join(project, 'src/data/apartment.json'),
    profile: 'home',
    json: false,
    strict: false,
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--json') result.json = true
    else if (arg === '--strict') result.strict = true
    else if (arg === '--help' || arg === '-h') result.help = true
    else if (['--input', '--output', '--profile'].includes(arg)) {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
      result[arg.slice(2)] = value
    } else throw new Error(`Unknown review argument: ${arg}`)
  }
  if (!['home', 'none'].includes(result.profile)) throw new Error('Profile must be home or none')
  if (result.output && path.resolve(result.output) === path.resolve(result.input))
    throw new Error('Review output must not overwrite the input apartment')
  return result
}

export async function runReview(args = process.argv.slice(2)) {
  const options = parseReviewArgs(args)
  if (options.help) {
    console.log(
      'Usage: npm run review:geometry -- [--input apartment.json] [--profile home|none] [--json] [--output report.json] [--strict]\nRead-only model review. Exit 1 for errors; --strict also fails on warnings. Exit 2 for invalid inputs. No renders or model regeneration.',
    )
    return 0
  }
  const bytes = await readFile(options.input)
  if (options.output) {
    // Resolve path and inode aliases; a symlink or hardlink must not let a report replace its source.
    const { realpath, stat } = await import('node:fs/promises')
    const inputReal = await realpath(options.input)
    const outputReal = await realpath(options.output).catch((error) => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
    const [inputStat, outputStat] = await Promise.all([
      stat(options.input),
      stat(options.output).catch((error) => {
        if (error.code !== 'ENOENT') throw error
        return null
      }),
    ])
    if (
      inputReal === outputReal ||
      (outputStat && inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino)
    )
      throw new Error('Review output must not overwrite the input apartment')
  }
  const report = {
    sourceHash: createHash('sha256').update(bytes).digest('hex'),
    ...(await reviewApartment(
      JSON.parse(bytes.toString('utf8')),
      options.profile === 'home' ? homeReviewProfile : undefined,
    )),
  }
  const json = JSON.stringify(report, null, 2) + '\n'
  if (options.output) {
    await mkdir(path.dirname(path.resolve(options.output)), { recursive: true })
    await writeFile(options.output, json)
  }
  if (options.json) console.log(json.trimEnd())
  else {
    console.log(
      `Geometry review: ${report.status}; ${report.errors} errors, ${report.warnings} warnings`,
    )
    console.log(
      `${report.coverage.rooms} rooms; ${report.coverage.walls} walls; ${report.coverage.electricalPoints} electrical points; ${report.coverage.sampledCeilingJoins} sampled ceiling joins`,
    )
    console.log(
      `${report.coverage.motions.movingParts} moving parts; ${report.coverage.motions.sampledPoses} sampled poses; ${(report.navigation ?? []).filter((t) => t.status === 'reachable').length}/${report.navigation?.length ?? 0} targets reachable`,
    )
    for (const finding of report.findings)
      console.log(
        `[${finding.severity}] ${finding.rule}: ${finding.entityIds.join(', ')} — ${finding.message}`,
      )
    for (const item of report.manualReview) console.log(`[manual] ${item}`)
    for (const item of report.limits) console.log(`[scope] ${item}`)
    if (options.output) console.log(`Report: ${path.resolve(options.output)}`)
  }
  return report.errors || (options.strict && report.warnings) ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runReview()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
  }
}
