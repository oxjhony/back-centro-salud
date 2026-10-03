import { MigrationInterface, QueryRunner } from 'typeorm';
import { APP_ROLE } from './app-role';
import { ENUMS, inList } from './sql';

/**
 * TaxonomyTerm: temas, territorios, poblaciones, tipos de recurso y etiquetas en una sola tabla,
 * administrable sin cambiar codigo (RF-15). Es jerarquica, como las categorias de Moodle:
 * un municipio cuelga de su departamento.
 */
export class Taxonomia1791000000002 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE taxonomy_terms (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type       varchar(30)  NOT NULL,
        name       varchar(150) NOT NULL,
        parent_id  uuid,
        active     boolean      NOT NULL DEFAULT true,
        created_at timestamptz  NOT NULL DEFAULT now(),
        updated_at timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT ck_taxonomy_type CHECK (type IN (${inList(ENUMS.taxonomyType)})),
        CONSTRAINT ck_taxonomy_name CHECK (length(trim(name)) > 0),
        CONSTRAINT ck_taxonomy_parent CHECK (parent_id IS NULL OR parent_id <> id),
        CONSTRAINT uq_taxonomy_id_type UNIQUE (id, type),
        -- El padre es del mismo tipo: un municipio no cuelga de un tema.
        CONSTRAINT fk_taxonomy_parent FOREIGN KEY (parent_id, type) REFERENCES taxonomy_terms (id, type)
      )`);
    // Duplicados (RF-15): mismo tipo, mismo padre y mismo nombre sin importar tildes ni mayusculas.
    await q.query(`
      CREATE UNIQUE INDEX uq_taxonomy_terms_name ON taxonomy_terms
        (type, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(immutable_unaccent(name)))`);
    await q.query(`CREATE INDEX ix_taxonomy_terms_type ON taxonomy_terms (type, active)`);
    await q.query(`CREATE INDEX ix_taxonomy_terms_parent ON taxonomy_terms (parent_id) WHERE parent_id IS NOT NULL`);

    // Un termino y todos sus descendientes: filtrar por "Caldas" encuentra lo clasificado en sus municipios.
    await q.query(`
      CREATE FUNCTION taxonomy_subtree(root uuid) RETURNS SETOF uuid
      LANGUAGE sql STABLE PARALLEL SAFE
      AS $$
        WITH RECURSIVE tree AS (
          SELECT id FROM taxonomy_terms WHERE id = root
          UNION
          SELECT t.id FROM taxonomy_terms t JOIN tree ON t.parent_id = tree.id
        )
        SELECT id FROM tree
      $$`);

    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON taxonomy_terms TO ${APP_ROLE}`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP FUNCTION taxonomy_subtree(uuid)`);
    await q.query(`DROP TABLE taxonomy_terms`);
  }
}
