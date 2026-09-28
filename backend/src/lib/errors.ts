export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = "INTERNAL_ERROR",
  ) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", code = "BAD_REQUEST") {
    super(message, 400, code);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", code = "UNAUTHORIZED") {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", code = "FORBIDDEN") {
    super(message, 403, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found", code = "NOT_FOUND") {
    super(message, 404, code);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", code = "CONFLICT") {
    super(message, 409, code);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message = "Unprocessable entity", code = "UNPROCESSABLE_ENTITY") {
    super(message, 422, code);
  }
}

export class UpstreamServiceError extends AppError {
  constructor(service: string, message = "Upstream service error") {
    super(message, 502, `UPSTREAM_${service.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`);
  }
}
