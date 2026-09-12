// electron-builder afterPack hook: ffprobe-static bundles ffprobe for darwin, linux and
// win32 (x64 + arm64/ia32). Keep only the binary for the platform/arch being packaged.
const fs = require('node:fs')
const path = require('node:path')

const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName // 'win32' | 'darwin' | 'linux'
  const arch = ARCH_NAMES[context.arch] ?? String(context.arch)
  const resources =
    platform === 'darwin'
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources'
        )
      : path.join(context.appOutDir, 'resources')
  const bin = path.join(resources, 'app.asar.unpacked', 'node_modules', 'ffprobe-static', 'bin')
  if (!fs.existsSync(bin)) return

  for (const os of fs.readdirSync(bin)) {
    const osDir = path.join(bin, os)
    if (!fs.statSync(osDir).isDirectory()) continue
    if (os !== platform) {
      fs.rmSync(osDir, { recursive: true, force: true })
      continue
    }
    for (const a of fs.readdirSync(osDir)) {
      const archDir = path.join(osDir, a)
      if (!fs.statSync(archDir).isDirectory()) continue
      // Universal mac builds need both; otherwise keep only the target arch.
      if (arch !== 'universal' && a !== arch) fs.rmSync(archDir, { recursive: true, force: true })
    }
  }
  console.log(`  • afterPack: trimmed ffprobe-static to ${platform}/${arch}`)
}
