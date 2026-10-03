import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { rm } from 'node:fs/promises';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { DevAccount } from '../../src/infrastructure/identity/dev-accounts';
import { LocalIdentityProvider } from '../../src/infrastructure/identity/local-identity.provider';
import { FakeMoodleGateway } from '../../src/infrastructure/moodle/fake-moodle.gateway';
import { MOODLE_GATEWAY } from '../../src/modules/courses/application/ports';
import { IDENTITY_PROVIDER } from '../../src/modules/identity/application/ports';

export const PASSWORD = 'clave-de-prueba';

/**
 * Una cuenta por rol, mas un segundo autor y una cuenta con dos roles para comprobar que nadie
 * aprueba su propio contenido.
 */
const ACCOUNTS = {
  usuario: { roles: ['REGISTERED'], displayName: 'Úrsula Usuario' },
  autor: { roles: ['AUTHOR'], displayName: 'Andrea Autora' },
  autor2: { roles: ['AUTHOR'], displayName: 'Camilo Coautor' },
  revisor: { roles: ['REVIEWER'], displayName: 'Ramiro Revisor' },
  gestor: { roles: ['ACADEMIC_MANAGER'], displayName: 'Gloria Gestora' },
  admin: { roles: ['FUNCTIONAL_ADMIN'], displayName: 'Fabiola Funcional' },
  tecnico: { roles: ['TECHNICAL_ADMIN'], displayName: 'Tomás Técnico' },
  autorRevisor: { roles: ['AUTHOR', 'REVIEWER'], displayName: 'Dora Doble' },
} as const;

export type Account = keyof typeof ACCOUNTS;
/** Las filas de la matriz de permisos: los seis roles con sesion (el visitante se agrega aparte). */
export const ROLE_ACCOUNTS: Account[] = ['usuario', 'autor', 'revisor', 'gestor', 'admin', 'tecnico'];

const emailOf = (account: Account) => `${account.toLowerCase()}@prueba.local`;

export type Session = ReturnType<typeof request.agent>;

export interface Catalog {
  themeA: string;
  themeB: string;
  /** Departamento, padre de territoryA. */
  territoryParent: string;
  territoryA: string;
  populationA: string;
  resourceTypeA: string;
}

export interface Harness {
  app: INestApplication;
  /** Doble del LMS: permite simular cursos, duplicados y caidas. */
  moodle: FakeMoodleGateway;
  /** Conexion del rol propietario, para preparar datos y verificar lo que quedo en la base. */
  owner: DataSource;
  /** Peticiones sin sesion (visitante). */
  visitor(): Session;
  /** Peticiones con la sesion de la cuenta indicada. */
  as(account: Account): Promise<Session>;
  userId(account: Account): string;
  catalog: Catalog;
  /** Pone un contenido en un estado sin recorrer el flujo: solo para preparar escenarios. */
  forceState(table: 'initiatives' | 'resources' | 'courses', id: string, state: string): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const moodle = new FakeMoodleGateway();
  const identities: DevAccount[] = (Object.keys(ACCOUNTS) as Account[]).map((account) => ({
    subject: `prueba-${account}`,
    email: emailOf(account),
    displayName: ACCOUNTS[account].displayName,
    role: ACCOUNTS[account].roles[0],
  }));

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MOODLE_GATEWAY)
    .useValue(moodle)
    .overrideProvider(IDENTITY_PROVIDER)
    .useValue(new LocalIdentityProvider(identities, PASSWORD))
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();

  const owner = await new DataSource({ type: 'postgres', url: process.env.DATABASE_MIGRATION_URL }).initialize();

  // Datos limpios en cada archivo de pruebas. Roles, permisos y transiciones no se tocan:
  // son datos de referencia que crean las migraciones.
  await owner.query(`TRUNCATE users, taxonomy_terms, audit_logs, integration_logs CASCADE`);

  const userIds = {} as Record<Account, string>;
  for (const account of Object.keys(ACCOUNTS) as Account[]) {
    const [{ id }] = await owner.query(
      `INSERT INTO users (external_subject_id, email, display_name) VALUES ($1, $2, $3) RETURNING id`,
      [`prueba-${account}`, emailOf(account), ACCOUNTS[account].displayName],
    );
    userIds[account] = id;
    await owner.query(`INSERT INTO user_profiles (user_id) VALUES ($1)`, [id]);
    await owner.query(
      `INSERT INTO role_assignments (user_id, role_id) SELECT $1, id FROM roles WHERE name = ANY($2::varchar[])`,
      [id, ACCOUNTS[account].roles],
    );
  }

  const term = async (type: string, name: string, parentId: string | null = null): Promise<string> =>
    (await owner.query(`INSERT INTO taxonomy_terms (type, name, parent_id) VALUES ($1, $2, $3) RETURNING id`, [type, name, parentId]))[0]
      .id;
  const territoryParent = await term('TERRITORY', 'Caldas');
  const catalog: Catalog = {
    themeA: await term('THEME', 'Atención primaria en salud'),
    themeB: await term('THEME', 'Salud mental comunitaria'),
    territoryParent,
    territoryA: await term('TERRITORY', 'Manizales', territoryParent),
    populationA: await term('POPULATION', 'Líderes comunitarios'),
    resourceTypeA: await term('RESOURCE_TYPE', 'Guía'),
  };

  const sessions = new Map<Account, Session>();

  return {
    app,
    moodle,
    owner,
    catalog,
    visitor: () => request.agent(app.getHttpServer()),
    userId: (account) => userIds[account],
    async as(account) {
      if (!sessions.has(account)) {
        const agent = request.agent(app.getHttpServer());
        await agent.post('/auth/login').send({ email: emailOf(account), password: PASSWORD }).expect(200);
        sessions.set(account, agent);
      }
      return sessions.get(account);
    },
    async forceState(table, id, state) {
      await owner.query(
        `UPDATE ${table}
            SET editorial_status = $2::varchar,
                published_at = CASE WHEN $2::varchar = 'PUBLISHED' THEN coalesce(published_at, now()) ELSE published_at END
          WHERE id = $1`,
        [id, state],
      );
    },
    async close() {
      await owner.destroy();
      await app.close();
      await rm(process.env.STORAGE_DIR, { recursive: true, force: true });
    },
  };
}

export const emailFor = emailOf;

/** Cuerpo valido de una iniciativa; cada prueba sobrescribe lo que le interesa. */
export function initiativeBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Red de vigilancia comunitaria',
    summary: 'Líderes comunitarios reportan eventos de interés en salud pública.',
    type: 'RESEARCH',
    ...overrides,
  };
}

/** Cuerpo valido de una ficha de curso. */
export function courseBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Curso básico de salud',
    summary: 'Introducción a la atención primaria en salud.',
    type: 'COURSE',
    modality: 'VIRTUAL',
    ...overrides,
  };
}

/** Cuerpo valido de un recurso. */
export function resourceBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Guía de vigilancia comunitaria',
    description: 'Paso a paso para reportar eventos de interés en salud pública.',
    license: 'CC BY 4.0',
    visibility: 'PUBLIC',
    ...overrides,
  };
}

/** Un PDF minimo: basta con que empiece con la firma %PDF-. */
export const PDF = Buffer.from('%PDF-1.4\n% documento de prueba\n%%EOF\n');

/** Crea un recurso con un archivo y lo deja en borrador; devuelve su id. */
export async function draftResource(session: Session, overrides: Record<string, unknown> = {}): Promise<string> {
  const id = (await session.post('/resources').send(resourceBody(overrides)).expect(201)).body.id;
  await session.post(`/resources/${id}/versions`).attach('file', PDF, 'guia.pdf').expect(201);
  return id;
}
