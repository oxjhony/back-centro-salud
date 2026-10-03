import { config as loadDotenv } from 'dotenv';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Entorno de las pruebas de extremo a extremo. Se ejecuta antes de cargar la aplicacion.
 * Las pruebas usan su propia base (cvsp_test): nunca tocan la de desarrollo.
 */
loadDotenv({ quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en .env: las pruebas e2e necesitan la base de pruebas.`);
  return value;
}

process.env.DATABASE_URL = required('DATABASE_TEST_URL');
process.env.DATABASE_MIGRATION_URL = required('DATABASE_TEST_MIGRATION_URL');
process.env.SESSION_SECRET = 'secreto-solo-para-pruebas';
process.env.NODE_ENV = 'test';
// Si una prueba olvidara sustituir el adaptador de Moodle, fallaria contra esta direccion
// inexistente en lugar de llamar al Moodle real.
process.env.MOODLE_BASE_URL = 'http://127.0.0.1:9';
process.env.MOODLE_WS_TOKEN = 'token-de-prueba';
// Los archivos de las pruebas van a una carpeta temporal, y el tope es pequeno para probar el rechazo.
process.env.STORAGE_DIR = join(tmpdir(), `cvsp-e2e-storage-${process.pid}`);
process.env.RESOURCE_MAX_MB = '0.05';
