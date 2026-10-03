import { Page, PageRequest } from '../../../shared/persistence';

/** Fragmentos SQL compartidos por los adaptadores. Reciben solo constantes, nunca datos de la peticion. */

/** Terminos de un contenido como arreglo JSON [{id, name, type}]. */
export function termsOf(joinTable: string, ownerColumn: string, ownerAlias: string): string {
  return `coalesce((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'type', t.type) ORDER BY t.type, t.name)
                      FROM ${joinTable} x JOIN taxonomy_terms t ON t.id = x.term_id
                     WHERE x.${ownerColumn} = ${ownerAlias}.id), '[]'::json)`;
}

/** Contenidos asociados como arreglo JSON [{id, title, state}]. */
export function relatedOf(
  joinTable: string,
  ownerColumn: string,
  ownerExpr: string,
  targetTable: string,
  targetColumn: string,
): string {
  return `coalesce((SELECT json_agg(json_build_object('id', r.id, 'title', r.title, 'state', r.editorial_status) ORDER BY r.title)
                      FROM ${joinTable} x JOIN ${targetTable} r ON r.id = x.${targetColumn}
                     WHERE x.${ownerColumn} = ${ownerExpr}), '[]'::json)`;
}

/**
 * Condicion "el contenido tiene todos los terminos del filtro, o alguno de sus descendientes".
 * `param` es el marcador del arreglo de ids ($n).
 */
export function hasAllTerms(joinTable: string, ownerColumn: string, ownerAlias: string, param: string): string {
  return `NOT EXISTS (
            SELECT 1 FROM unnest(${param}::uuid[]) AS f(id)
             WHERE NOT EXISTS (
               SELECT 1 FROM ${joinTable} x
                WHERE x.${ownerColumn} = ${ownerAlias}.id
                  AND x.term_id IN (SELECT taxonomy_subtree(f.id))))`;
}

/** Texto de busqueda en espanol, sin tildes. `param` es el marcador del texto ($n). */
export function matchesText(alias: string, param: string): string {
  return `(${param}::text IS NULL OR ${alias}.search_vector @@ plainto_tsquery('spanish', immutable_unaccent(${param})))`;
}

/** Separa la columna `total` (count(*) OVER ()) del resto de cada fila. */
export function toPage<T>(rows: (T & { total: string | number })[], page: PageRequest): Page<T> {
  const total = rows.length > 0 ? Number(rows[0].total) : 0;
  const items = rows.map(({ total: _total, ...item }) => item as unknown as T);
  return { items, total, page: page.page, pageSize: page.pageSize };
}

export function offset(page: PageRequest): number {
  return (page.page - 1) * page.pageSize;
}
