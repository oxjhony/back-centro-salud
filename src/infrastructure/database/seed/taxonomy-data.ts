import { DataSource } from 'typeorm';

/** Terminos por tipo. Un arreglo de hijos crea la jerarquia (departamento > municipios). */
export type TaxonomySeed = Record<string, (string | [string, string[]])[]>;

export const TAXONOMY: TaxonomySeed = {
  THEME: [
    'Atención primaria en salud',
    'Promoción de la salud',
    'Salud ambiental',
    'Salud mental comunitaria',
    'Seguridad alimentaria y nutricional',
    'Vigilancia epidemiológica',
  ],
  TERRITORY: [['Caldas', ['Chinchiná', 'La Dorada', 'Manizales', 'Riosucio', 'Villamaría']]],
  POPULATION: ['Docentes', 'Estudiantes de pregrado', 'Gestores territoriales', 'Líderes comunitarios', 'Personal de salud'],
  RESOURCE_TYPE: ['Conjunto de datos', 'Guía', 'Infografía', 'Informe técnico', 'Presentación'],
  TAG: ['Comunidad', 'Ruralidad', 'Datos abiertos'],
};

async function upsertTerm(owner: DataSource, type: string, name: string, parentId: string | null): Promise<string> {
  await owner.query(
    `INSERT INTO taxonomy_terms (type, name, parent_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [type, name, parentId],
  );
  const [{ id }] = await owner.query(
    `SELECT id FROM taxonomy_terms WHERE type = $1 AND name = $2 AND parent_id IS NOT DISTINCT FROM $3`,
    [type, name, parentId],
  );
  return id;
}

/** Inserta los terminos que falten; los que ya existen se dejan como estan. */
export async function seedTaxonomy(owner: DataSource, taxonomy: TaxonomySeed): Promise<void> {
  for (const [type, entries] of Object.entries(taxonomy)) {
    for (const entry of entries) {
      const [name, children] = typeof entry === 'string' ? [entry, []] : entry;
      const parentId = await upsertTerm(owner, type, name, null);
      for (const child of children) await upsertTerm(owner, type, child, parentId);
    }
  }
}
