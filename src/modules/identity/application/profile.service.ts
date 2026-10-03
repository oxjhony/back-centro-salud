import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/persistence';
import { AUDIT_LOG, AuditLog } from '../../operations/ports';
import { SessionUser } from '../domain/permissions';
import { Profile, ProfileData, USER_REPOSITORY, UserRepository } from './ports';

/** Perfil minimo (RF-02): la persona lo consulta, lo corrige y puede borrar sus datos opcionales. */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
  ) {}

  async get(actor: SessionUser): Promise<Profile> {
    const profile = await this.users.profile(actor.id);
    if (!profile) throw DomainError.notFound('usuario_no_encontrado', 'El usuario no existe.');
    return profile;
  }

  async update(actor: SessionUser, data: ProfileData): Promise<Profile> {
    const before = await this.get(actor);
    const interests = [...new Set(data.interests.map((i) => i.trim()).filter(Boolean))];
    await this.unitOfWork.run(async (tx) => {
      await this.users.updateProfile(actor.id, { ...data, interests }, tx);
      // Solo los nombres de los campos que cambiaron: los valores son datos personales.
      const changed = (Object.keys(data) as (keyof ProfileData)[]).filter(
        (field) => JSON.stringify(before[field]) !== JSON.stringify(field === 'interests' ? interests : data[field]),
      );
      await this.audit.record(
        { actorId: actor.id, action: 'profile.updated', objectType: 'users', objectId: actor.id, minimalDetail: { fields: changed } },
        tx,
      );
    });
    return this.get(actor);
  }

  /** Borra todo lo opcional; quedan solo el correo y el nombre, sin los cuales no hay cuenta. */
  clearOptionalData(actor: SessionUser): Promise<Profile> {
    return this.update(actor, {
      displayName: actor.displayName,
      affiliation: null,
      generalTerritory: null,
      interests: [],
      notificationOptIn: false,
    });
  }
}
