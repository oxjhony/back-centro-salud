import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';
import { MIGRATIONS } from './migrations';

loadDotenv({ quiet: true });

/**
 * Conexion del rol propietario, usada solo por la CLI de migraciones y por la semilla.
 * La aplicacion se conecta con otro rol, de privilegios reducidos (ver database.module.ts).
 */
export function createMigrationDataSource(url = process.env.DATABASE_MIGRATION_URL): DataSource {
  if (!url) {
    throw new Error('Falta DATABASE_MIGRATION_URL (conexion del rol propietario del esquema).');
  }
  return new DataSource({ type: 'postgres', url, migrations: MIGRATIONS, synchronize: false });
}

export default createMigrationDataSource();
