import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DomainError } from '../../../shared/errors';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/persistence';
import { AUDIT_LOG, AuditLog } from '../../operations/ports';
import { DEFAULT_ROLE, SessionUser } from '../domain/permissions';
import { IDENTITY_PROVIDER, IdentityProvider, USER_REPOSITORY, UserRepository } from './ports';

@Injectable()
export class AuthService {
  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly identityProvider: IdentityProvider,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<{ user: SessionUser; token: string }> {
    const identity = await this.identityProvider.authenticate(email.trim().toLowerCase(), password);
    if (!identity) {
      // Sin correo ni detalle: un intento fallido no debe dejar datos personales en la bitacora.
      await this.audit.record({ action: 'auth.login_failed' });
      throw DomainError.unauthenticated('credenciales_invalidas', 'Correo o contraseña incorrectos.');
    }

    const outcome = await this.unitOfWork.run(async (tx) => {
      const existing = await this.users.findBySubject(identity.subject, tx);
      if (existing && existing.status !== 'ACTIVE') {
        return { id: existing.id, active: false };
      }
      const id = existing?.id ?? (await this.users.createFromIdentity(identity, DEFAULT_ROLE, tx));
      await this.users.touchLastLogin(id, tx);
      await this.audit.record({ actorId: id, action: 'auth.login', objectType: 'users', objectId: id }, tx);
      return { id, active: true };
    });

    const user = outcome.active ? await this.users.findSessionUser(outcome.id) : null;
    if (!user) {
      await this.audit.record({ actorId: outcome.id, action: 'auth.login_denied', objectType: 'users', objectId: outcome.id });
      throw DomainError.forbidden('cuenta_inactiva', 'La cuenta está inactiva o suspendida.');
    }
    return { user, token: await this.jwt.signAsync({ sub: user.id }) };
  }

  /**
   * Los roles y permisos se leen en cada peticion, no se guardan en la cookie:
   * quitar un rol o suspender la cuenta surte efecto de inmediato y no cuando expire la sesion.
   */
  async resolveSession(token: string): Promise<SessionUser | null> {
    let subject: string;
    try {
      ({ sub: subject } = await this.jwt.verifyAsync<{ sub: string }>(token));
    } catch {
      return null;
    }
    return this.users.findSessionUser(subject);
  }
}
