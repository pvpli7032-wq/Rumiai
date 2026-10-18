export class CircleError extends Error {
  constructor(message: string, public status = 400, public retryAfter?: number, public reason?: string | null) {super(message);}
}
