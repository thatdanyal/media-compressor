import { useState } from 'react'
import type { DragEvent } from 'react'

interface Props {
  onFiles: (paths: string[]) => void
}

export function DropZone({ onFiles }: Props): React.JSX.Element {
  const [over, setOver] = useState(false)

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setOver(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.api.pathForFile(f))
      .filter(Boolean)
    onFiles(paths)
  }

  return (
    <div
      className={`drop${over ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={async () => onFiles(await window.api.pickFiles())}
      role="button"
      tabIndex={0}
      onKeyDown={async (e) => {
        if (e.key === 'Enter' || e.key === ' ') onFiles(await window.api.pickFiles())
      }}
    >
      <div className="drop-icon" aria-hidden>
        ⬇
      </div>
      <div className="drop-text">
        <strong>Drop videos or pictures here</strong>
        <span>or click to browse · MP4, MOV, MKV, WebM, JPG, PNG, WebP, HEIC…</span>
      </div>
    </div>
  )
}
