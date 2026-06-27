/** Error thrown by faceless for invalid input or a failed agent run. */
export class FacelessError extends Error {
  readonly details?: Record<string, unknown>

  constructor(message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'FacelessError'
    this.details = details
  }
}
