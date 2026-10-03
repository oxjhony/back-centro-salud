import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SearchFilter, SearchHit, SearchIndex } from '../../../modules/search/search';
import { Page, PageRequest } from '../../../shared/persistence';
import { PgRepository } from '../database.module';
import { hasAllTerms, offset, termsOf, toPage } from './sql';

/** Una rama por entidad publicable; todas exponen las mismas columnas. */
const BRANCHES = [
  { type: 'initiatives', table: 'initiatives', excerpt: 'summary', terms: ['initiative_terms', 'initiative_id'] },
  { type: 'resources', table: 'resources', excerpt: 'description', terms: ['resource_terms', 'resource_id'] },
  { type: 'courses', table: 'courses', excerpt: 'summary', terms: ['course_terms', 'course_id'] },
] as const;

@Injectable()
export class PgSearchIndex extends PgRepository implements SearchIndex {
  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  async search(filter: SearchFilter, page: PageRequest): Promise<Page<SearchHit>> {
    const union = BRANCHES.map(
      ({ type, table, excerpt, terms: [joinTable, column] }) => `
        SELECT '${type}' AS type, e.id, e.title, left(e.${excerpt}, 280) AS excerpt,
               ${termsOf(joinTable, column, 'e')} AS terms,
               e.published_at, e.search_vector
          FROM ${table} e
         WHERE e.editorial_status = 'PUBLISHED'
           AND ($2::text IS NULL OR $2 = '${type}')
           AND ${hasAllTerms(joinTable, column, 'e', '$3')}`,
    ).join(' UNION ALL ');

    // Con texto, primero lo mas pertinente; sin texto, lo mas reciente.
    const rows = await this.query<SearchHit & { total: string }>(
      `WITH query AS (SELECT CASE WHEN $1::text IS NULL THEN NULL
                                  ELSE plainto_tsquery('spanish', immutable_unaccent($1)) END AS q),
            hits AS (${union})
       SELECT h.type, h.id, h.title, h.excerpt, h.terms, h.published_at AS "publishedAt",
              count(*) OVER () AS total
         FROM hits h, query
        WHERE query.q IS NULL OR h.search_vector @@ query.q
        ORDER BY CASE WHEN query.q IS NULL THEN 0 ELSE ts_rank(h.search_vector, query.q) END DESC,
                 h.published_at DESC, h.id
        LIMIT $4 OFFSET $5`,
      [filter.q ?? null, filter.type ?? null, filter.termIds, page.pageSize, offset(page)],
    );
    return toPage(rows, page);
  }
}
