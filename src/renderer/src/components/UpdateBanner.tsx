import { useEffect, useState } from 'react'
import type { UpdateEvent } from '../../../preload/index'

export function UpdateBanner(): React.JSX.Element | null {
  const [ev, setEv] = useState<UpdateEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    return window.api.onUpdateEvent((e) => {
      setEv(e)
      setDismissed(false)
      // Transient states clear themselves after a moment.
      if (e.type === 'not-available' || e.type === 'error') {
        setTimeout(() => setEv((cur) => (cur === e ? null : cur)), 6000)
      }
    })
  }, [])

  if (!ev || dismissed) return null
  if (ev.type === 'checking') return <div className="banner">Checking for updates…</div>
  if (ev.type === 'not-available')
    return <div className="banner">You&apos;re on the latest version.</div>
  if (ev.type === 'available') return <div className="banner">Downloading v{ev.version}…</div>
  if (ev.type === 'progress')
    return <div className="banner">Downloading update… {Math.round(ev.percent)}%</div>
  if (ev.type === 'error')
    return (
      <div className="banner banner-err">
        Update check failed: {ev.message}
        <button className="link" onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      </div>
    )
  return (
    <div className="banner banner-ready">
      <span>Version {ev.version} is ready to install.</span>
      <button onClick={() => window.api.installUpdate()}>Restart to update</button>
      <button className="link" onClick={() => setDismissed(true)}>
        Later
      </button>
    </div>
  )
}
