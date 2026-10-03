import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '../../../shared/errors';
import { AuthService } from '../application/auth.service';
import { SessionUser } from '../domain/permissions';

export const SESSION_COOKIE = 'cvsp_session';

const IS_PUBLIC = 'access:public';
const REQUIRED_PERMISSIONS = 'access:permissions';

/** Ruta accesible sin sesion. Todo lo que no lleve esta marca exige autenticacion. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Permisos que el usuario debe tener (todos) para ejecutar la operacion. */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): SessionUser | null =>
    context.switchToHttp().getRequest().user ?? null,
);

/**
 * Control de acceso de toda la API, registrado como guarda global. Niega por defecto:
 * una ruta nueva queda protegida aunque se olvide declararle permisos (RF-01).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const request = context.switchToHttp().getRequest();

    const token: string | undefined = request.cookies?.[SESSION_COOKIE];
    const user = token ? await this.auth.resolveSession(token) : null;
    request.user = user;

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }
    if (!user) {
      throw DomainError.unauthenticated('sesion_requerida', 'Debes iniciar sesión.');
    }

    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    if (!required.every((permission) => user.permissions.includes(permission))) {
      throw DomainError.forbidden('permiso_insuficiente', 'No tienes permiso para esta operación.');
    }
    return true;
  }
}
