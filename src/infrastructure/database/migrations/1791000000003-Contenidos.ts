import { MigrationInterface, QueryRunner } from 'typeorm';
import { APP_ROLE } from './app-role';
import { ENUMS, inList, searchVector } from './sql';

const STATUS_CHECK = `CHECK (editorial_status IN (${inList(ENUMS.editorialStatus)}))`;
// Nada queda publicado sin la fecha en que se publico.
const PUBLISHED_CHECK = `CHECK (editorial_status <> 'PUBLISHED' OR published_at IS NOT NULL)`;

/** Contenidos del MVP: Initiative, Resource (+ ResourceVersion) y Course, con sus asociaciones. */
export class Contenidos1791000000003 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // --- Iniciativas -------------------------------------------------------------------------
    await q.query(`
      CREATE TABLE initiatives (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title            varchar(255) NOT NULL,
        summary          text         NOT NULL,
        type             varchar(40)  NOT NULL,
        period_start     date,
        period_end       date,
        results          text,
        editorial_status varchar(20)  NOT NULL DEFAULT 'DRAFT',
        created_at       timestamptz  NOT NULL DEFAULT now(),
        updated_at       timestamptz  NOT NULL DEFAULT now(),
        published_at     timestamptz,
        search_vector    tsvector GENERATED ALWAYS AS (
          ${searchVector([['title', 'A'], ['summary', 'B'], ['results', 'C']])}
        ) STORED,
        CONSTRAINT ck_initiatives_type CHECK (type IN (${inList(ENUMS.initiativeType)})),
        CONSTRAINT ck_initiatives_status ${STATUS_CHECK},
        CONSTRAINT ck_initiatives_published ${PUBLISHED_CHECK},
        CONSTRAINT ck_initiatives_period CHECK (period_start IS NULL OR period_end IS NULL OR period_end >= period_start)
      )`);
    await q.query(`CREATE INDEX ix_initiatives_status ON initiatives (editorial_status)`);
    await q.query(`CREATE INDEX ix_initiatives_published ON initiatives (published_at DESC, id)`);
    await q.query(`CREATE INDEX ix_initiatives_search ON initiatives USING gin (search_vector)`);

    // User 1..* — 0..* Initiative (autores).
    await q.query(`
      CREATE TABLE initiative_authors (
        initiative_id uuid NOT NULL REFERENCES initiatives (id) ON DELETE CASCADE,
        user_id       uuid NOT NULL REFERENCES users (id),
        added_at      timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (initiative_id, user_id)
      )`);
    await q.query(`CREATE INDEX ix_initiative_authors_user ON initiative_authors (user_id)`);
    await q.query(`
      CREATE TABLE initiative_terms (
        initiative_id uuid NOT NULL REFERENCES initiatives (id) ON DELETE CASCADE,
        term_id       uuid NOT NULL REFERENCES taxonomy_terms (id),
        PRIMARY KEY (initiative_id, term_id)
      )`);
    await q.query(`CREATE INDEX ix_initiative_terms_term ON initiative_terms (term_id)`);

    // --- Recursos ------------------------------------------------------------------------------
    await q.query(`
      CREATE TABLE resources (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title            varchar(255) NOT NULL,
        description      text         NOT NULL,
        license          varchar(120) NOT NULL,
        visibility       varchar(20)  NOT NULL DEFAULT 'PUBLIC',
        editorial_status varchar(20)  NOT NULL DEFAULT 'DRAFT',
        created_by       uuid NOT NULL REFERENCES users (id),
        created_at       timestamptz  NOT NULL DEFAULT now(),
        updated_at       timestamptz  NOT NULL DEFAULT now(),
        published_at     timestamptz,
        search_vector    tsvector GENERATED ALWAYS AS (
          ${searchVector([['title', 'A'], ['description', 'B']])}
        ) STORED,
        CONSTRAINT ck_resources_visibility CHECK (visibility IN (${inList(ENUMS.visibility)})),
        CONSTRAINT ck_resources_status ${STATUS_CHECK},
        CONSTRAINT ck_resources_published ${PUBLISHED_CHECK}
      )`);
    await q.query(`CREATE INDEX ix_resources_status ON resources (editorial_status)`);
    await q.query(`CREATE INDEX ix_resources_owner ON resources (created_by)`);
    await q.query(`CREATE INDEX ix_resources_search ON resources USING gin (search_vector)`);

    // Composicion 1 — 1..*: cada archivo cargado es una version nueva e inmutable (como mdl_files).
    await q.query(`
      CREATE TABLE resource_versions (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        resource_id       uuid NOT NULL REFERENCES resources (id) ON DELETE CASCADE,
        version_number    integer      NOT NULL,
        storage_key       varchar(255) NOT NULL UNIQUE,
        original_filename varchar(255) NOT NULL,
        mime_type         varchar(150) NOT NULL,
        size_bytes        bigint       NOT NULL,
        checksum          char(64)     NOT NULL,
        uploaded_by       uuid NOT NULL REFERENCES users (id),
        created_at        timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT uq_resource_versions_number UNIQUE (resource_id, version_number),
        CONSTRAINT ck_resource_versions_number CHECK (version_number > 0),
        CONSTRAINT ck_resource_versions_size CHECK (size_bytes > 0),
        CONSTRAINT ck_resource_versions_checksum CHECK (checksum ~ '^[0-9a-f]{64}$')
      )`);
    await q.query(`
      CREATE TABLE resource_terms (
        resource_id uuid NOT NULL REFERENCES resources (id) ON DELETE CASCADE,
        term_id     uuid NOT NULL REFERENCES taxonomy_terms (id),
        PRIMARY KEY (resource_id, term_id)
      )`);
    await q.query(`CREATE INDEX ix_resource_terms_term ON resource_terms (term_id)`);
    await q.query(`
      CREATE TABLE initiative_resources (
        initiative_id uuid NOT NULL REFERENCES initiatives (id) ON DELETE CASCADE,
        resource_id   uuid NOT NULL REFERENCES resources (id) ON DELETE CASCADE,
        PRIMARY KEY (initiative_id, resource_id)
      )`);

    // --- Cursos --------------------------------------------------------------------------------
    // Solo la ficha de catalogo. La clave de union con Moodle es su idnumber (moodle_external_id),
    // nunca su id interno: matriculas, progreso y calificaciones siguen en Moodle.
    await q.query(`
      CREATE TABLE courses (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title               varchar(255) NOT NULL,
        summary             text         NOT NULL,
        type                varchar(20)  NOT NULL,
        modality            varchar(20)  NOT NULL,
        duration            varchar(100),
        start_date          date,
        end_date            date,
        capacity            integer,
        requirements        text,
        access_instructions text,
        editorial_status    varchar(20)  NOT NULL DEFAULT 'DRAFT',
        moodle_external_id  varchar(100),
        lms_url             text,
        lms_link_status     varchar(20)  NOT NULL DEFAULT 'NOT_LINKED',
        lms_verified_at     timestamptz,
        lms_link_error      varchar(80),
        created_by          uuid NOT NULL REFERENCES users (id),
        created_at          timestamptz  NOT NULL DEFAULT now(),
        updated_at          timestamptz  NOT NULL DEFAULT now(),
        published_at        timestamptz,
        search_vector       tsvector GENERATED ALWAYS AS (
          ${searchVector([['title', 'A'], ['summary', 'B'], ['requirements', 'C']])}
        ) STORED,
        CONSTRAINT ck_courses_type CHECK (type IN (${inList(ENUMS.courseType)})),
        CONSTRAINT ck_courses_modality CHECK (modality IN (${inList(ENUMS.courseModality)})),
        CONSTRAINT ck_courses_status ${STATUS_CHECK},
        CONSTRAINT ck_courses_published ${PUBLISHED_CHECK},
        CONSTRAINT ck_courses_capacity CHECK (capacity IS NULL OR capacity > 0),
        CONSTRAINT ck_courses_dates CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
        CONSTRAINT ck_courses_link_status CHECK (lms_link_status IN (${inList(ENUMS.lmsLinkStatus)})),
        CONSTRAINT ck_courses_idnumber_not_blank CHECK (
          moodle_external_id IS NULL OR length(trim(moodle_external_id)) > 0),
        CONSTRAINT ck_courses_link_state CHECK ((moodle_external_id IS NULL) = (lms_link_status = 'NOT_LINKED')),
        CONSTRAINT ck_courses_link_verified CHECK (
          lms_link_status <> 'VERIFIED' OR (lms_url IS NOT NULL AND lms_verified_at IS NOT NULL))
      )`);
    // Dos fichas no pueden apuntar al mismo curso de Moodle (RF-06).
    await q.query(`
      CREATE UNIQUE INDEX uq_courses_moodle_external_id ON courses (moodle_external_id)
      WHERE moodle_external_id IS NOT NULL`);
    await q.query(`CREATE INDEX ix_courses_status ON courses (editorial_status)`);
    await q.query(`CREATE INDEX ix_courses_owner ON courses (created_by)`);
    await q.query(`
      CREATE INDEX ix_courses_link_problem ON courses (lms_link_status)
      WHERE lms_link_status IN ('ERROR', 'ORPHAN')`);
    await q.query(`CREATE INDEX ix_courses_search ON courses USING gin (search_vector)`);

    await q.query(`
      CREATE TABLE course_terms (
        course_id uuid NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
        term_id   uuid NOT NULL REFERENCES taxonomy_terms (id),
        PRIMARY KEY (course_id, term_id)
      )`);
    await q.query(`CREATE INDEX ix_course_terms_term ON course_terms (term_id)`);
    await q.query(`
      CREATE TABLE course_initiatives (
        course_id     uuid NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
        initiative_id uuid NOT NULL REFERENCES initiatives (id) ON DELETE CASCADE,
        PRIMARY KEY (course_id, initiative_id)
      )`);
    await q.query(`
      CREATE TABLE course_resources (
        course_id   uuid NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
        resource_id uuid NOT NULL REFERENCES resources (id) ON DELETE CASCADE,
        PRIMARY KEY (course_id, resource_id)
      )`);

    await q.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON
        initiatives, initiative_authors, initiative_terms,
        resources, resource_terms, initiative_resources,
        courses, course_terms, course_initiatives, course_resources
      TO ${APP_ROLE}`);
    // Una version cargada no se reescribe ni se borra: es la evidencia de que se publico (RF-05).
    await q.query(`GRANT SELECT, INSERT ON resource_versions TO ${APP_ROLE}`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE course_resources, course_initiatives, course_terms, courses,
                 initiative_resources, resource_terms, resource_versions, resources,
                 initiative_terms, initiative_authors, initiatives`);
  }
}
