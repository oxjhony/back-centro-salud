import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/persistence';
import { AUDIT_LOG, AuditLog } from '../../operations/ports';
import { SessionUser, UserStatus } from '../domain/permissions';
import { RoleSummary, USER_REPOSITORY, UserRepository, UserSummary } from './ports';

@Injectable()
export class UsersAdminService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
  ) {}

  list(): Promise<UserSummary[]> {
    return this.users.list();
  }

  roles(): Promise<RoleSummary[]> {
    return this.users.roles();
  }

  async assignRoles(actor: SessionUser, userId: string, roles: string[]): Promise<void> {
    if (actor.id === userId) {
      throw DomainError.forbidden('autoasignacion', 'Nadie puede cambiar sus propios roles.');
    }

    const requested = [...new Set(roles)].sort();
    const assignable = (await this.users.roles()).filter((r) => r.assignable).map((r) => r.name);
    const unknown = requested.filter((r) => !assignable.includes(r));
    if (unknown.length > 0) {
      throw DomainError.invalid('rol_invalido', `Roles no asignables: ${unknown.join(', ')}.`);
    }

    await this.unitOfWork.run(async (tx) => {
      const previous = await this.users.rolesOf(userId, tx);
      if (previous === null) {
        throw DomainError.notFound('usuario_no_encontrado', 'El usuario no existe.');
      }
      await this.users.replaceRoles(userId, requested, actor.id, tx);
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'user.roles_assigned',
          objectType: 'users',
          objectId: userId,
          minimalDetail: { before: previous, after: requested },
        },
        tx,
      );
    });
  }

  /** Suspender o desactivar corta la sesion abierta en la siguiente peticion. */
  async setStatus(actor: SessionUser, userId: string, status: UserStatus): Promise<void> {
    if (actor.id === userId) {
      throw DomainError.forbidden('autoasignacion', 'Nadie puede cambiar el estado de su propia cuenta.');
    }
    await this.unitOfWork.run(async (tx) => {
      const previous = await this.users.statusOf(userId, tx);
      if (previous === null) {
        throw DomainError.notFound('usuario_no_encontrado', 'El usuario no existe.');
      }
      if (previous === status) return;
      await this.users.setStatus(userId, status, tx);
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'user.status_changed',
          objectType: 'users',
          objectId: userId,
          minimalDetail: { before: previous, after: status },
        },
        tx,
      );
    });
  }
}
