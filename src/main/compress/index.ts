import path from 'node:path'
import { CancelToken } from './cancel'
import { compressImage } from './image'
import { IMAGE_EXTS, VIDEO_EXTS } from './types'
import type { CompressOptions, CompressResult, MediaKind, ProgressFn } from './types'
import { compressVideo } from './video'

export { CancelToken, CancelledError } from './cancel'
export * from './types'

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
  if (kind === 'video') return compressVideo(input, opts, onProgress, cancel)
  if (kind === 'image') return compressImage(input, opts, onProgress, cancel)
  return Promise.reject(new Error(`Unsupported file type: ${path.extname(input) || '(none)'}`))
}
