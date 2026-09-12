import { PRESETS } from '../lib'
import type { Unit } from '../lib'

interface Props {
  value: { value: number; unit: Unit }
  onChange: (v: { value: number; unit: Unit }) => void
}

export function TargetSizeInput({ value, onChange }: Props): React.JSX.Element {
  return (
    <div className="target">
      <label className="target-label" htmlFor="target-size">
        Target file size
      </label>
      <div className="row">
        <input
          id="target-size"
          type="number"
          min={1}
          step="any"
          value={Number.isFinite(value.value) ? value.value : ''}
          onChange={(e) => onChange({ ...value, value: parseFloat(e.target.value) })}
          className="target-num"
        />
        <select
          value={value.unit}
          onChange={(e) => onChange({ ...value, unit: e.target.value as Unit })}
          className="target-unit"
        >
          <option value="KB">KB</option>
          <option value="MB">MB</option>
        </select>
      </div>
      <div className="presets">
        {PRESETS.map((p) => {
          const active = p.value === value.value && p.unit === value.unit
          return (
            <button
              key={p.label}
              className={`chip${active ? ' active' : ''}`}
              title={p.hint}
              onClick={() => onChange({ value: p.value, unit: p.unit })}
            >
              {p.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
