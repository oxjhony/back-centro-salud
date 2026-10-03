import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

loadDotenv({ quiet: true });

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  port: number;
  production: boolean;
  databaseUrl: string;
  frontendOrigins: string[];
  session: { secret: string; ttlSeconds: number };
  identity: { provider: 'local'; localPassword: string };
  moodle: { baseUrl: string; token: string; timeoutMs: number };
  /** Archivos de los recursos. En desarrollo, una carpeta local; en produccion, almacenamiento de objetos. */
  storage: { dir: string; maxUploadBytes: number };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}. Revisa el archivo .env (ver .env.example).`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const provider = env.IDENTITY_PROVIDER?.trim() || 'local';
  if (provider !== 'local') {
    throw new Error(`IDENTITY_PROVIDER="${provider}" no tiene adaptador. Disponible: local.`);
  }

  return {
    port: Number(env.PORT) || 3000,
    production: env.NODE_ENV === 'production',
    databaseUrl: required(env, 'DATABASE_URL'),
    frontendOrigins: (env.FRONTEND_ORIGIN || 'http://localhost:4200').split(',').map((o) => o.trim()),
    session: {
      secret: required(env, 'SESSION_SECRET'),
      ttlSeconds: (Number(env.SESSION_TTL_HOURS) || 8) * 3600,
    },
    identity: { provider, localPassword: env.LOCAL_IDENTITY_PASSWORD ?? '' },
    moodle: {
      baseUrl: (env.MOODLE_BASE_URL || 'http://127.0.0.1:8090').replace(/\/+$/, ''),
      token: env.MOODLE_WS_TOKEN ?? '',
      timeoutMs: Number(env.MOODLE_TIMEOUT_MS) || 5000,
    },
    storage: {
      dir: resolve(env.STORAGE_DIR?.trim() || 'storage'),
      maxUploadBytes: Math.floor((Number(env.RESOURCE_MAX_MB) || 20) * 1024 * 1024),
    },
  };
}
