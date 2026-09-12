import { stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { CancelToken } from './cancel'
import type { CompressOptions, CompressResult, ImageFormat, ProgressFn } from './types'
import { uniquePath } from './video'

const MIN_QUALITY = 5
const MAX_QUALITY = 95
const SCALE_STEP = 0.85
const MIN_DIMENSION = 64
const QUALITY_FLOOR = 40 // below this, prefer downscaling over more compression
const FLOOR_MIN_SIDE = 800 // ...unless the image is already small

export async function compressImage(
  input: string,
  opts: CompressOptions,
  onProgress: ProgressFn,
  cancel: CancelToken
): Promise<CompressResult> {
  const targetBytes = opts.targetBytes
  if (!targetBytes) throw new Error('targetBytes is required in target mode')
  const inputBytes = (await stat(input)).size
  const notes: string[] = []
  const strip = opts.stripMetadata ?? true

  const src = sharp(input, { failOn: 'none', animated: false })
  const meta = await src.metadata()
  if (!meta.width || !meta.height) throw new Error('Could not read image dimensions')
  const format = opts.imageFormat ?? pickFormat(meta.format, meta.hasAlpha ?? false)
  const ext = format === 'jpeg' ? '.jpg' : `.${format}`
  const outDir = opts.outputDir ?? path.dirname(input)
  const outputPath = uniquePath(path.join(outDir, `${path.parse(input).name}-compressed${ext}`))

  // Decode once to raw pixels so every quality probe skips re-decoding the source.
  const decoded = await src.rotate().raw().toBuffer({ resolveWithObject: true })
  let width = decoded.info.width
  let height = decoded.info.height
  let pixels: Buffer = decoded.data

  const encode = (quality: number): Promise<Buffer> => {
    let s = sharp(pixels, { raw: { width, height, channels: decoded.info.channels } })
    if (!strip) s = s.withMetadata()
    switch (format) {
      case 'jpeg':
        return s.jpeg({ quality, mozjpeg: true, progressive: true }).toBuffer()
      case 'webp':
        return s.webp({ quality, effort: 4 }).toBuffer()
      case 'png':
        // PNG is lossless; "quality" here drives palette quantisation instead.
        return s.png({ palette: true, quality, compressionLevel: 9, effort: 7 }).toBuffer()
    }
  }

  let best: { buf: Buffer; quality: number } | null = null
  let scaleRounds = 0
  const maxRounds = 20
  for (let round = 0; round < maxRounds; round++) {
    cancel.throwIfCancelled()
    onProgress(round / maxRounds, `searching quality${scaleRounds ? ` @ ${width}x${height}` : ''}`)

    // Binary search for the highest quality that fits.
    let lo = MIN_QUALITY
    let hi = MAX_QUALITY
    let fit: { buf: Buffer; quality: number } | null = null
    while (lo <= hi) {
      cancel.throwIfCancelled()
      const mid = Math.floor((lo + hi) / 2)
      const buf = await encode(mid)
      if (buf.length <= targetBytes) {
        fit = { buf, quality: mid }
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    // Accept a fit at decent quality. A fit at very low quality is kept as a fallback,
    // but we'd rather shrink the image and re-search: fewer pixels at q40 beats q9.
    if (fit && (fit.quality >= QUALITY_FLOOR || Math.max(width, height) <= FLOOR_MIN_SIDE)) {
      best = fit
      break
    }
    if (fit) best = fit
    const nw = Math.round(width * SCALE_STEP)
    const nh = Math.round(height * SCALE_STEP)
    if (nw < MIN_DIMENSION || nh < MIN_DIMENSION) {
      if (!best) {
        best = { buf: await encode(MIN_QUALITY), quality: MIN_QUALITY }
        notes.push('could not get under target; best effort')
      }
      break
    }
    const resized = await sharp(pixels, { raw: { width, height, channels: decoded.info.channels } })
      .resize(nw, nh, { kernel: 'lanczos3' })
      .raw()
      .toBuffer({ resolveWithObject: true })
    pixels = resized.data
    width = resized.info.width
    height = resized.info.height
    scaleRounds++
  }
  if (!best) throw new Error('compression failed')
  if (scaleRounds) notes.push(`downscaled to ${width}x${height}`)
  if (format !== normaliseFormat(meta.format)) notes.push(`converted to ${format}`)
  notes.push(`quality ${best.quality}`)

  await writeFile(outputPath, best.buf)
  onProgress(1, 'done')
  return { outputPath, inputBytes, outputBytes: best.buf.length, notes }
}

function normaliseFormat(f?: string): ImageFormat | undefined {
  if (f === 'jpeg' || f === 'jpg') return 'jpeg'
  if (f === 'webp') return 'webp'
  if (f === 'png') return 'png'
  return undefined
}

/** Default output codec: keep WebP as WebP, keep transparency via WebP, else JPEG. */
function pickFormat(src?: string, hasAlpha = false): ImageFormat {
  if (src === 'webp') return 'webp'
  if (hasAlpha) return 'webp'
  return 'jpeg'
}
