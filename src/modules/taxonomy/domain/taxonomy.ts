/** Enumeracion TaxonomyType del modelo de datos. */
export const TAXONOMY_TYPES = ['THEME', 'TERRITORY', 'POPULATION', 'RESOURCE_TYPE', 'TAG'] as const;
export type TaxonomyType = (typeof TAXONOMY_TYPES)[number];

/** Como se muestra un termino dentro de un contenido. */
export interface TermRef {
  id: string;
  name: string;
  type: TaxonomyType;
}

export interface Term extends TermRef {
  parentId: string | null;
  active: boolean;
}

/** Vista de administracion: cuantos contenidos lo usan, para decidir si se puede borrar (RF-15). */
export interface TermAdmin extends Term {
  usage: number;
  children: number;
  updatedAt: string;
}

export interface TermData {
  name: string;
  parentId: string | null;
  active: boolean;
}
