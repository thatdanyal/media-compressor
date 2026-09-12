import type { Job } from '../App'
import { fmtBytes } from '../lib'

interface Props {
  job: Job
  targetBytes: number | null
  onCancel: () => void
  onRemove: () => void
  onRetry: () => void
  onReveal: () => void
}

export function FileRow({
  job,
  targetBytes,
  onCancel,
  onRemove,
  onRetry,
  onReveal
}: Props): React.JSX.Element {
  const { file, status } = job
  const pct = Math.round(job.fraction * 100)
  const alreadySmall = status === 'queued' && targetBytes !== null && file.bytes <= targetBytes

  return (
    <div className={`file status-${status}`}>
      <div className="file-main">
        <div className="file-name" title={file.path}>
          <span className={`kind kind-${file.kind ?? 'none'}`}>
            {file.kind === 'video' ? 'VID' : file.kind === 'image' ? 'IMG' : '?'}
          </span>
          {file.name}
        </div>
        <div className="file-meta">
          {status === 'done' && job.outputBytes !== undefined ? (
            <>
              {fmtBytes(file.bytes)} → <strong>{fmtBytes(job.outputBytes)}</strong>
              <span className="saved">
                {' '}
                (−{Math.round((1 - job.outputBytes / file.bytes) * 100)}%)
              </span>
              {targetBytes !== null && job.outputBytes > targetBytes && (
                <span className="warn"> over target</span>
              )}
              {job.notes && job.notes.length > 0 && (
                <span className="notes"> · {job.notes.join(' · ')}</span>
              )}
            </>
          ) : status === 'error' ? (
            <span className="err">{job.error}</span>
          ) : status === 'cancelled' ? (
            <span>Cancelled</span>
          ) : status === 'running' ? (
            <span>
              {pct}% {job.stage ? `· ${job.stage}` : ''}
            </span>
          ) : (
            <span>
              {fmtBytes(file.bytes)}
              {alreadySmall && ' · already under target, will re-encode anyway'}
            </span>
          )}
        </div>
        {status === 'running' && (
          <div className="bar">
            <div className="bar-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="file-actions">
        {(status === 'running' || status === 'queued') && (
          <button onClick={onCancel}>Cancel</button>
        )}
        {status === 'done' && <button onClick={onReveal}>Show in folder</button>}
        {(status === 'error' || status === 'cancelled') && file.kind && (
          <button onClick={onRetry}>Retry</button>
        )}
        {status !== 'running' && (
          <button className="icon" onClick={onRemove} title="Remove from list" aria-label="Remove">
            ×
          </button>
        )}
      </div>
    </div>
  )
}
