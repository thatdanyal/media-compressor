import type { Mode } from '../../../preload/index'

interface Props {
  value: Mode
  onChange: (m: Mode) => void
}

const MODES: Array<{ id: Mode; title: string; blurb: string }> = [
  { id: 'target', title: 'Target size', blurb: 'Hit an exact file size. Fast.' },
  { id: 'squeeze', title: 'Max Squeeze', blurb: 'As small as possible. Up to 10 min per video.' }
]

export function ModePicker({ value, onChange }: Props): React.JSX.Element {
  return (
    <div className="modes" role="radiogroup" aria-label="Mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="radio"
          aria-checked={value === m.id}
          className={`mode${value === m.id ? ' active' : ''}`}
          onClick={() => onChange(m.id)}
        >
          <span className="mode-title">{m.title}</span>
          <span className="mode-blurb">{m.blurb}</span>
        </button>
      ))}
    </div>
  )
}
