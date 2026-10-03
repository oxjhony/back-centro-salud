import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';
import { MIGRATIONS } from '../../src/infrastructure/database/migrations';

/**
 * Antes de toda la corrida: reconstruye el esquema de la base de pruebas con las migraciones.
 *
 * De paso comprueba que cada migracion es reversible (Plan de pruebas 5.4): las aplica, las
 * revierte todas y las vuelve a aplicar. Si un `down` esta roto, falla la corrida completa.
 */
export default async function globalSetup(): Promise<void> {
  loadDotenv({ quiet: true });
  const url = process.env.DATABASE_TEST_MIGRATION_URL;
  if (!url) throw new Error('Falta DATABASE_TEST_MIGRATION_URL en .env.');
  if (!/_test(\?|$)/.test(url)) {
    throw new Error('DATABASE_TEST_MIGRATION_URL debe apuntar a una base terminada en _test: las pruebas la vacían.');
  }

  const owner = await new DataSource({ type: 'postgres', url, migrations: MIGRATIONS }).initialize();
  try {
    await owner.query(`DROP SCHEMA public CASCADE`);
    await owner.query(`CREATE SCHEMA public`);

    await owner.runMigrations();
    for (let i = 0; i < MIGRATIONS.length; i++) {
      await owner.undoLastMigration();
    }
    const leftovers = await owner.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'`,
    );
    if (leftovers.length > 0) {
      throw new Error(`Revertir las migraciones dejó tablas: ${leftovers.map((t) => t.tablename).join(', ')}`);
    }
    await owner.runMigrations();
  } finally {
    await owner.destroy();
  }
}
