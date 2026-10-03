import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EditorialStore, QueueItem, ReviewEntry, StateChange } from '../../../modules/editorial/application/ports';
import { PublishableEntity, TransitionRule } from '../../../modules/editorial/domain/state-machine';
import { Tx } from '../../../shared/persistence';
import { PgRepository } from '../database.module';

/**
 * Tabla de cada entidad publicable y su columna en editorial_reviews.
 * Los nombres salen de esta lista cerrada, nunca de la peticion.
 */
const TARGETS: Record<PublishableEntity, { table: string; reviewColumn: string }> = {
  initiatives: { table: 'initiatives', reviewColumn: 'initiative_id' },
  resources: { table: 'resources', reviewColumn: 'resource_id' },
  courses: { table: 'courses', reviewColumn: 'course_id' },
};

@Injectable()
export class PgEditorialStore extends PgRepository implements EditorialStore {
  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  activeRules(): Promise<TransitionRule[]> {
    return this.query<TransitionRule>(
      `SELECT t.entity_type      AS "entityType",
              t.from_status      AS "from",
              t.to_status        AS "to",
              p.code             AS "requiredPermission",
              t.requires_comment AS "requiresComment",
              t.forbid_self      AS "forbidSelf"
         FROM editorial_transitions t
         JOIN permissions p ON p.id = t.required_permission_id
        WHERE t.active`,
    );
  }

  async changeState(change: StateChange, tx: Tx): Promise<boolean> {
    const { table } = TARGETS[change.entityType];
    // El filtro por estado de origen evita que dos transiciones simultaneas se pisen.
    const changed = await this.query(
      `WITH changed AS (
         UPDATE ${table}
            SET editorial_status = $3::varchar,
                updated_at = now(),
                published_at = CASE WHEN $3::varchar = 'PUBLISHED' THEN now() ELSE published_at END
          WHERE id = $1 AND editorial_status = $2
        RETURNING id)
       SELECT id FROM changed`,
      [change.entityId, change.from, change.to],
      tx,
    );
    return changed.length === 1;
  }

  async recordReview(change: StateChange, tx: Tx): Promise<void> {
    const { reviewColumn } = TARGETS[change.entityType];
    await this.query(
      `INSERT INTO editorial_reviews (${reviewColumn}, from_status, to_status, actor_id, comment)
       VALUES ($1, $2, $3, $4, $5)`,
      [change.entityId, change.from, change.to, change.actorId, change.comment],
      tx,
    );
  }

  history(entityType: PublishableEntity, entityId: string): Promise<ReviewEntry[]> {
    const { reviewColumn } = TARGETS[entityType];
    return this.query<ReviewEntry>(
      `SELECT r.from_status AS "from",
              r.to_status   AS "to",
              u.display_name AS "actorName",
              r.comment,
              r.created_at AS "createdAt"
         FROM editorial_reviews r JOIN users u ON u.id = r.actor_id
        WHERE r.${reviewColumn} = $1
        ORDER BY r.created_at, r.id`,
      [entityId],
    );
  }

  queue(states: string[]): Promise<QueueItem[]> {
    return this.query<QueueItem>(
      `WITH content AS (
         SELECT 'initiatives' AS entity_type, i.id, i.title, i.editorial_status, i.updated_at,
                (SELECT a.user_id FROM initiative_authors a WHERE a.initiative_id = i.id ORDER BY a.added_at LIMIT 1) AS author_id,
                (SELECT max(r.created_at) FROM editorial_reviews r WHERE r.initiative_id = i.id) AS last_review
           FROM initiatives i
         UNION ALL
         SELECT 'resources', r.id, r.title, r.editorial_status, r.updated_at, r.created_by,
                (SELECT max(er.created_at) FROM editorial_reviews er WHERE er.resource_id = r.id)
           FROM resources r
         UNION ALL
         SELECT 'courses', c.id, c.title, c.editorial_status, c.updated_at, c.created_by,
                (SELECT max(er.created_at) FROM editorial_reviews er WHERE er.course_id = c.id)
           FROM courses c)
       SELECT c.entity_type AS "entityType", c.id, c.title,
              c.editorial_status AS state,
              coalesce(u.display_name, 'Usuario') AS "authorName",
              coalesce(c.last_review, c.updated_at) AS since
         FROM content c LEFT JOIN users u ON u.id = c.author_id
        WHERE c.editorial_status = ANY($1::varchar[])
        ORDER BY since, c.id`,
      [states],
    );
  }
}
