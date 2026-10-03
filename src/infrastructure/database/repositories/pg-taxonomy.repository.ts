import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TaxonomyRepository } from '../../../modules/taxonomy/application/taxonomy.service';
import { TaxonomyType, Term, TermAdmin, TermData } from '../../../modules/taxonomy/domain/taxonomy';
import { DomainError } from '../../../shared/errors';
import { Tx } from '../../../shared/persistence';
import { PG_UNIQUE_VIOLATION, pgErrorCode, PgRepository } from '../database.module';

const TERM_COLUMNS = `t.id, t.type, t.name, t.parent_id AS "parentId", t.active`;

/** Cuantos contenidos clasifica el termino, sumando las cuatro tablas de asociacion. */
const USAGE = `
  (SELECT count(*) FROM initiative_terms x WHERE x.term_id = t.id) +
  (SELECT count(*) FROM resource_terms   x WHERE x.term_id = t.id) +
  (SELECT count(*) FROM course_terms     x WHERE x.term_id = t.id)`;

const ADMIN_COLUMNS = `${TERM_COLUMNS},
  (${USAGE})::int AS usage,
  (SELECT count(*) FROM taxonomy_terms c WHERE c.parent_id = t.id)::int AS children,
  t.updated_at AS "updatedAt"`;

@Injectable()
export class PgTaxonomyRepository extends PgRepository implements TaxonomyRepository {
  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  listActive(): Promise<Term[]> {
    return this.query<Term>(`SELECT ${TERM_COLUMNS} FROM taxonomy_terms t WHERE t.active ORDER BY t.type, t.name`);
  }

  listForAdmin(type?: TaxonomyType): Promise<TermAdmin[]> {
    return this.query<TermAdmin>(
      `SELECT ${ADMIN_COLUMNS} FROM taxonomy_terms t WHERE ($1::text IS NULL OR t.type = $1) ORDER BY t.type, t.name`,
      [type ?? null],
    );
  }

  find(id: string, tx?: Tx): Promise<TermAdmin | null> {
    return this.one<TermAdmin>(`SELECT ${ADMIN_COLUMNS} FROM taxonomy_terms t WHERE t.id = $1`, [id], tx);
  }

  async insert(type: TaxonomyType, data: TermData, tx: Tx): Promise<string> {
    const row = await this.guarded(() =>
      this.one<{ id: string }>(
        `INSERT INTO taxonomy_terms (type, name, parent_id, active) VALUES ($1, $2, $3, $4) RETURNING id`,
        [type, data.name, data.parentId, data.active],
        tx,
      ),
    );
    return row.id;
  }

  async update(id: string, data: TermData, tx: Tx): Promise<void> {
    await this.guarded(() =>
      this.query(
        `UPDATE taxonomy_terms SET name = $2, parent_id = $3, active = $4, updated_at = now() WHERE id = $1`,
        [id, data.name, data.parentId, data.active],
        tx,
      ),
    );
  }

  async remove(id: string, tx: Tx): Promise<void> {
    await this.query(`DELETE FROM taxonomy_terms WHERE id = $1`, [id], tx);
  }

  async ancestors(id: string, tx?: Tx): Promise<string[]> {
    const rows = await this.query<{ id: string }>(
      `WITH RECURSIVE up AS (
         SELECT parent_id AS id FROM taxonomy_terms WHERE id = $1
         UNION
         SELECT t.parent_id FROM taxonomy_terms t JOIN up ON t.id = up.id
       )
       SELECT id FROM up WHERE id IS NOT NULL`,
      [id],
      tx,
    );
    return rows.map((r) => r.id);
  }

  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
        throw DomainError.conflict('termino_duplicado', 'Ya existe un término con ese nombre en el mismo lugar de la taxonomía.');
      }
      throw error;
    }
  }
}
