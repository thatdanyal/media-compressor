import { useCallback, useEffect, useRef, useState } from 'react'
import type { CompressOptions, DoneEvent, FileInfo } from '../../preload/index'
import { DropZone } from './components/DropZone'
import { FileRow } from './components/FileRow'
import { TargetSizeInput } from './components/TargetSizeInput'
import { UpdateBanner } from './components/UpdateBanner'
import { fmtBytes, nextId, toBytes } from './lib'
import type { Unit } from './lib'

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface Job {
  id: string
  file: FileInfo
  status: JobStatus
  fraction: number
  stage?: string
  outputPath?: string
  outputBytes?: number
  notes?: string[]
  error?: string
}

type ImageFormatChoice = 'auto' | 'jpeg' | 'webp' | 'png'

export default function App(): React.JSX.Element {
  const [jobs, setJobs] = useState<Job[]>([])
  const [target, setTarget] = useState<{ value: number; unit: Unit }>({ value: 8, unit: 'MB' })
  const [outputDir, setOutputDir] = useState<string | null>(null)
  const [imageFormat, setImageFormat] = useState<ImageFormatChoice>('auto')
  const [stripMetadata, setStripMetadata] = useState(true)
  const [videoCodec, setVideoCodec] = useState<'h264' | 'h265'>('h264')
  const [version, setVersion] = useState('')
  const [showOptions, setShowOptions] = useState(false)
  const runningRef = useRef(false)

  useEffect(() => {
    window.api.getVersion().then(setVersion)
  }, [])

  // Wire progress/done events once; they're keyed by job id.
  useEffect(() => {
    const offP = window.api.onProgress((e) =>
      setJobs((js) =>
        js.map((j) => (j.id === e.id ? { ...j, fraction: e.fraction, stage: e.stage } : j))
      )
    )
    const offD = window.api.onDone((e: DoneEvent) => {
      setJobs((js) =>
        js.map((j) => {
          if (j.id !== e.id) return j
          if (e.ok && e.result) {
            return {
              ...j,
              status: 'done',
              fraction: 1,
              stage: undefined,
              outputPath: e.result.outputPath,
              outputBytes: e.result.outputBytes,
              notes: e.result.notes
            }
          }
          return {
            ...j,
            status: e.cancelled ? 'cancelled' : 'error',
            error: e.error,
            stage: undefined
          }
        })
      )
      runningRef.current = false
    })
    return () => {
      offP()
      offD()
    }
  }, [])

  const addPaths = useCallback(async (paths: string[]) => {
    if (!paths.length) return
    const infos = await window.api.fileInfo(paths)
    setJobs((js) => {
      const existing = new Set(js.map((j) => j.file.path))
      const fresh = infos
        .filter((f) => !existing.has(f.path))
        .map<Job>((file) => ({
          id: nextId(),
          file,
          status: file.kind ? 'queued' : 'error',
          fraction: 0,
          error: file.kind ? undefined : 'Unsupported file type'
        }))
      return [...js, ...fresh]
    })
  }, [])

  // Queue pump: run jobs one at a time (ffmpeg already saturates the CPU). Marking the
  // job "running" here is the one place state and the side effect must move together.
  useEffect(() => {
    if (runningRef.current) return
    const next = jobs.find((j) => j.status === 'queued')
    if (!next) return
    runningRef.current = true
    const options: CompressOptions = {
      targetBytes: toBytes(target.value, target.unit),
      outputDir: outputDir ?? undefined,
      imageFormat: imageFormat === 'auto' ? undefined : imageFormat,
      stripMetadata,
      videoCodec
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJobs((js) => js.map((j) => (j.id === next.id ? { ...j, status: 'running' } : j)))
    window.api.compress(next.id, next.file.path, options)
  }, [jobs, target, outputDir, imageFormat, stripMetadata, videoCodec])

  const targetBytes = toBytes(target.value, target.unit)
  const queued = jobs.filter((j) => j.status === 'queued').length
  const busy = jobs.some((j) => j.status === 'running')

  const cancelJob = (id: string): void => {
    const j = jobs.find((x) => x.id === id)
    if (!j) return
    if (j.status === 'running') window.api.cancel(id)
    else if (j.status === 'queued')
      setJobs((js) => js.map((x) => (x.id === id ? { ...x, status: 'cancelled' } : x)))
  }
  const removeJob = (id: string): void => setJobs((js) => js.filter((j) => j.id !== id))
  const retryJob = (id: string): void =>
    setJobs((js) =>
      js.map((j) =>
        j.id === id
          ? { ...j, status: 'queued', fraction: 0, error: undefined, outputPath: undefined }
          : j
      )
    )
  const clearFinished = (): void =>
    setJobs((js) => js.filter((j) => j.status === 'queued' || j.status === 'running'))

  return (
    <div className="app">
      <UpdateBanner />
      <header className="header">
        <h1>Media Compressor</h1>
        <p className="sub">Shrink videos and pictures to the exact file size you need.</p>
      </header>

      <section className="panel">
        <TargetSizeInput value={target} onChange={setTarget} />
        <button className="link" onClick={() => setShowOptions((s) => !s)}>
          {showOptions ? 'Hide options' : 'More options'}
        </button>
        {showOptions && (
          <div className="options">
            <label>
              Output folder
              <div className="row">
                <input readOnly value={outputDir ?? 'Same folder as each file'} />
                <button
                  onClick={async () => setOutputDir((await window.api.pickDir()) ?? outputDir)}
                >
                  Choose…
                </button>
                {outputDir && <button onClick={() => setOutputDir(null)}>Reset</button>}
              </div>
            </label>
            <label>
              Image format
              <select
                value={imageFormat}
                onChange={(e) => setImageFormat(e.target.value as ImageFormatChoice)}
              >
                <option value="auto">Auto (JPEG, WebP if transparent)</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
                <option value="png">PNG (lossless colours, limited shrink)</option>
              </select>
            </label>
            <label>
              Video codec
              <select
                value={videoCodec}
                onChange={(e) => setVideoCodec(e.target.value as 'h264' | 'h265')}
              >
                <option value="h264">H.264 (plays everywhere)</option>
                <option value="h265">H.265 (smaller, slower, less compatible)</option>
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={stripMetadata}
                onChange={(e) => setStripMetadata(e.target.checked)}
              />
              Strip image metadata (EXIF, location, camera info)
            </label>
          </div>
        )}
      </section>

      <DropZone onFiles={addPaths} />

      {jobs.length > 0 && (
        <section className="jobs">
          <div className="jobs-head">
            <span>
              {jobs.length} file{jobs.length === 1 ? '' : 's'} · target {fmtBytes(targetBytes)}
              {busy && ' · working…'}
              {!busy && queued > 0 && ` · ${queued} queued`}
            </span>
            <button className="link" onClick={clearFinished}>
              Clear finished
            </button>
          </div>
          {jobs.map((j) => (
            <FileRow
              key={j.id}
              job={j}
              targetBytes={targetBytes}
              onCancel={() => cancelJob(j.id)}
              onRemove={() => removeJob(j.id)}
              onRetry={() => retryJob(j.id)}
              onReveal={() => j.outputPath && window.api.showInFolder(j.outputPath)}
            />
          ))}
        </section>
      )}

      <footer className="footer">
        <span>v{version}</span>
        <button className="link" onClick={() => window.api.checkForUpdates()}>
          Check for updates
        </button>
      </footer>
    </div>
  )
}
