export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, 404)
  }
}

export class ForbiddenError extends AppError {
  constructor() {
    super('FORBIDDEN', 'Insufficient permissions', 403)
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super('AUTH_REQUIRED', 'Authentication required', 401)
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 422)
  }
}

export class GoneError extends AppError {
  constructor(message: string) {
    super('GONE', message, 410)
  }
}
