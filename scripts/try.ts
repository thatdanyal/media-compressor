// Dev harness: npm run try -- <file> <size like 8MB|500KB | squeeze[:minutes]> [outputDir]
// Exercises the compression engine without Electron.
import { CancelToken, compressFile } from '../src/main/compress'

function parseSize(s: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(kb|mb|gb|b)?$/i.exec(s.trim())
  if (!m) throw new Error(`bad size: ${s}`)
  const n = parseFloat(m[1])
  const unit = (m[2] ?? 'b').toLowerCase()
  const mult = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[unit]!
  return Math.floor(n * mult)
}

async function main(): Promise<void> {
  const [file, size, outputDir] = process.argv.slice(2)
  if (!file || !size) {
    console.error('usage: npm run try -- <file> <8MB|500KB> [outputDir]')
    process.exit(2)
  }
  const squeeze = /^squeeze(:[\d.]+)?$/i.exec(size)
  const targetBytes = squeeze ? 0 : parseSize(size)
  const timeBudgetMs = squeeze?.[1] ? Number(squeeze[1].slice(1)) * 60_000 : undefined
  const cancel = new CancelToken()
  process.on('SIGINT', () => cancel.cancel())
  let lastStage = ''
  const t0 = Date.now()
  const res = await compressFile(
    file,
    squeeze ? { mode: 'squeeze', timeBudgetMs, outputDir } : { targetBytes, outputDir },
    (f, stage) => {
      const line = `${(f * 100).toFixed(0).padStart(3)}% ${stage ?? ''}`
      if (stage !== lastStage || f >= 1) {
        process.stdout.write(`\r${line.padEnd(40)}`)
        lastStage = stage ?? ''
      }
    },
    cancel
  )
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n${res.outputPath}`)
  const verdict = squeeze
    ? `(-${Math.round((1 - res.outputBytes / res.inputBytes) * 100)}%)`
    : `(target ${fmt(targetBytes)}) ${res.outputBytes <= targetBytes ? 'OK' : 'OVER'}`
  console.log(`${fmt(res.inputBytes)} -> ${fmt(res.outputBytes)} ${verdict} in ${secs}s`)
  if (res.notes.length) console.log('notes:', res.notes.join('; '))
}

function fmt(b: number): string {
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(2)} MB`
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${b} B`
}

main().catch((e) => {
  console.error('\nERROR:', e.message)
  process.exit(1)
})
