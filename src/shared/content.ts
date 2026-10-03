/** Otro contenido asociado (iniciativa, recurso o curso), con su estado editorial. */
export interface RelatedContent {
  id: string;
  title: string;
  state: string;
}

/** Contenido asociado tal como lo ve el visitante. */
export interface PublicRef {
  id: string;
  title: string;
}

/** En una ficha publica solo se enlaza lo que tambien esta publicado. */
export function publicRefs(items: RelatedContent[]): PublicRef[] {
  return items.filter((item) => item.state === 'PUBLISHED').map(({ id, title }) => ({ id, title }));
}
