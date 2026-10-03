import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NewNotification, NotificationRecord, NotificationStore } from '../../../modules/notifications/notifications';
import { Tx } from '../../../shared/persistence';
import { PgRepository } from '../database.module';

@Injectable()
export class PgNotificationStore extends PgRepository implements NotificationStore {
  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  async create(entries: NewNotification[], tx: Tx): Promise<void> {
    for (const entry of entries) {
      await this.query(
        `INSERT INTO notifications (type, recipient_id, title, message, link, delivery_status)
         VALUES ($1, $2, $3, $4, $5, 'SENT')`,
        [entry.type, entry.recipientId, entry.title, entry.message, entry.link],
        tx,
      );
    }
  }

  async listFor(userId: string, limit: number): Promise<{ items: NotificationRecord[]; unread: number }> {
    const items = await this.query<NotificationRecord>(
      `SELECT id, type, title, message, link, created_at AS "createdAt", read_at AS "readAt"
         FROM notifications
        WHERE recipient_id = $1
        ORDER BY created_at DESC, id
        LIMIT $2`,
      [userId, limit],
    );
    const unread = await this.count(
      `SELECT count(*)::int AS n FROM notifications WHERE recipient_id = $1 AND read_at IS NULL`,
      [userId],
    );
    return { items, unread };
  }

  async markRead(userId: string, id: string): Promise<boolean> {
    // Con un CTE el resultado es una lista de filas; un UPDATE directo devuelve [filas, cantidad].
    const rows = await this.query(
      `WITH marked AS (
         UPDATE notifications SET read_at = coalesce(read_at, now())
          WHERE id = $1 AND recipient_id = $2
         RETURNING id)
       SELECT id FROM marked`,
      [id, userId],
    );
    return rows.length === 1;
  }

  async markAllRead(userId: string): Promise<void> {
    await this.query(`UPDATE notifications SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL`, [userId]);
  }
}
