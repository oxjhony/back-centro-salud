import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';

export type DomainErrorKind = 'unauthenticated' | 'forbidden' | 'not_found' | 'invalid' | 'conflict';

const HTTP_STATUS: Record<DomainErrorKind, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 422,
  conflict: 409,
};

/** Error de una regla de negocio. El dominio no conoce HTTP: el filtro lo traduce. */
export class DomainError extends Error {
  constructor(
    readonly kind: DomainErrorKind,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }

  static unauthenticated(code: string, message: string) {
    return new DomainError('unauthenticated', code, message);
  }
  static forbidden(code: string, message: string) {
    return new DomainError('forbidden', code, message);
  }
  static notFound(code: string, message: string) {
    return new DomainError('not_found', code, message);
  }
  static invalid(code: string, message: string) {
    return new DomainError('invalid', code, message);
  }
  static conflict(code: string, message: string) {
    return new DomainError('conflict', code, message);
  }
}

@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter {
  catch(error: DomainError, host: ArgumentsHost) {
    const status = HTTP_STATUS[error.kind];
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({ statusCode: status, code: error.code, message: error.message });
  }
}
