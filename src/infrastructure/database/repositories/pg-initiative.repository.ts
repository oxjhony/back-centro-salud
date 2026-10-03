import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  InitiativeRepository,
  PublicInitiativeFilter,
} from '../../../modules/initiatives/application/initiatives.service';
import { InitiativeData, InitiativeDetail, InitiativeSummary } from '../../../modules/initiatives/domain/initiative';
import { DomainError } from '../../../shared/errors';
import { Page, PageRequest, Tx } from '../../../shared/persistence';
import { PgRepository } from '../database.module';
import { hasAllTerms, matchesText, offset, relatedOf, termsOf, toPage } from './sql';

const SUMMARY_COLUMNS = `
  i.id, i.title, i.summary, i.type,
  i.editorial_status AS state,
  ${termsOf('initiative_terms', 'initiative_id', 'i')} AS terms,
  i.published_at AS "publishedAt",
  i.updated_at   AS "updatedAt"`;

const DETAIL_COLUMNS = `${SUMMARY_COLUMNS},
  i.period_start::text AS "startDate",
  i.period_end::text   AS "endDate",
  i.results,
  i.created_at AS "createdAt",
  coalesce((SELECT json_agg(json_build_object('id', u.id, 'displayName', u.display_name) ORDER BY a.added_at, u.display_name)
              FROM initiative_authors a JOIN users u ON u.id = a.user_id
             WHERE a.initiative_id = i.id), '[]'::json) AS authors,
  ${relatedOf('initiative_resources', 'initiative_id', 'i.id', 'resources', 'resource_id')} AS resources,
  ${relatedOf('course_initiatives', 'initiative_id', 'i.id', 'courses', 'course_id')} AS courses`;

@Injectable()
export class PgInitiativeRepository extends PgRepository implements InitiativeRepository {
  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  async insert(data: InitiativeData, authorId: string, tx: Tx): Promise<string> {
    const { id } = await this.one<{ id: string }>(
      `INSERT INTO initiatives (title, summary, type, period_start, period_end, results)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [data.title, data.summary, data.type, data.startDate, data.endDate, data.results],
      tx,
    );
    await this.query(`INSERT INTO initiative_authors (initiative_id, user_id) VALUES ($1, $2)`, [id, authorId], tx);
    await this.replaceAssociations(id, data, authorId, tx);
    return id;
  }

  async update(id: string, data: InitiativeData, actorId: string, tx: Tx): Promise<void> {
    await this.query(
      `UPDATE initiatives
          SET title = $2, summary = $3, type = $4, period_start = $5, period_end = $6, results = $7, updated_at = now()
        WHERE id = $1`,
      [id, data.title, data.summary, data.type, data.startDate, data.endDate, data.results],
      tx,
    );
    await this.replaceAssociations(id, data, actorId, tx);
  }

  /**
   * Un autor adjunta sus propios recursos o recursos ya publicados. Uno que ya estaba asociado
   * se conserva aunque haya cambiado de estado.
   */
  private async replaceAssociations(id: string, data: InitiativeData, actorId: string, tx: Tx): Promise<void> {
    await this.replaceTerms('initiative_terms', 'initiative_id', id, data.termIds, tx);

    const resourceIds = [...new Set(data.resourceIds)];
    const linkable = await this.count(
      `SELECT count(*)::int AS n FROM resources r
        WHERE r.id = ANY($1::uuid[])
          AND (r.editorial_status = 'PUBLISHED' OR r.created_by = $2
               OR EXISTS (SELECT 1 FROM initiative_resources x WHERE x.initiative_id = $3 AND x.resource_id = r.id))`,
      [resourceIds, actorId, id],
      tx,
    );
    if (linkable !== resourceIds.length) {
      throw DomainError.invalid('contenido_invalido', 'Algún recurso indicado no existe o no se puede asociar.');
    }
    await this.replaceLinks('initiative_resources', 'initiative_id', id, 'resource_id', resourceIds, tx);
  }

  findById(id: string): Promise<InitiativeDetail | null> {
    return this.one<InitiativeDetail>(`SELECT ${DETAIL_COLUMNS} FROM initiatives i WHERE i.id = $1`, [id]);
  }

  listByAuthor(userId: string): Promise<InitiativeSummary[]> {
    return this.query<InitiativeSummary>(
      `SELECT ${SUMMARY_COLUMNS}
         FROM initiatives i
        WHERE EXISTS (SELECT 1 FROM initiative_authors a WHERE a.initiative_id = i.id AND a.user_id = $1)
        ORDER BY i.updated_at DESC, i.id`,
      [userId],
    );
  }

  async searchPublished(filter: PublicInitiativeFilter, page: PageRequest): Promise<Page<InitiativeSummary>> {
    const rows = await this.query<InitiativeSummary & { total: string }>(
      `SELECT ${SUMMARY_COLUMNS}, count(*) OVER () AS total
         FROM initiatives i
        WHERE i.editorial_status = 'PUBLISHED'
          AND ${matchesText('i', '$1')}
          AND ($2::text IS NULL OR i.type = $2)
          AND ${hasAllTerms('initiative_terms', 'initiative_id', 'i', '$3')}
        ORDER BY i.published_at DESC, i.id
        LIMIT $4 OFFSET $5`,
      [filter.q ?? null, filter.type ?? null, filter.termIds, page.pageSize, offset(page)],
    );
    return toPage(rows, page);
  }
}
