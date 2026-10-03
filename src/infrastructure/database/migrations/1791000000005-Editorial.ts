import { MigrationInterface, QueryRunner } from 'typeorm';
import { APP_ROLE } from './app-role';
import { ENUMS, inList } from './sql';

const STATUSES = inList(ENUMS.editorialStatus);

/**
 * Flujo editorial: EditorialTransition (las reglas, como datos) y EditorialReview (la historia).
 * Toda transicion de un contenido publicable queda registrada con quien, cuando y comentario (RF-03).
 */
export class Editorial1791000000005 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE editorial_transitions (
        id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type            varchar(30),
        from_status            varchar(20) NOT NULL,
        to_status              varchar(20) NOT NULL,
        required_permission_id uuid    NOT NULL REFERENCES permissions (id),
        requires_comment       boolean NOT NULL DEFAULT false,
        forbid_self            boolean NOT NULL DEFAULT false,
        active                 boolean NOT NULL DEFAULT true,
        created_at             timestamptz NOT NULL DEFAULT now(),
        updated_at             timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_transition_entity CHECK (entity_type IS NULL OR entity_type IN (${inList(ENUMS.publishableEntity)})),
        CONSTRAINT ck_transition_from CHECK (from_status IN (${STATUSES})),
        CONSTRAINT ck_transition_to CHECK (to_status IN (${STATUSES})),
        CONSTRAINT ck_transition_changes CHECK (from_status <> to_status)
      )`);
    // El coalesce hace que NULL (todas las entidades) tambien cuente como duplicado.
    await q.query(`
      CREATE UNIQUE INDEX uq_editorial_transitions
      ON editorial_transitions (coalesce(entity_type, '*'), from_status, to_status)`);

    // Rechazar es IN_REVIEW -> ARCHIVED con comentario: el modelo no tiene un estado REJECTED.
    await q.query(`
      INSERT INTO editorial_transitions (from_status, to_status, required_permission_id, requires_comment, forbid_self)
      SELECT flow.from_status, flow.to_status, p.id, flow.requires_comment, flow.forbid_self
      FROM (VALUES
        ('DRAFT',     'SUBMITTED', 'content:submit',  false, false),
        ('SUBMITTED', 'IN_REVIEW', 'content:review',  false, true),
        ('IN_REVIEW', 'RETURNED',  'content:review',  true,  true),
        ('IN_REVIEW', 'APPROVED',  'content:approve', false, true),
        ('IN_REVIEW', 'ARCHIVED',  'content:approve', true,  true),
        ('RETURNED',  'SUBMITTED', 'content:submit',  false, false),
        ('APPROVED',  'PUBLISHED', 'content:publish', false, true),
        ('PUBLISHED', 'ARCHIVED',  'content:archive', true,  false),
        ('ARCHIVED',  'DRAFT',     'content:archive', true,  false)
      ) AS flow (from_status, to_status, permission_code, requires_comment, forbid_self)
      JOIN permissions p ON p.code = flow.permission_code`);

    // Cada revision apunta exactamente a un contenido, con clave foranea real (no un id suelto).
    await q.query(`
      CREATE TABLE editorial_reviews (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        initiative_id uuid REFERENCES initiatives (id) ON DELETE CASCADE,
        resource_id   uuid REFERENCES resources (id) ON DELETE CASCADE,
        course_id     uuid REFERENCES courses (id) ON DELETE CASCADE,
        event_id      uuid REFERENCES events_news (id) ON DELETE CASCADE,
        from_status   varchar(20) NOT NULL,
        to_status     varchar(20) NOT NULL,
        actor_id      uuid NOT NULL REFERENCES users (id),
        comment       text,
        created_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_review_target CHECK (num_nonnulls(initiative_id, resource_id, course_id, event_id) = 1),
        CONSTRAINT ck_review_from CHECK (from_status IN (${STATUSES})),
        CONSTRAINT ck_review_to CHECK (to_status IN (${STATUSES}))
      )`);
    for (const column of ['initiative_id', 'resource_id', 'course_id', 'event_id']) {
      await q.query(
        `CREATE INDEX ix_editorial_reviews_${column} ON editorial_reviews (${column}, created_at) WHERE ${column} IS NOT NULL`,
      );
    }

    // Las reglas y la historia no se reescriben desde la aplicacion.
    await q.query(`GRANT SELECT ON editorial_transitions TO ${APP_ROLE}`);
    await q.query(`GRANT SELECT, INSERT ON editorial_reviews TO ${APP_ROLE}`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE editorial_reviews, editorial_transitions`);
  }
}
