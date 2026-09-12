export type MediaKind = 'video' | 'image'

export type ImageFormat = 'jpeg' | 'webp' | 'png'
export type VideoCodec = 'h264' | 'h265'

export interface CompressOptions {
  /** Desired maximum output size in bytes. */
  targetBytes: number
  /** Directory to write into. Defaults to the source file's directory. */
  outputDir?: string
  /** Images only. */
  imageFormat?: ImageFormat
  /** Images only. Drop EXIF/ICC metadata. */
  stripMetadata?: boolean
  /** Videos only. */
  videoCodec?: VideoCodec
}

export interface CompressResult {
  outputPath: string
  inputBytes: number
  outputBytes: number
  /** Human-readable notes, e.g. "downscaled to 720p". */
  notes: string[]
}

export type ProgressFn = (fraction: number, stage?: string) => void

export const VIDEO_EXTS = new Set([
  '.mp4',
  '.mov',
  '.mkv',
  '.avi',
  '.webm',
  '.m4v',
  '.wmv',
  '.flv',
  '.ts',
  '.mts'
])
export const IMAGE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
  '.heic',
  '.avif'
])
