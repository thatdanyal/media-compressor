export class CancelledError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'CancelledError'
  }
}

/** Minimal cancellation token: call cancel() to abort; children register kill handlers. */
export class CancelToken {
  private _cancelled = false
  private handlers: Array<() => void> = []

  get cancelled(): boolean {
    return this._cancelled
  }

  onCancel(fn: () => void): void {
    if (this._cancelled) fn()
    else this.handlers.push(fn)
  }

  cancel(): void {
    if (this._cancelled) return
    this._cancelled = true
    for (const h of this.handlers.splice(0)) {
      try {
        h()
      } catch {
        /* ignore */
      }
    }
  }

  throwIfCancelled(): void {
    if (this._cancelled) throw new CancelledError()
  }
}
