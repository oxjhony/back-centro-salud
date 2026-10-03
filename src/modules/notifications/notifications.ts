import { Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { DomainError } from '../../shared/errors';
import { Tx } from '../../shared/persistence';
import { SessionUser } from '../identity/domain/permissions';
import { CurrentUser } from '../identity/http/access';

export const NOTIFICATION_STORE = Symbol('NOTIFICATION_STORE');

/** Enumeracion NotificationType del modelo de datos. */
export type NotificationType = 'EDITORIAL_TRANSITION' | 'CONTENT_PUBLISHED' | 'CONSULTATION_OPEN' | 'SYSTEM';

/** Sin contenido sensible (RF-13): titulo y mensaje cortos, nunca el comentario del revisor. */
export interface NewNotification {
  type: NotificationType;
  recipientId: string;
  title: string;
  message: string;
  link: string | null;
}

export interface NotificationRecord {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationStore {
  /** Notificaciones dentro de la plataforma: quedan entregadas (SENT) al crearse. */
  create(entries: NewNotification[], tx: Tx): Promise<void>;
  listFor(userId: string, limit: number): Promise<{ items: NotificationRecord[]; unread: number }>;
  markRead(userId: string, id: string): Promise<boolean>;
  markAllRead(userId: string): Promise<void>;
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(NOTIFICATION_STORE) private readonly store: NotificationStore) {}

  mine(user: SessionUser) {
    return this.store.listFor(user.id, 30);
  }

  async markRead(user: SessionUser, id: string): Promise<void> {
    // La notificacion de otra persona responde igual que una inexistente.
    if (!(await this.store.markRead(user.id, id))) {
      throw DomainError.notFound('notificacion_no_encontrada', 'La notificación no existe.');
    }
  }

  markAllRead(user: SessionUser): Promise<void> {
    return this.store.markAllRead(user.id);
  }
}

/** Como el panel de notificaciones de Moodle: cada persona ve solo las suyas. */
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  mine(@CurrentUser() user: SessionUser) {
    return this.notifications.mine(user);
  }

  @Post('read-all')
  @HttpCode(204)
  readAll(@CurrentUser() user: SessionUser) {
    return this.notifications.markAllRead(user);
  }

  @Post(':id/read')
  @HttpCode(204)
  read(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user, id);
  }
}
