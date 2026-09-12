import { execFile } from 'node:child_process'
import { rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { ffmpegPath } from './binaries'
import { CancelToken } from './cancel'
import type { CompressOptions, CompressResult, ProgressFn } from './types'
import { probe, runFfmpeg, StageAbortedError, uniquePath } from './video'

/**
 * "Max Squeeze": the smallest file that still looks good, within a wall-clock budget
 * (default 10 min) per file.
 *
 * Video tries encoders from most to least efficient. Each attempt projects its own
 * finish time once it has warmed up and aborts itself if it would overrun its share
 * of the budget, so the next (faster) encoder still has room. Measured on 1080p:
 * H.265 CRF 30 is ~40% smaller than H.264 CRF 27 but ~3x slower; slower presets and
 * libaom AV1 were not smaller for the time, so they're not in the ladder.
 */

export const DEFAULT_BUDGET_MS = 10 * 60 * 1000
const SAFETY_MARGIN_MS = 15_000 // muxing + file swap
const WARMUP_FRACTION = 0.06 // project only once we have a meaningful sample
const WARMUP_MS = 12_000
const MAX_VIDEO_SIDE = 1920 // 4K -> 1080p is a fair trade for "smallest"
const MAX_IMAGE_SIDE = 2048

interface Stage {
  name: string
  label: string
  encoder: string
  args: string[]
  /** Fraction of the total budget this stage may use, so faster fallbacks still fit. */
  budgetShare: number
  scale?: string
}

const capScale = (side: number): string =>
  `scale=w='min(${side},iw)':h='min(${side},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`

// H.264 at veryfast is ~3x faster than H.265 medium, so 0.65 + 0.35 leaves H.264 room
// to finish even when H.265 is killed at the very end of its share.
const VIDEO_STAGES: Stage[] = [
  {
    name: 'h265',
    label: 'deep pass (H.265)',
    encoder: 'libx265',
    args: [
      '-c:v',
      'libx265',
      '-preset',
      'medium',
      '-crf',
      '30',
      '-tag:v',
      'hvc1',
      '-x265-params',
      'log-level=error'
    ],
    budgetShare: 0.65
  },
  {
    name: 'h264',
    label: 'quick pass (H.264)',
    encoder: 'libx264',
    args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-profile:v', 'high'],
    budgetShare: 1
  },
  {
    // Only reached if even H.264 can't finish: much faster and a quarter of the pixels.
    name: 'emergency',
    label: 'emergency pass (720p)',
    encoder: 'libx264',
    args: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28'],
    budgetShare: 1,
    scale: capScale(1280)
  }
]

let encoderCache: Set<string> | null = null
/** ffmpeg-static builds differ per OS; only use encoders this binary actually has. */
async function availableEncoders(): Promise<Set<string>> {
  if (encoderCache) return encoderCache
  try {
    const { stdout } = await promisify(execFile)(ffmpegPath(), ['-hide_banner', '-encoders'], {
      windowsHide: true
    })
    encoderCache = new Set(
      stdout
        .split('\n')
        .map((l) => /^\s*V[\w.]{5}\s+(\S+)/.exec(l)?.[1])
        .filter((x): x is string => !!x)
    )
  } catch {
    encoderCache = new Set(['libx264'])
  }
  return encoderCache
}

function fmtMinutes(ms: number): string {
  const m = ms / 60000
  return `${m >= 1 ? Math.round(m) : m.toFixed(1)} minute${m === 1 ? '' : 's'}`
}

function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left`
}

export async function squeezeVideo(
  input: string,
  opts: CompressOptions,
  onProgress: ProgressFn,
  cancel: CancelToken
): Promise<CompressResult> {
  const budget = opts.timeBudgetMs ?? DEFAULT_BUDGET_MS
  const started = Date.now()
  const deadline = started + budget
  const info = await probe(input)
  const encoders = await availableEncoders()
  cancel.throwIfCancelled()
  const inputBytes = (await stat(input)).size
  const notes: string[] = []

  const outDir = opts.outputDir ?? path.dirname(input)
  const base = path.parse(input).name
  const outputPath = uniquePath(path.join(outDir, `${base}-squeezed.mp4`))
  const tmp = path.join(outDir, `.${base}-squeeze.tmp.mp4`)

  const audio = info.hasAudio ? ['-c:a', 'aac', '-b:a', '80k', '-ac', '2'] : ['-an']
  if (Math.max(info.width, info.height) > MAX_VIDEO_SIDE) notes.push('capped at 1080p')

  try {
    for (const stage of VIDEO_STAGES) {
      cancel.throwIfCancelled()
      if (!encoders.has(stage.encoder)) continue
      const stageDeadline =
        Math.min(deadline, started + budget * stage.budgetShare) - SAFETY_MARGIN_MS
      if (Date.now() >= stageDeadline) continue
      const stageStart = Date.now()
      try {
        await runFfmpeg(
          [
            '-y',
            '-hide_banner',
            '-nostats',
            '-progress',
            'pipe:1',
            '-i',
            input,
            '-vf',
            stage.scale ?? capScale(MAX_VIDEO_SIDE),
            ...stage.args,
            '-pix_fmt',
            'yuv420p',
            ...audio,
            '-movflags',
            '+faststart',
            tmp
          ],
          info.durationSec,
          (f) => onProgress(f, `${stage.label} · ${fmtLeft(deadline - Date.now())}`),
          cancel,
          (fraction, elapsed) => {
            if (fraction <= 0 || (fraction < WARMUP_FRACTION && elapsed < WARMUP_MS)) return null
            const projectedFinish = stageStart + elapsed / fraction
            return projectedFinish > stageDeadline
              ? `needs ~${Math.round(elapsed / fraction / 60000)} min, over budget`
              : null
          }
        )
      } catch (err) {
        await rm(tmp, { force: true }).catch(() => {})
        if (err instanceof StageAbortedError) {
          notes.push(`${stage.label} skipped: ${err.reason}`)
          continue
        }
        throw err
      }
      const outputBytes = (await stat(tmp)).size
      await rename(tmp, outputPath)
      notes.unshift(stage.label)
      if (outputBytes >= inputBytes)
        notes.push('source was already very efficient; output is not smaller')
      onProgress(1, 'done')
      return { outputPath, inputBytes, outputBytes, notes }
    }
    throw new Error(
      `This video is too long to squeeze within ${fmtMinutes(budget)}. Try Target size mode, or trim it first.`
    )
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

export async function squeezeImage(
  input: string,
  opts: CompressOptions,
  onProgress: ProgressFn,
  cancel: CancelToken
): Promise<CompressResult> {
  const inputBytes = (await stat(input)).size
  const notes: string[] = []
  const strip = opts.stripMetadata ?? true
  const outDir = opts.outputDir ?? path.dirname(input)
  const outputPath = uniquePath(path.join(outDir, `${path.parse(input).name}-squeezed.webp`))

  onProgress(0.1, 'decoding')
  const src = sharp(input, { failOn: 'none', animated: false }).rotate()
  const meta = await src.metadata()
  if (!meta.width || !meta.height) throw new Error('Could not read image dimensions')
  cancel.throwIfCancelled()

  let pipeline = src
  if (Math.max(meta.width, meta.height) > MAX_IMAGE_SIDE) {
    pipeline = pipeline.resize(MAX_IMAGE_SIDE, MAX_IMAGE_SIDE, {
      fit: 'inside',
      withoutEnlargement: true,
      kernel: 'lanczos3'
    })
    notes.push(`capped at ${MAX_IMAGE_SIDE}px`)
  }
  if (!strip) pipeline = pipeline.withMetadata()

  onProgress(0.4, 'encoding WebP (max effort)')
  // effort 6 is libwebp's slowest/smallest setting; still only seconds even for huge images.
  const buf = await pipeline.webp({ quality: 75, effort: 6, smartSubsample: true }).toBuffer()
  cancel.throwIfCancelled()
  await writeFile(outputPath, buf)
  notes.push('WebP q75')
  if (buf.length >= inputBytes)
    notes.push('source was already very efficient; output is not smaller')
  onProgress(1, 'done')
  return { outputPath, inputBytes, outputBytes: buf.length, notes }
}
