import { existsSync } from 'node:fs'

// ffmpeg-static / ffprobe-static ship native binaries. When packaged, they live in
// app.asar.unpacked (see asarUnpack in electron-builder.yml), so rewrite the path.
function unpacked(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked')
}

export function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require('ffmpeg-static') as string
  const resolved = unpacked(p)
  if (!existsSync(resolved)) throw new Error(`ffmpeg binary not found at ${resolved}`)
  return resolved
}

export function ffprobePath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = (require('ffprobe-static') as { path: string }).path
  const resolved = unpacked(p)
  if (!existsSync(resolved)) throw new Error(`ffprobe binary not found at ${resolved}`)
  return resolved
}
