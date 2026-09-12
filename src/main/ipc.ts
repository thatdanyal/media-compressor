import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { CancelledError, CancelToken, compressFile, detectKind } from './compress'
import type { CompressOptions } from './compress'

export interface JobRequest {
  id: string
  file: string
  options: CompressOptions
}

export interface FileInfo {
  path: string
  name: string
  bytes: number
  kind: 'video' | 'image' | null
}

const running = new Map<string, CancelToken>()

export function registerIpc(): void {
  ipcMain.handle('files:info', async (_e, paths: string[]): Promise<FileInfo[]> => {
    const out: FileInfo[] = []
    for (const p of paths) {
      try {
        const s = await stat(p)
        if (!s.isFile()) continue
        out.push({ path: p, name: path.basename(p), bytes: s.size, kind: detectKind(p) })
      } catch {
        /* skip unreadable */
      }
    }
    return out
  })

  ipcMain.handle('dialog:pickFiles', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Media',
          extensions: [
            'mp4',
            'mov',
            'mkv',
            'avi',
            'webm',
            'm4v',
            'wmv',
            'flv',
            'jpg',
            'jpeg',
            'png',
            'webp',
            'gif',
            'bmp',
            'tif',
            'tiff',
            'heic',
            'avif'
          ]
        },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return r.canceled ? [] : r.filePaths
  })

  ipcMain.handle('dialog:pickDir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('shell:showInFolder', (_e, p: string) => shell.showItemInFolder(p))

  ipcMain.handle('compress:start', async (e, job: JobRequest) => {
    const cancel = new CancelToken()
    running.set(job.id, cancel)
    const sender = e.sender
    const send = (channel: string, payload: unknown): void => {
      if (!sender.isDestroyed()) sender.send(channel, payload)
    }
    try {
      const result = await compressFile(
        job.file,
        job.options,
        (fraction, stage) => send('compress:progress', { id: job.id, fraction, stage }),
        cancel
      )
      send('compress:done', { id: job.id, ok: true, result })
    } catch (err) {
      const cancelled = err instanceof CancelledError
      send('compress:done', {
        id: job.id,
        ok: false,
        cancelled,
        error: cancelled ? 'Cancelled' : (err as Error).message
      })
    } finally {
      running.delete(job.id)
    }
  })

  ipcMain.handle('compress:cancel', (_e, id: string) => {
    running.get(id)?.cancel()
  })
}

/** Called on app quit so no orphaned ffmpeg processes are left behind. */
export function cancelAllJobs(): void {
  for (const c of running.values()) c.cancel()
  running.clear()
}
