import { MigrationInterface, QueryRunner } from 'typeorm';
import { APP_ROLE } from './app-role';
import { ENUMS, inList, searchVector } from './sql';

/**
 * Incrementos recomendados (seccion 4.1): EventOrNews, Actor, Consultation, Contribution,
 * Notification y AggregatedMetric. El esquema queda completo aunque la API los vaya habilitando
 * por partes.
 */
export class Incrementos1791000000004 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // --- Agenda y noticias (RF-07) ---------------------------------------------------------------
    await q.query(`
      CREATE TABLE events_news (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type             varchar(10)  NOT NULL,
        title            varchar(255) NOT NULL,
        content          text         NOT NULL,
        valid_from       date         NOT NULL,
        valid_until      date,
        editorial_status varchar(20)  NOT NULL DEFAULT 'DRAFT',
        created_by       uuid NOT NULL REFERENCES users (id),
        created_at       timestamptz  NOT NULL DEFAULT now(),
        updated_at       timestamptz  NOT NULL DEFAULT now(),
        published_at     timestamptz,
        search_vector    tsvector GENERATED ALWAYS AS (${searchVector([['title', 'A'], ['content', 'B']])}) STORED,
        CONSTRAINT ck_events_news_type CHECK (type IN (${inList(ENUMS.contentType)})),
        CONSTRAINT ck_events_news_status CHECK (editorial_status IN (${inList(ENUMS.editorialStatus)})),
        CONSTRAINT ck_events_news_published CHECK (editorial_status <> 'PUBLISHED' OR published_at IS NOT NULL),
        CONSTRAINT ck_events_news_validity CHECK (valid_until IS NULL OR valid_until >= valid_from)
      )`);
    await q.query(`CREATE INDEX ix_events_news_validity ON events_news (editorial_status, valid_from, valid_until)`);
    await q.query(`
      CREATE TABLE resource_events (
        resource_id uuid NOT NULL REFERENCES resources (id) ON DELETE CASCADE,
        event_id    uuid NOT NULL REFERENCES events_news (id) ON DELETE CASCADE,
        PRIMARY KEY (resource_id, event_id)
      )`);

    // --- Actores y redes (RF-08) -----------------------------------------------------------------
    await q.query(`
      CREATE TABLE actors (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name           varchar(255) NOT NULL,
        type           varchar(30)  NOT NULL,
        capabilities   text,
        public_contact varchar(255),
        territory      varchar(150),
        created_at     timestamptz NOT NULL DEFAULT now(),
        updated_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_actors_type CHECK (type IN (${inList(ENUMS.actorType)}))
      )`);
    await q.query(`
      CREATE TABLE actor_initiatives (
        actor_id      uuid NOT NULL REFERENCES actors (id) ON DELETE CASCADE,
        initiative_id uuid NOT NULL REFERENCES initiatives (id) ON DELETE CASCADE,
        PRIMARY KEY (actor_id, initiative_id)
      )`);
    await q.query(`
      CREATE TABLE actor_resources (
        actor_id    uuid NOT NULL REFERENCES actors (id) ON DELETE CASCADE,
        resource_id uuid NOT NULL REFERENCES resources (id) ON DELETE CASCADE,
        PRIMARY KEY (actor_id, resource_id)
      )`);

    // --- Participacion moderada (RF-09) ----------------------------------------------------------
    await q.query(`
      CREATE TABLE consultations (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title          varchar(255) NOT NULL,
        purpose        text   NOT NULL,
        questions      text[] NOT NULL,
        open_from      date   NOT NULL,
        open_until     date,
        privacy_notice text   NOT NULL,
        status         varchar(10) NOT NULL DEFAULT 'DRAFT',
        created_at     timestamptz NOT NULL DEFAULT now(),
        updated_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_consultations_status CHECK (status IN (${inList(ENUMS.consultationStatus)})),
        CONSTRAINT ck_consultations_questions CHECK (cardinality(questions) BETWEEN 1 AND 20),
        CONSTRAINT ck_consultations_period CHECK (open_until IS NULL OR open_until >= open_from)
      )`);
    // Un aporte sin consentimiento no se guarda, y ninguno nace aprobado (Especificacion 2.2).
    await q.query(`
      CREATE TABLE contributions (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        consultation_id   uuid NOT NULL REFERENCES consultations (id),
        author_id         uuid REFERENCES users (id) ON DELETE SET NULL,
        answers           text[]      NOT NULL,
        consent           boolean     NOT NULL,
        identifier        varchar(40) NOT NULL UNIQUE,
        moderation_status varchar(10) NOT NULL DEFAULT 'PENDING',
        created_at        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_contributions_consent CHECK (consent),
        CONSTRAINT ck_contributions_moderation CHECK (moderation_status IN (${inList(ENUMS.moderationStatus)}))
      )`);
    await q.query(`CREATE INDEX ix_contributions_consultation ON contributions (consultation_id, moderation_status)`);

    // --- Notificaciones (RF-13) ------------------------------------------------------------------
    await q.query(`
      CREATE TABLE notifications (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type            varchar(30)  NOT NULL,
        recipient_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        title           varchar(255) NOT NULL,
        message         text         NOT NULL,
        link            varchar(500),
        created_at      timestamptz  NOT NULL DEFAULT now(),
        delivery_status varchar(10)  NOT NULL DEFAULT 'PENDING',
        read_at         timestamptz,
        CONSTRAINT ck_notifications_type CHECK (type IN (${inList(ENUMS.notificationType)})),
        CONSTRAINT ck_notifications_delivery CHECK (delivery_status IN (${inList(ENUMS.deliveryStatus)}))
      )`);
    await q.query(`CREATE INDEX ix_notifications_recipient ON notifications (recipient_id, created_at DESC)`);

    // --- Analitica agregada (RF-11, RF-12): sin vinculo con usuarios -----------------------------
    await q.query(`
      CREATE TABLE aggregated_metrics (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        usage_event  varchar(80) NOT NULL,
        period_start date        NOT NULL,
        period_end   date        NOT NULL,
        dimension    varchar(80) NOT NULL DEFAULT 'total',
        value        numeric     NOT NULL,
        CONSTRAINT uq_aggregated_metrics UNIQUE (usage_event, period_start, period_end, dimension),
        CONSTRAINT ck_aggregated_metrics_period CHECK (period_end >= period_start)
      )`);

    await q.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON
        events_news, resource_events, actors, actor_initiatives, actor_resources, consultations
      TO ${APP_ROLE}`);
    await q.query(`GRANT SELECT, INSERT, UPDATE ON contributions, notifications, aggregated_metrics TO ${APP_ROLE}`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE aggregated_metrics, notifications, contributions, consultations,
                 actor_resources, actor_initiatives, actors, resource_events, events_news`);
  }
}
