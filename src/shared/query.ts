/** Lectura tolerante de parametros de consulta: un filtro invalido se ignora, no rompe la busqueda. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filtros por termino de la taxonomia, uno por tipo. Todos los indicados deben cumplirse. */
const TERM_PARAMS = ['themeId', 'territoryId', 'populationId', 'resourceTypeId', 'tagId'];

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function termIdsFrom(query: Record<string, unknown>): string[] {
  return TERM_PARAMS.map((param) => query[param]).filter(isUuid);
}

export function textFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}
