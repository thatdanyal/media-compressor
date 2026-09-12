import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ffmpegPath, ffprobePath } from './binaries'
import { CancelledError, CancelToken } from './cancel'
import type { CompressOptions, CompressResult, ProgressFn, VideoCodec } from './types'

export interface ProbeInfo {
  durationSec: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
  audioKbps: number | null
}

// Rough "don't go below this" bitrate per output height for H.264. Below these the
// picture turns to mush, so we downscale instead.
const LADDER: Array<{ height: number; minKbps: number }> = [
  { height: 1080, minKbps: 1800 },
  { height: 720, minKbps: 900 },
  { height: 480, minKbps: 450 },
  { height: 360, minKbps: 250 },
  { height: 240, minKbps: 120 }
]

const CONTAINER_OVERHEAD = 0.97 // leave ~3% for mp4 container / muxing overhead
const MAX_RETRIES = 2

export async function probe(file: string): Promise<ProbeInfo> {
  const json = await run(ffprobePath(), [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    file
  ])
  const data = JSON.parse(json)
  const streams = data.streams as Array<Record<string, string>>
  const v = streams.find((s) => s.codec_type === 'video')
  const a = streams.find((s) => s.codec_type === 'audio')
  if (!v) throw new Error('No video stream found')
  const durationSec = parseFloat(data.format?.duration ?? v.duration ?? '0')
  if (!durationSec || !isFinite(durationSec)) throw new Error('Could not read video duration')
  return {
    durationSec,
    width: Number(v.width),
    height: Number(v.height),
    fps: parseFps(v.avg_frame_rate || v.r_frame_rate),
    hasAudio: !!a,
    audioKbps: a?.bit_rate ? Math.round(Number(a.bit_rate) / 1000) : null
  }
}

function parseFps(s?: string): number {
  if (!s) return 30
  const [n, d] = s.split('/').map(Number)
  if (!d) return n || 30
  const f = n / d
  return isFinite(f) && f > 0 ? f : 30
}

export interface VideoPlan {
  videoKbps: number
  audioKbps: number
  outHeight: number | null
  notes: string[]
}

export function planVideo(info: ProbeInfo, targetBytes: number): VideoPlan {
  const notes: string[] = []
  const totalKbps = (targetBytes * 8) / 1000 / info.durationSec
  // Audio: cap at 128k, scale down for tight budgets, never below 48k when present.
  let audioKbps = 0
  if (info.hasAudio) {
    audioKbps = Math.min(128, info.audioKbps ?? 128)
    if (totalKbps < 600) audioKbps = Math.min(audioKbps, 96)
    if (totalKbps < 300) audioKbps = Math.min(audioKbps, 64)
    if (totalKbps < 150) audioKbps = Math.min(audioKbps, 48)
  }
  let videoKbps = Math.floor(totalKbps * CONTAINER_OVERHEAD - audioKbps)
  if (videoKbps < 50) {
    videoKbps = 50
    notes.push('target size is very small for this duration; quality will be poor')
  }

  // Pick the largest ladder height <= source that our budget can afford.
  let outHeight: number | null = null
  const candidates = LADDER.filter((l) => l.height <= info.height)
  const affordable = candidates.find((l) => videoKbps >= l.minKbps)
  if (affordable) {
    if (affordable.height < info.height) outHeight = affordable.height
  } else if (candidates.length) {
    const smallest = candidates[candidates.length - 1].height
    if (smallest < info.height) outHeight = smallest
  }
  if (outHeight) notes.push(`downscaled to ${outHeight}p`)
  return { videoKbps, audioKbps, outHeight, notes }
}

export async function compressVideo(
  input: string,
  opts: CompressOptions,
  onProgress: ProgressFn,
  cancel: CancelToken
): Promise<CompressResult> {
  const info = await probe(input)
  cancel.throwIfCancelled()
  const inputBytes = (await stat(input)).size
  const plan = planVideo(info, opts.targetBytes)
  const notes = [...plan.notes]

  const outDir = opts.outputDir ?? path.dirname(input)
  const base = path.parse(input).name
  const outputPath = uniquePath(path.join(outDir, `${base}-compressed.mp4`))
  const codec = opts.videoCodec ?? 'h264'
  const workDir = await mkdtemp(path.join(tmpdir(), 'mc-'))
  const passlog = path.join(workDir, 'ffpass')

  try {
    let videoKbps = plan.videoKbps
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      cancel.throwIfCancelled()
      const label = attempt ? ` (retry ${attempt})` : ''
      const common = [
        '-y',
        '-hide_banner',
        '-nostats',
        '-progress',
        'pipe:1',
        '-i',
        input,
        ...(plan.outHeight ? ['-vf', `scale=-2:${plan.outHeight}`] : []),
        ...codecArgs(codec, videoKbps)
      ]
      // Pass 1: analysis only, no audio, discard output
      await runFfmpeg(
        [...common, ...passArgs(codec, 1, passlog), '-an', '-f', 'null', '-'],
        info.durationSec,
        (f) => onProgress(f * 0.5, `pass 1${label}`),
        cancel
      )
      // Pass 2: the real encode
      const audio = info.hasAudio
        ? ['-c:a', 'aac', '-b:a', `${plan.audioKbps}k`, '-ac', '2']
        : ['-an']
      await runFfmpeg(
        [
          ...common,
          ...passArgs(codec, 2, passlog),
          ...audio,
          '-movflags',
          '+faststart',
          '-pix_fmt',
          'yuv420p',
          outputPath
        ],
        info.durationSec,
        (f) => onProgress(0.5 + f * 0.5, `pass 2${label}`),
        cancel
      )
      const outputBytes = (await stat(outputPath)).size
      if (outputBytes <= opts.targetBytes || attempt === MAX_RETRIES) {
        if (outputBytes > opts.targetBytes) notes.push('could not get under target; best effort')
        onProgress(1, 'done')
        return { outputPath, inputBytes, outputBytes, notes }
      }
      // Overshot: shave the bitrate proportionally and go again.
      const ratio = opts.targetBytes / outputBytes
      videoKbps = Math.max(50, Math.floor(videoKbps * ratio * 0.97))
      notes.push(
        `overshot by ${((1 / ratio - 1) * 100).toFixed(1)}%, retrying at ${videoKbps} kbps`
      )
    }
    throw new Error('unreachable')
  } catch (err) {
    await rm(outputPath, { force: true }).catch(() => {})
    throw err
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

function codecArgs(codec: VideoCodec, kbps: number): string[] {
  const rate = [
    '-b:v',
    `${kbps}k`,
    '-maxrate',
    `${Math.floor(kbps * 1.5)}k`,
    '-bufsize',
    `${kbps * 3}k`
  ]
  if (codec === 'h265') return ['-c:v', 'libx265', '-preset', 'medium', '-tag:v', 'hvc1', ...rate]
  return ['-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', ...rate]
}

function passArgs(codec: VideoCodec, pass: 1 | 2, passlog: string): string[] {
  if (codec === 'h265') {
    const stats = passlog.replace(/\\/g, '/')
    return ['-x265-params', `pass=${pass}:stats=${stats}:log-level=error`]
  }
  return ['-pass', String(pass), '-passlogfile', passlog]
}

/** foo-compressed.mp4 -> foo-compressed (2).mp4 if the first already exists. */
export function uniquePath(p: string): string {
  const { dir, name, ext } = path.parse(p)
  let candidate = p
  let i = 2
  while (existsSync(candidate)) candidate = path.join(dir, `${name} (${i++})${ext}`)
  return candidate
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err || `exit ${code}`))))
  })
}

function runFfmpeg(
  args: string[],
  durationSec: number,
  onProgress: (fraction: number) => void,
  cancel: CancelToken
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), args, { windowsHide: true })
    cancel.onCancel(() => p.kill('SIGKILL'))
    let stderr = ''
    let buf = ''
    p.stdout.on('data', (d) => {
      buf += d.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        // ffmpeg emits out_time_us (newer) and out_time_ms (older, also microseconds)
        const m = /^out_time_us=(\d+)/.exec(line) ?? /^out_time_ms=(\d+)/.exec(line)
        if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / durationSec))
      }
    })
    p.stderr.on('data', (d) => {
      stderr += d.toString()
      if (stderr.length > 20000) stderr = stderr.slice(-10000)
    })
    p.on('error', reject)
    p.on('close', (code) => {
      if (cancel.cancelled) return reject(new CancelledError())
      if (code === 0) return resolve()
      const tail = stderr.trim().split('\n').slice(-6).join('\n')
      reject(new Error(`ffmpeg failed (exit ${code}):\n${tail}`))
    })
  })
}
