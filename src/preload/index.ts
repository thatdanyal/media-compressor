import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'

export type Mode = 'target' | 'squeeze'

export interface CompressOptions {
  mode?: Mode
  targetBytes?: number
  timeBudgetMs?: number
  outputDir?: string
  imageFormat?: 'jpeg' | 'webp' | 'png'
  stripMetadata?: boolean
  videoCodec?: 'h264' | 'h265'
}

export interface FileInfo {
  path: string
  name: string
  bytes: number
  kind: 'video' | 'image' | null
}

export interface ProgressEvent {
  id: string
  fraction: number
  stage?: string
}

export interface DoneEvent {
  id: string
  ok: boolean
  cancelled?: boolean
  error?: string
  result?: { outputPath: string; inputBytes: number; outputBytes: number; notes: string[] }
}

export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

type Unsubscribe = () => void

function on<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  // Renderer drag-drop gives File objects; this resolves the real filesystem path.
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  fileInfo: (paths: string[]): Promise<FileInfo[]> => ipcRenderer.invoke('files:info', paths),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickFiles'),
  pickDir: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickDir'),
  showInFolder: (p: string): Promise<void> => ipcRenderer.invoke('shell:showInFolder', p),

  compress: (id: string, file: string, options: CompressOptions): Promise<void> =>
    ipcRenderer.invoke('compress:start', { id, file, options }),
  cancel: (id: string): Promise<void> => ipcRenderer.invoke('compress:cancel', id),
  onProgress: (cb: (e: ProgressEvent) => void): Unsubscribe => on('compress:progress', cb),
  onDone: (cb: (e: DoneEvent) => void): Unsubscribe => on('compress:done', cb),

  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('update:check'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onUpdateEvent: (cb: (e: UpdateEvent) => void): Unsubscribe => on('update:event', cb)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
