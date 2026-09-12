import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'

export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

function broadcast(ev: UpdateEvent): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('update:event', ev)
  }
}

export function setupUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => broadcast({ type: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    broadcast({ type: 'available', version: info.version })
  )
  autoUpdater.on('update-not-available', () => broadcast({ type: 'not-available' }))
  autoUpdater.on('download-progress', (p) => broadcast({ type: 'progress', percent: p.percent }))
  autoUpdater.on('update-downloaded', (info) =>
    broadcast({ type: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (err) => broadcast({ type: 'error', message: err.message }))

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      broadcast({
        type: 'error',
        message: 'Updates only work in the installed app, not in dev mode.'
      })
      return
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      broadcast({ type: 'error', message: (err as Error).message })
    }
  })
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall())
  ipcMain.handle('app:version', () => app.getVersion())

  // Only check in packaged builds; a dev build has no update feed to compare against.
  if (app.isPackaged) {
    const check = (): void => {
      autoUpdater.checkForUpdates().catch(() => {})
    }
    setTimeout(check, 5000)
    setInterval(check, CHECK_INTERVAL_MS)
  }
}
