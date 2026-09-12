import path from 'node:path'
import { CancelToken } from './cancel'
import { compressImage } from './image'
import { squeezeImage, squeezeVideo } from './squeeze'
import { IMAGE_EXTS, VIDEO_EXTS } from './types'
import type { CompressOptions, CompressResult, MediaKind, ProgressFn } from './types'
import { compressVideo } from './video'

export { CancelToken, CancelledError } from './cancel'
export * from './types'
export { DEFAULT_BUDGET_MS } from './squeeze'

export function detectKind(file: string): MediaKind | null {
  const ext = path.extname(file).toLowerCase()
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (IMAGE_EXTS.has(ext)) return 'image'
  return null
}

export function compressFile(
  input: string,
  opts: CompressOptions,
  onProgress: ProgressFn,
  cancel: CancelToken
): Promise<CompressResult> {
  const kind = detectKind(input)
  const squeeze = opts.mode === 'squeeze'
  if (kind === 'video')
    return (squeeze ? squeezeVideo : compressVideo)(input, opts, onProgress, cancel)
  if (kind === 'image')
    return (squeeze ? squeezeImage : compressImage)(input, opts, onProgress, cancel)
  return Promise.reject(new Error(`Unsupported file type: ${path.extname(input) || '(none)'}`))
}
