import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CourseRepository, LinkedCourse, PublicCourseFilter } from '../../../modules/courses/application/ports';
import { CourseData, CourseDetail, CourseSummary } from '../../../modules/courses/domain/course';
import { LmsLink } from '../../../modules/courses/domain/lms-link';
import { DomainError } from '../../../shared/errors';
import { Page, PageRequest, Tx } from '../../../shared/persistence';
import { PG_UNIQUE_VIOLATION, pgErrorCode, PgRepository } from '../database.module';
import { hasAllTerms, matchesText, offset, relatedOf, termsOf, toPage } from './sql';

const SUMMARY_COLUMNS = `
  c.id, c.title, c.summary, c.type, c.modality, c.duration,
  c.start_date::text AS "startDate",
  c.end_date::text   AS "endDate",
  c.editorial_status AS state,
  ${termsOf('course_terms', 'course_id', 'c')} AS terms,
  json_build_object(
    'externalId', c.moodle_external_id,
    'url',        c.lms_url,
    'status',     c.lms_link_status,
    'verifiedAt', c.lms_verified_at,
    'error',      c.lms_link_error) AS link,
  c.published_at AS "publishedAt",
  c.updated_at   AS "updatedAt"`;

const DETAIL_COLUMNS = `${SUMMARY_COLUMNS},
  c.capacity, c.requirements,
  c.access_instructions AS "accessInstructions",
  c.created_by          AS "createdBy",
  c.created_at          AS "createdAt",
  ${relatedOf('course_initiatives', 'course_id', 'c.id', 'initiatives', 'initiative_id')} AS initiatives,
  ${relatedOf('course_resources', 'course_id', 'c.id', 'resources', 'resource_id')} AS resources`;

type WithLink<T extends { link: LmsLink }> = Omit<T, 'link'> & {
  link: Omit<LmsLink, 'verifiedAt'> & { verifiedAt: string | null };
};

function withDates<T extends { link: LmsLink }>(row: WithLink<T>): T {
  return { ...row, link: { ...row.link, verifiedAt: row.link.verifiedAt ? new Date(row.link.verifiedAt) : null } } as T;
}

function linkParams(link: LmsLink): unknown[] {
  return [link.externalId, link.url, link.status, link.verifiedAt, link.error];
}

@Injectable()
export class PgCourseRepository extends PgRepository implements CourseRepository {
  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  async insert(id: string, data: CourseData, link: LmsLink, createdBy: string, tx: Tx): Promise<void> {
    await this.guarded(() =>
      this.query(
        `INSERT INTO courses
           (id, title, summary, type, modality, duration, start_date, end_date, capacity, requirements,
            access_instructions, created_by,
            moodle_external_id, lms_url, lms_link_status, lms_verified_at, lms_link_error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          id,
          data.title,
          data.summary,
          data.type,
          data.modality,
          data.duration,
          data.startDate,
          data.endDate,
          data.capacity,
          data.requirements,
          data.accessInstructions,
          createdBy,
          ...linkParams(link),
        ],
        tx,
      ),
    );
    await this.replaceAssociations(id, data, createdBy, tx);
  }

  async update(id: string, data: CourseData, link: LmsLink, actorId: string, tx: Tx): Promise<void> {
    await this.query(
      `UPDATE courses
          SET title = $2, summary = $3, type = $4, modality = $5, duration = $6, start_date = $7, end_date = $8,
              capacity = $9, requirements = $10, access_instructions = $11, updated_at = now()
        WHERE id = $1`,
      [
        id,
        data.title,
        data.summary,
        data.type,
        data.modality,
        data.duration,
        data.startDate,
        data.endDate,
        data.capacity,
        data.requirements,
        data.accessInstructions,
      ],
      tx,
    );
    await this.updateLink(id, link, tx);
    await this.replaceAssociations(id, data, actorId, tx);
  }

  async updateLink(id: string, link: LmsLink, tx?: Tx): Promise<void> {
    await this.guarded(() =>
      this.query(
        `UPDATE courses
            SET moodle_external_id = $2, lms_url = $3, lms_link_status = $4, lms_verified_at = $5, lms_link_error = $6
          WHERE id = $1`,
        [id, ...linkParams(link)],
        tx,
      ),
    );
  }

  /** Se asocian iniciativas publicadas y recursos propios o publicados; lo ya asociado se conserva. */
  private async replaceAssociations(id: string, data: CourseData, actorId: string, tx: Tx): Promise<void> {
    await this.replaceTerms('course_terms', 'course_id', id, data.termIds, tx);

    const initiativeIds = [...new Set(data.initiativeIds)];
    const initiatives = await this.count(
      `SELECT count(*)::int AS n FROM initiatives i
        WHERE i.id = ANY($1::uuid[])
          AND (i.editorial_status = 'PUBLISHED'
               OR EXISTS (SELECT 1 FROM course_initiatives x WHERE x.course_id = $2 AND x.initiative_id = i.id))`,
      [initiativeIds, id],
      tx,
    );
    const resourceIds = [...new Set(data.resourceIds)];
    const resources = await this.count(
      `SELECT count(*)::int AS n FROM resources r
        WHERE r.id = ANY($1::uuid[])
          AND (r.editorial_status = 'PUBLISHED' OR r.created_by = $2
               OR EXISTS (SELECT 1 FROM course_resources x WHERE x.course_id = $3 AND x.resource_id = r.id))`,
      [resourceIds, actorId, id],
      tx,
    );
    if (initiatives !== initiativeIds.length || resources !== resourceIds.length) {
      throw DomainError.invalid('contenido_invalido', 'Alguna iniciativa o recurso indicado no existe o no se puede asociar.');
    }
    await this.replaceLinks('course_initiatives', 'course_id', id, 'initiative_id', initiativeIds, tx);
    await this.replaceLinks('course_resources', 'course_id', id, 'resource_id', resourceIds, tx);
  }

  /** Traduce las restricciones de la base a errores de dominio que la API puede explicar. */
  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
        throw DomainError.conflict('idnumber_en_uso', 'Otra ficha ya está enlazada a ese curso de Moodle.');
      }
      throw error;
    }
  }

  async findById(id: string): Promise<CourseDetail | null> {
    const row = await this.one<WithLink<CourseDetail>>(`SELECT ${DETAIL_COLUMNS} FROM courses c WHERE c.id = $1`, [id]);
    return row ? withDates(row) : null;
  }

  async listByOwner(userId: string): Promise<CourseSummary[]> {
    const rows = await this.query<WithLink<CourseSummary>>(
      `SELECT ${SUMMARY_COLUMNS} FROM courses c WHERE c.created_by = $1 ORDER BY c.updated_at DESC, c.id`,
      [userId],
    );
    return rows.map(withDates);
  }

  async listLinked(): Promise<LinkedCourse[]> {
    const rows = await this.query<WithLink<CourseSummary>>(
      `SELECT ${SUMMARY_COLUMNS} FROM courses c WHERE c.moodle_external_id IS NOT NULL ORDER BY c.created_at, c.id`,
    );
    return rows.map(withDates).map(({ id, link }) => ({ id, link: link as LinkedCourse['link'] }));
  }

  async searchPublished(filter: PublicCourseFilter, page: PageRequest): Promise<Page<CourseDetail>> {
    const rows = await this.query<WithLink<CourseDetail> & { total: string }>(
      `SELECT ${DETAIL_COLUMNS}, count(*) OVER () AS total
         FROM courses c
        WHERE c.editorial_status = 'PUBLISHED'
          AND ${matchesText('c', '$1')}
          AND ($2::text IS NULL OR c.type = $2)
          AND ($3::text IS NULL OR c.modality = $3)
          AND ${hasAllTerms('course_terms', 'course_id', 'c', '$4')}
        ORDER BY c.title, c.id
        LIMIT $5 OFFSET $6`,
      [filter.q ?? null, filter.type ?? null, filter.modality ?? null, filter.termIds, page.pageSize, offset(page)],
    );
    const result = toPage(rows, page);
    return { ...result, items: result.items.map((row) => withDates<CourseDetail>(row)) };
  }
}
