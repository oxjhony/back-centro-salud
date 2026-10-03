import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/persistence';
import { hasPermission, Permission, SessionUser } from '../../identity/domain/permissions';
import { NOTIFICATION_STORE, NotificationStore } from '../../notifications/notifications';
import { AUDIT_LOG, AuditLog } from '../../operations/ports';
import {
  availableTransitions,
  decideTransition,
  PUBLISHABLE_ENTITIES,
  PublishableEntity,
  QUEUE_STATES,
} from '../domain/state-machine';
import { EDITORIAL_STORE, EditorialInfo, EditorialStore, PublishableContent, QueueItem, ReviewEntry } from './ports';

const ENTITY: Record<PublishableEntity, { name: string; ending: 'a' | 'o' }> = {
  initiatives: { name: 'La iniciativa', ending: 'a' },
  resources: { name: 'El recurso', ending: 'o' },
  courses: { name: 'La ficha de curso', ending: 'a' },
};

/** Lo que se le dice al autor cuando su contenido llega a cada estado. */
function outcome(state: string, ending: 'a' | 'o'): string {
  const phrases: Record<string, string> = {
    SUBMITTED: 'se envió a revisión',
    IN_REVIEW: 'está en revisión',
    RETURNED: `fue devuelt${ending} con observaciones`,
    APPROVED: `fue aprobad${ending}`,
    PUBLISHED: `fue publicad${ending}`,
    ARCHIVED: `fue archivad${ending}`,
    DRAFT: 'volvió a borrador',
  };
  return phrases[state] ?? 'cambió de estado';
}

@Injectable()
export class EditorialService {
  private readonly contents = new Map<string, PublishableContent>();

  constructor(
    @Inject(EDITORIAL_STORE) private readonly store: EditorialStore,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(NOTIFICATION_STORE) private readonly notifications: NotificationStore,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
  ) {}

  /** Cada modulo con contenido publicable se registra al arrancar. */
  register(content: PublishableContent): void {
    this.contents.set(content.entityType, content);
  }

  async transition(
    actor: SessionUser,
    entityType: string,
    entityId: string,
    targetState: string,
    comment?: string | null,
  ): Promise<{ state: string }> {
    const content = this.contentOf(entityType);
    const info = await this.infoOrFail(content, entityId);

    decideTransition(await this.store.activeRules(), {
      entityType,
      currentState: info.state,
      targetState,
      actor,
      authorIds: info.authorIds,
      comment,
    });
    await content.assertCanEnter?.(entityId, targetState);

    const change = {
      entityType: content.entityType,
      entityId,
      from: info.state,
      to: targetState,
      actorId: actor.id,
      comment: comment?.trim() || null,
    };

    // Estado, revision, bitacora y aviso en una sola transaccion: no puede existir un contenido
    // publicado sin rastro de quien lo publico (RF-14).
    await this.unitOfWork.run(async (tx) => {
      if (!(await this.store.changeState(change, tx))) {
        throw DomainError.conflict('estado_cambiado', 'El contenido cambió de estado; recarga e intenta de nuevo.');
      }
      await this.store.recordReview(change, tx);
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'editorial.transition',
          objectType: entityType,
          objectId: entityId,
          minimalDetail: { from: change.from, to: change.to },
        },
        tx,
      );
      await this.notifications.create(
        info.authorIds
          .filter((authorId) => authorId !== actor.id)
          .map((recipientId) => ({
            type: targetState === 'PUBLISHED' ? 'CONTENT_PUBLISHED' : 'EDITORIAL_TRANSITION',
            recipientId,
            title: `${ENTITY[content.entityType].name} «${info.title}» ${outcome(targetState, ENTITY[content.entityType].ending)}`,
            message: change.comment
              ? 'Revisa las observaciones en el historial editorial.'
              : `${actor.displayName} cambió su estado editorial.`,
            link: `${content.authorPath}/${entityId}`,
          })),
        tx,
      );
    });

    return { state: targetState };
  }

  async availableFor(actor: SessionUser, entityType: string, entityId: string) {
    const info = await this.infoOrFail(this.contentOf(entityType), entityId);
    this.assertCanSee(actor, info);
    return availableTransitions(await this.store.activeRules(), {
      entityType,
      currentState: info.state,
      actor,
      authorIds: info.authorIds,
    });
  }

  async history(actor: SessionUser, entityType: string, entityId: string): Promise<ReviewEntry[]> {
    const content = this.contentOf(entityType);
    this.assertCanSee(actor, await this.infoOrFail(content, entityId));
    return this.store.history(content.entityType, entityId);
  }

  queue(): Promise<QueueItem[]> {
    return this.store.queue(QUEUE_STATES);
  }

  private contentOf(entityType: string): PublishableContent {
    const content = this.contents.get(entityType);
    if (!content || !PUBLISHABLE_ENTITIES.includes(entityType as PublishableEntity)) {
      throw DomainError.notFound('entidad_desconocida', `"${entityType}" no es un contenido publicable.`);
    }
    return content;
  }

  private async infoOrFail(content: PublishableContent, entityId: string): Promise<EditorialInfo> {
    const info = await content.editorialInfo(entityId);
    if (!info) {
      throw DomainError.notFound('contenido_no_encontrado', 'El contenido no existe.');
    }
    return info;
  }

  /** El historial editorial solo lo ven los autores del contenido y quienes revisan. */
  private assertCanSee(actor: SessionUser, info: EditorialInfo): void {
    if (!info.authorIds.includes(actor.id) && !hasPermission(actor, Permission.ContentReview)) {
      throw DomainError.notFound('contenido_no_encontrado', 'El contenido no existe.');
    }
  }
}
