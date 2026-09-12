export type Unit = 'KB' | 'MB'

export function toBytes(value: number, unit: Unit): number {
  return Math.floor(value * (unit === 'MB' ? 1024 * 1024 : 1024))
}

export function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(2)} MB`
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${b} B`
}

export const PRESETS: Array<{ label: string; value: number; unit: Unit; hint?: string }> = [
  { label: '8 MB', value: 8, unit: 'MB', hint: 'Discord free' },
  { label: '10 MB', value: 10, unit: 'MB' },
  { label: '25 MB', value: 25, unit: 'MB', hint: 'Email' },
  { label: '50 MB', value: 50, unit: 'MB', hint: 'Discord Nitro Basic' },
  { label: '100 MB', value: 100, unit: 'MB' }
]

let counter = 0
export function nextId(): string {
  return `${Date.now().toString(36)}-${(counter++).toString(36)}`
}
