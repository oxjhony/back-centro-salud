import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { CoursesService } from '../../../modules/courses/application/courses.service';
import { EditorialService } from '../../../modules/editorial/application/editorial.service';
import { USER_REPOSITORY, UserRepository } from '../../../modules/identity/application/ports';
import { SessionUser } from '../../../modules/identity/domain/permissions';
import { InitiativesService } from '../../../modules/initiatives/application/initiatives.service';
import { ResourcesService } from '../../../modules/resources/application/resources.service';
import { BULK_ACCOUNTS } from '../../identity/bulk-accounts';
import { createMigrationDataSource } from '../data-source';
import {
  AFFILIATIONS, ARCHIVE_PUBLISHED_COMMENTS, chance, courseSummary, createRandom, EXTRA_TAXONOMY, initiativeResults,
  initiativeSummary, initiativeTitle, int, LICENSES, MOODLE_COURSES, MUNICIPALITIES, pick, POPULATIONS, Random,
  REJECT_COMMENTS, resourceDescription, RETURN_COMMENTS, sample, sampleFile, SUBJECTS, TAGS, weighted,
} from './bulk-data';
import { seedTaxonomy, TAXONOMY } from './taxonomy-data';

/**
 * Semilla MASIVA para probar con volumen: decenas de cuentas legibles y ~150 contenidos en todos los
 * estados del flujo editorial, con su historia, sus avisos y su bitacora repartidos en el tiempo.
 *
 *   npm run seed:bulk                    # tamano base
 *   SEED_ESCALA=3 npm run seed:bulk      # el triple de contenidos
 *
 * Los contenidos se crean con los mismos casos de uso que usa la API (las reglas se cumplen) y luego
 * se les reparten las fechas hacia atras, para que listados, ordenes y paneles se vean reales.
 * Es reproducible (misma semilla de azar) y se puede repetir: lo que ya existe se omite.
 * Requiere PostgreSQL y, para que los enlaces de los cursos queden verificados, Moodle en marcha.
 */

const SEED = 20261008;
const SCALE = Math.max(1, Math.floor(Number(process.env.SEED_ESCALA ?? 1)) || 1);
const COUNTS = { resources: 60 * SCALE, initiatives: 50 * SCALE, courses: 26 * SCALE };

type Step = [SessionUser, string, string?];

/** Recorridos posibles de un contenido por el flujo editorial. */
type Plan =
  | 'DRAFT' | 'SUBMITTED' | 'IN_REVIEW' | 'APPROVED' | 'RETURNED' | 'PUBLISHED'
  | 'PUBLISHED_AFTER_RETURN' | 'ARCHIVED_PUBLISHED' | 'ARCHIVED_REJECTED' | 'REACTIVATED';

const PLANS: (readonly [Plan, number])[] = [
  ['PUBLISHED', 38], ['PUBLISHED_AFTER_RETURN', 8], ['DRAFT', 12], ['SUBMITTED', 10], ['IN_REVIEW', 9],
  ['APPROVED', 6], ['RETURNED', 8], ['ARCHIVED_PUBLISHED', 5], ['ARCHIVED_REJECTED', 3], ['REACTIVATED', 1],
];
const UNPUBLISHABLE_PLANS: (readonly [Plan, number])[] = [
  ['DRAFT', 4], ['SUBMITTED', 3], ['IN_REVIEW', 3], ['APPROVED', 2], ['RETURNED', 3], ['ARCHIVED_REJECTED', 1],
];

/** Tabla, columna de `editorial_reviews` y rango de antiguedad (dias) segun el estado final. */
const TARGETS = {
  initiatives: 'initiative_id',
  resources: 'resource_id',
  courses: 'course_id',
} as const;
type Target = keyof typeof TARGETS;

function ageRange(plan: Plan): [number, number] {
  switch (plan) {
    case 'DRAFT': return [1, 25];
    case 'SUBMITTED': case 'IN_REVIEW': case 'APPROVED': case 'RETURNED': return [2, 30];
    case 'ARCHIVED_PUBLISHED': case 'ARCHIVED_REJECTED': return [60, 300];
    case 'REACTIVATED': return [40, 200];
    default: return [15, 240];
  }
}

interface Team {
  authors: SessionUser[];
  managers: SessionUser[];
  reviewers: SessionUser[];
  admins: SessionUser[];
}

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);
const daysFromNow = (days: number): Date => new Date(Date.now() + days * 86_400_000);
const addMonths = (d: Date, months: number): Date => {
  const copy = new Date(d);
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
};

function stepsFor(plan: Plan, creator: SessionUser, team: Team, rng: Random): Step[] {
  const [r1, r2] = sample(rng, team.reviewers, 2);
  const admin = pick(rng, team.admins);
  const submit: Step = [creator, 'SUBMITTED'];
  const approved: Step[] = [submit, [r1, 'IN_REVIEW'], [r1, 'APPROVED']];
  const returned: Step[] = [submit, [r1, 'IN_REVIEW'], [r1, 'RETURNED', pick(rng, RETURN_COMMENTS)]];
  const rejected: Step[] = [submit, [r1, 'IN_REVIEW'], [r1, 'ARCHIVED', pick(rng, REJECT_COMMENTS)]];
  switch (plan) {
    case 'DRAFT': return [];
    case 'SUBMITTED': return [submit];
    case 'IN_REVIEW': return [submit, [r1, 'IN_REVIEW']];
    case 'APPROVED': return approved;
    case 'RETURNED': return returned;
    case 'PUBLISHED': return [...approved, [r2, 'PUBLISHED']];
    case 'PUBLISHED_AFTER_RETURN':
      return [...returned, submit, [r2, 'IN_REVIEW'], [r2, 'APPROVED'], [r1, 'PUBLISHED']];
    case 'ARCHIVED_PUBLISHED':
      return [...approved, [r2, 'PUBLISHED'], [admin, 'ARCHIVED', pick(rng, ARCHIVE_PUBLISHED_COMMENTS)]];
    case 'ARCHIVED_REJECTED': return rejected;
    case 'REACTIVATED': return [...rejected, [admin, 'DRAFT', 'Se reactiva para corregirla y reenviarla.']];
  }
}

/**
 * Reparte en el tiempo lo que acaba de crearse: el contenido nace hace `daysAgo` dias y cada paso
 * del flujo ocurre unas horas despues del anterior. Mueve juntos el contenido, su historial
 * editorial, los avisos y la bitacora, para que sigan contando la misma historia.
 */
async function spreadInTime(owner: DataSource, table: Target, id: string, daysAgo: number, stepHours: number, rng: Random) {
  const column = TARGETS[table];
  const createdAt = new Date(Date.now() - (daysAgo * 24 - rng() * 20) * 3_600_000).toISOString();

  await owner.query(
    `WITH rk AS (
       SELECT id, row_number() OVER (ORDER BY created_at, id) AS k
         FROM editorial_reviews WHERE ${column} = $1::uuid),
     rnew AS (
       SELECT id, k, LEAST(now(), $2::timestamptz + interval '12 hours' + (k * $3::int)::float8 * interval '1 hour') AS new_at
         FROM rk),
     ak AS (
       SELECT id, occurred_at AS old_at, row_number() OVER (ORDER BY occurred_at, id) AS k
         FROM audit_logs WHERE object_id = $1::uuid AND action = 'editorial.transition'),
     moved_reviews AS (
       UPDATE editorial_reviews er SET created_at = rnew.new_at FROM rnew WHERE er.id = rnew.id RETURNING er.id),
     moved_notifications AS (
       UPDATE notifications n SET created_at = rnew.new_at
         FROM ak JOIN rnew ON rnew.k = ak.k
        WHERE n.link LIKE '%/' || ($1::uuid)::text AND n.created_at = ak.old_at
       RETURNING n.id)
     UPDATE audit_logs a SET occurred_at = rnew.new_at FROM ak JOIN rnew ON rnew.k = ak.k WHERE a.id = ak.id`,
    [id, createdAt, stepHours],
  );
  await owner.query(
    `UPDATE ${table} SET
       created_at = $2::timestamptz,
       updated_at = coalesce((SELECT max(created_at) FROM editorial_reviews WHERE ${column} = $1::uuid), $2::timestamptz),
       published_at = CASE WHEN published_at IS NULL THEN NULL
                           ELSE coalesce((SELECT max(created_at) FROM editorial_reviews
                                           WHERE ${column} = $1::uuid AND to_status = 'PUBLISHED'), $2::timestamptz) END
     WHERE id = $1::uuid`,
    [id, createdAt],
  );
  await owner.query(`UPDATE audit_logs SET occurred_at = $2::timestamptz WHERE object_id = $1::uuid AND action LIKE '%.created'`, [id, createdAt]);
  await owner.query(`UPDATE integration_logs SET occurred_at = $2::timestamptz WHERE entity_id = $1::uuid`, [id, createdAt]);

  if (table === 'resources') {
    await owner.query(
      `UPDATE resource_versions SET created_at = $2::timestamptz + (version_number * interval '3 hours') WHERE resource_id = $1::uuid`,
      [id, createdAt],
    );
    await owner.query(
      `UPDATE audit_logs a SET occurred_at = v.created_at
         FROM (SELECT id, row_number() OVER (ORDER BY occurred_at, id) AS k
                 FROM audit_logs WHERE object_id = $1::uuid AND action = 'resource.version_added') ak
         JOIN resource_versions v ON v.resource_id = $1::uuid AND v.version_number = ak.k
        WHERE a.id = ak.id`,
      [id],
    );
  }
}

async function insertMany(owner: DataSource, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  const chunk = 400;
  for (let from = 0; from < rows.length; from += chunk) {
    const part = rows.slice(from, from + chunk);
    const placeholders = part.map((_, r) => `(${columns.map((__, c) => `$${r * columns.length + c + 1}`).join(', ')})`).join(', ');
    await owner.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`, part.flat());
  }
}

// --- 1. Cuentas -----------------------------------------------------------------------------------

async function seedAccounts(owner: DataSource): Promise<void> {
  const rng = createRandom(SEED);
  const themes = SUBJECTS.map(([, theme]) => theme).filter((t, i, all) => all.indexOf(t) === i);
  let created = 0;

  for (const account of BULK_ACCOUNTS) {
    const hasAffiliation = account.role !== 'REGISTERED' || chance(rng, 0.7);
    const [row] = await owner.query(
      `INSERT INTO users (external_subject_id, email, display_name, affiliation, general_territory, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() - ($7::int * interval '1 day'), now() - ($8::int * interval '1 day'))
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [
        account.subject,
        account.email,
        account.displayName,
        hasAffiliation ? pick(rng, AFFILIATIONS) : null,
        chance(rng, 0.8) ? pick(rng, MUNICIPALITIES) : null,
        account.status,
        int(rng, 250, 420),
        int(rng, 0, 120),
      ],
    );
    if (!row) continue;
    created++;
    await owner.query(`INSERT INTO user_profiles (user_id, interests, notification_opt_in) VALUES ($1, $2::text[], $3) ON CONFLICT (user_id) DO NOTHING`, [
      row.id,
      sample(rng, themes, int(rng, 0, 5)),
      chance(rng, 0.55),
    ]);
    await owner.query(
      `INSERT INTO role_assignments (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2 ON CONFLICT DO NOTHING`,
      [row.id, account.role],
    );
  }
  console.log(`  cuentas nuevas: ${created} de ${BULK_ACCOUNTS.length}`);
}

// --- 2. Contenido ---------------------------------------------------------------------------------

interface Context {
  app: INestApplicationContext;
  owner: DataSource;
  team: Team;
  termId: (name: string) => string;
  exists: (table: Target, title: string) => Promise<boolean>;
  run: (entity: Target, id: string, steps: Step[]) => Promise<void>;
}

/** Cada contenido toma su propio azar: si el volumen cambia, los anteriores no cambian. */
const itemRandom = (kind: number, index: number): Random => createRandom(SEED + kind * 100_000 + index);

async function seedResources({ app, owner, team, termId, exists, run }: Context): Promise<void> {
  const resources = app.get(ResourcesService);
  const formats: (readonly [string, number])[] = [
    ['Guía', 14], ['Infografía', 10], ['Informe técnico', 10], ['Presentación', 9], ['Conjunto de datos', 9],
    ['Protocolo', 6], ['Cartilla', 6], ['Boletín epidemiológico', 6], ['Póster', 4],
  ];
  let made = 0;
  let failed = 0;

  for (let i = 0; i < COUNTS.resources; i++) {
    const rng = itemRandom(1, i);
    const [subject, theme] = pick(rng, SUBJECTS);
    const municipality = pick(rng, MUNICIPALITIES);
    const format = weighted(rng, formats);
    const title = pick(rng, [`${format}: ${subject} en ${municipality}`, `${format} de ${subject} (${municipality})`, `${format} sobre ${subject}`]);
    const creator = pick(rng, [...team.authors, ...team.managers]);
    const versions = weighted(rng, [[1, 6], [2, 3], [3, 1]] as const);
    const plan = weighted(rng, PLANS);
    const terms = [theme, municipality, format, pick(rng, POPULATIONS), ...sample(rng, TAGS, int(rng, 0, 2))];
    const license = pick(rng, LICENSES);
    const visibility = chance(rng, 0.7) ? 'PUBLIC' : 'RESTRICTED';
    const description = resourceDescription(rng, format, subject, municipality);
    const [minDays, maxDays] = ageRange(plan);
    const daysAgo = int(rng, minDays, maxDays);
    const stepHours = int(rng, 8, 72);
    const steps = stepsFor(plan, creator, team, rng);
    const fileRng = itemRandom(2, i);

    if (await exists('resources', title)) continue;
    try {
      const { id } = await resources.create(creator, {
        title, description, license, visibility, termIds: terms.map(termId),
      });
      for (let v = 1; v <= versions; v++) {
        const file = sampleFile(fileRng, format, title, v, municipality);
        await resources.addVersion(creator, id, { originalname: file.name, size: file.bytes.length, buffer: file.bytes });
      }
      await run('resources', id, steps);
      await spreadInTime(owner, 'resources', id, daysAgo, stepHours, rng);
      made++;
    } catch (error) {
      failed++;
      console.warn(`  recurso omitido (${title}): ${(error as Error).message}`);
    }
  }
  console.log(`  recursos nuevos: ${made}${failed ? `, con error: ${failed}` : ''}`);
}

async function seedInitiatives({ app, owner, team, termId, exists, run }: Context): Promise<void> {
  const initiatives = app.get(InitiativesService);
  const published: string[] = (await owner.query(`SELECT id FROM resources WHERE editorial_status = 'PUBLISHED'`)).map((r: { id: string }) => r.id);
  const types = ['PROJECT', 'PROGRAM', 'RESEARCH', 'EXTENSION', 'TRAINING_PRACTICE', 'COMMUNITY_EXPERIENCE'];
  let made = 0;
  let failed = 0;

  for (let i = 0; i < COUNTS.initiatives; i++) {
    const rng = itemRandom(3, i);
    const type = types[i % types.length];
    const [subject, theme] = pick(rng, SUBJECTS);
    const [municipality, secondMunicipality] = sample(rng, MUNICIPALITIES, 2);
    const population = pick(rng, POPULATIONS);
    const title = initiativeTitle(rng, type, subject, municipality, population);
    const [creator, coauthor] = sample(rng, team.authors, 2);
    const plan = weighted(rng, PLANS);
    const startDate = new Date(Date.UTC(2024 + int(rng, 0, 2), int(rng, 0, 11), int(rng, 1, 28)));
    const endDate = chance(rng, 0.65) ? addMonths(startDate, int(rng, 3, 14)) : null;
    const finished = endDate !== null && endDate.getTime() < Date.now();
    const terms = [theme, municipality, ...(chance(rng, 0.3) ? [secondMunicipality] : []), population, ...sample(rng, TAGS, int(rng, 0, 2))];
    const summary = initiativeSummary(rng, type, subject, municipality, population);
    const results = finished && chance(rng, 0.8) ? initiativeResults(rng, subject) : null;
    const linked = sample(rng, published, int(rng, 0, 3));
    const [minDays, maxDays] = ageRange(plan);
    const daysAgo = int(rng, minDays, maxDays);
    const stepHours = int(rng, 8, 72);
    const steps = stepsFor(plan, creator, team, rng);
    const withCoauthor = chance(rng, 0.3);

    if (await exists('initiatives', title)) continue;
    try {
      const { id } = await initiatives.create(creator, {
        title, summary, type, startDate: dateOnly(startDate), endDate: endDate ? dateOnly(endDate) : null,
        results, termIds: terms.map(termId), resourceIds: linked,
      });
      if (withCoauthor) {
        await owner.query(`INSERT INTO initiative_authors (initiative_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, coauthor.id]);
      }
      await run('initiatives', id, steps);
      await spreadInTime(owner, 'initiatives', id, daysAgo, stepHours, rng);
      made++;
    } catch (error) {
      failed++;
      console.warn(`  iniciativa omitida (${title}): ${(error as Error).message}`);
    }
  }
  console.log(`  iniciativas nuevas: ${made}${failed ? `, con error: ${failed}` : ''}`);
}

const ACCESS_BY_MODALITY: Record<string, string> = {
  VIRTUAL: 'Ingresa a Moodle con tu cuenta institucional y busca el curso por su nombre.',
  IN_PERSON: 'Inscripción presencial en la sede indicada; escribe a formacion@cvsp.local.',
  HYBRID: 'Inscríbete escribiendo a formacion@cvsp.local; las sesiones virtuales se habilitan en Moodle.',
  SELF_PACED: 'Solicita tu matrícula en la plataforma y estudia a tu ritmo.',
};

async function seedCourses({ app, owner, team, termId, exists, run }: Context): Promise<void> {
  const courses = app.get(CoursesService);
  const publishedInitiatives: string[] = (await owner.query(`SELECT id FROM initiatives WHERE editorial_status = 'PUBLISHED'`)).map((r: { id: string }) => r.id);
  const publishedResources: string[] = (await owner.query(`SELECT id FROM resources WHERE editorial_status = 'PUBLISHED'`)).map((r: { id: string }) => r.id);
  const modalities = ['VIRTUAL', 'IN_PERSON', 'HYBRID', 'SELF_PACED'];
  const requirementsPool = [null, 'Ninguno.', 'Conexión estable a internet.', 'Vinculación con una secretaría de salud.', 'Haber cursado el curso básico de salud.'];
  let made = 0;
  let failed = 0;

  // Los primeros cursos apuntan a aulas reales de Moodle; dos apuntan a aulas que no existen (enlace
  // en error) y una queda huerfana: asi los paneles de integracion tienen casos que mostrar.
  const total = MOODLE_COURSES.length + COUNTS.courses;
  for (let i = 0; i < total; i++) {
    const rng = itemRandom(4, i);
    const moodle = i < MOODLE_COURSES.length ? MOODLE_COURSES[i] : null;
    const generated = i - MOODLE_COURSES.length;
    const [subject, themeOfSubject] = pick(rng, SUBJECTS);
    const population = pick(rng, POPULATIONS);
    const kind = pick(rng, [['Curso', 'COURSE'], ['Microcurso', 'MICROCOURSE'], ['Diplomado', 'DIPLOMA'], ['Taller', 'MICROCOURSE']] as const);
    const title = moodle?.title ?? (kind[0] === 'Diplomado' ? `Diplomado en ${subject} y salud pública` : kind[0] === 'Taller' ? `Taller de ${subject} para ${population.toLowerCase()}` : `${kind[0]} de ${subject}`);
    const type = moodle ? (i % 3 === 0 ? 'COURSE' : 'MICROCOURSE') : kind[1];
    const modality = moodle ? 'VIRTUAL' : pick(rng, modalities);
    const idnumber = moodle ? moodle.idnumber : generated === 0 ? 'cvsp-sin-aula-1' : generated === 1 ? 'cvsp-sin-aula-2' : generated === 2 ? 'cvsp-aula-eliminada' : null;
    const withoutAccess = !moodle && idnumber === null && chance(rng, 0.15);
    const plan = moodle
      ? ((i < 7 ? 'PUBLISHED' : i === 7 ? 'IN_REVIEW' : 'DRAFT') as Plan)
      : weighted(rng, withoutAccess ? UNPUBLISHABLE_PLANS : PLANS);
    const creator = pick(rng, team.managers);
    const duration = type === 'DIPLOMA' ? `${int(rng, 100, 160)} horas` : type === 'COURSE' ? `${int(rng, 30, 60)} horas` : `${int(rng, 8, 16)} horas`;
    const startDate = chance(rng, 0.75) ? new Date(Date.UTC(2026, int(rng, 5, 12), int(rng, 1, 28))) : null;
    const endDate = startDate ? addMonths(startDate, int(rng, 1, 5)) : null;
    const terms = [moodle?.theme ?? themeOfSubject, population, ...sample(rng, TAGS, int(rng, 0, 2))];
    const [minDays, maxDays] = ageRange(plan);
    const daysAgo = int(rng, minDays, maxDays);
    const stepHours = int(rng, 8, 72);
    const steps = stepsFor(plan, creator, team, rng);
    const summary = moodle?.summary ?? courseSummary(rng, subject, population);
    const initiativeIds = sample(rng, publishedInitiatives, int(rng, 0, 2));
    const resourceIds = sample(rng, publishedResources, int(rng, 0, 3));

    if (await exists('courses', title)) continue;
    try {
      const course = await courses.create(
        creator,
        {
          title, summary, type, modality, duration,
          startDate: startDate ? dateOnly(startDate) : null,
          endDate: endDate ? dateOnly(endDate) : null,
          capacity: chance(rng, 0.8) ? int(rng, 20, 120) : null,
          requirements: pick(rng, requirementsPool),
          accessInstructions: withoutAccess ? null : ACCESS_BY_MODALITY[modality],
          termIds: terms.map(termId),
          initiativeIds,
          resourceIds,
        },
        idnumber,
      );
      await run('courses', course.id, steps);
      if (idnumber === 'cvsp-aula-eliminada') {
        await owner.query(`UPDATE courses SET lms_link_status = 'ORPHAN', lms_link_error = 'curso_no_encontrado' WHERE id = $1`, [course.id]);
      }
      await spreadInTime(owner, 'courses', course.id, daysAgo, stepHours, rng);
      made++;
    } catch (error) {
      failed++;
      console.warn(`  curso omitido (${title}): ${(error as Error).message}`);
    }
  }
  console.log(`  cursos nuevos: ${made}${failed ? `, con error: ${failed}` : ''}`);
}

// --- 3. Actividad ---------------------------------------------------------------------------------

/** Ingresos, intentos fallidos, cambios de perfil, avisos y llamadas a sistemas externos. */
async function seedActivity(owner: DataSource): Promise<void> {
  if ((await owner.query(`SELECT 1 FROM audit_logs WHERE source = 'seed' LIMIT 1`)).length > 0) {
    console.log('  actividad: ya estaba cargada');
    return;
  }
  const rng = createRandom(SEED + 900_000);
  const ago = (maxDays: number): string => new Date(Date.now() - rng() * maxDays * 86_400_000).toISOString();
  const bulk: { id: string; email: string; status: string; role: string }[] = await owner.query(
    `SELECT id, email, status, (SELECT r.name FROM role_assignments ra JOIN roles r ON r.id = ra.role_id WHERE ra.user_id = u.id LIMIT 1) AS role
       FROM users u WHERE u.email = ANY($1::text[])`,
    [BULK_ACCOUNTS.map((a) => a.email)],
  );
  const active = bulk.filter((u) => u.status === 'ACTIVE');
  const inactive = bulk.filter((u) => u.status !== 'ACTIVE');
  const [admin] = bulk.filter((u) => u.role === 'FUNCTIONAL_ADMIN');

  const audit: unknown[][] = [];
  const addAudit = (actor: string | null, action: string, objectId: string | null, at: string, detail?: object) =>
    audit.push([actor, action, objectId ? 'users' : null, objectId, at, 'seed', detail ? JSON.stringify(detail) : null]);

  for (const user of active) {
    for (let n = int(rng, 1, 9); n > 0; n--) addAudit(user.id, 'auth.login', user.id, ago(45));
    if (chance(rng, 0.4)) addAudit(user.id, 'profile.updated', user.id, ago(60), { fields: sample(rng, ['displayName', 'affiliation', 'generalTerritory', 'interests', 'notificationOptIn'], int(rng, 1, 3)) });
  }
  for (let n = 0; n < 25; n++) addAudit(null, 'auth.login_failed', null, ago(45));
  for (const user of inactive) for (let n = int(rng, 1, 3); n > 0; n--) addAudit(user.id, 'auth.login_denied', user.id, ago(30));
  if (admin) {
    for (const user of bulk.filter((u) => u.role !== 'REGISTERED')) addAudit(admin.id, 'user.roles_assigned', user.id, ago(200), { before: ['REGISTERED'], after: [user.role] });
    for (const user of inactive) addAudit(admin.id, 'user.status_changed', user.id, ago(90), { before: 'ACTIVE', after: user.status });
  }
  await insertMany(owner, 'audit_logs', ['actor_id', 'action', 'object_type', 'object_id', 'occurred_at', 'source', 'minimal_detail'], audit);
  await owner.query(
    `UPDATE users u SET last_login_at = l.last_at
       FROM (SELECT actor_id, max(occurred_at) AS last_at FROM audit_logs WHERE action = 'auth.login' AND source = 'seed' GROUP BY actor_id) l
      WHERE u.id = l.actor_id`,
  );

  const notifications: unknown[][] = [];
  const welcome = ['Bienvenida al Centro Virtual de Salud Pública', 'Completa tu perfil para recibir contenidos de tu interés', 'Nueva convocatoria de cursos abierta'];
  for (const user of active) {
    for (let n = int(rng, 1, 4); n > 0; n--) {
      const at = ago(40);
      const type = pick(rng, ['SYSTEM', 'SYSTEM', 'CONTENT_PUBLISHED', 'CONSULTATION_OPEN']);
      notifications.push([
        type, user.id, type === 'CONTENT_PUBLISHED' ? 'Se publicó un nuevo recurso de tu interés' : type === 'CONSULTATION_OPEN' ? 'Hay una consulta abierta para tu territorio' : pick(rng, welcome),
        'Revisa la plataforma para conocer los detalles.', null, at, 'SENT', chance(rng, 0.5) ? at : null,
      ]);
    }
  }
  await insertMany(owner, 'notifications', ['type', 'recipient_id', 'title', 'message', 'link', 'created_at', 'delivery_status', 'read_at'], notifications);

  // Marca como leidos buena parte de los avisos editoriales, para que no todos aparezcan sin leer.
  await owner.query(`UPDATE notifications SET read_at = created_at + interval '2 hours' WHERE read_at IS NULL AND type IN ('EDITORIAL_TRANSITION', 'CONTENT_PUBLISHED') AND random() < 0.55`);

  const courseIds: string[] = (await owner.query(`SELECT id FROM courses`)).map((r: { id: string }) => r.id);
  const integrations: unknown[][] = [];
  for (let n = 0; n < 160; n++) {
    const at = ago(30);
    const roll = rng();
    const status = roll < 0.88 ? 'OK' : roll < 0.95 ? 'ERROR' : 'TIMEOUT';
    integrations.push([
      'moodle', pick(rng, ['core_course_get_courses_by_field', 'core_course_get_courses_by_field', 'core_course_get_courses']), status,
      status === 'OK' ? 200 : status === 'ERROR' ? pick(rng, [500, 503]) : null,
      status === 'OK' ? null : status === 'ERROR' ? 'moodle_error' : 'timeout',
      status === 'OK' ? null : status === 'ERROR' ? 'Moodle respondió con un error interno.' : 'Moodle no respondió a tiempo.',
      'courses', courseIds.length ? pick(rng, courseIds) : null, `seed-${n}`, status === 'TIMEOUT' ? 5000 : int(rng, 70, 900), at,
    ]);
  }
  for (let n = 0; n < 40; n++) {
    const roll = rng();
    integrations.push([
      pick(rng, ['smtp', 'oidc', 'object_storage']), pick(rng, ['send_notification', 'validate_token', 'put_object']), roll < 0.93 ? 'OK' : 'ERROR',
      null, roll < 0.93 ? null : 'servicio_no_disponible', roll < 0.93 ? null : 'El servicio no respondió.', null, null, `seed-ext-${n}`, int(rng, 20, 600), ago(30),
    ]);
  }
  await insertMany(
    owner, 'integration_logs',
    ['integration', 'operation', 'status', 'http_status', 'error_code', 'message', 'entity_type', 'entity_id', 'correlation_id', 'duration_ms', 'occurred_at'],
    integrations,
  );
  console.log(`  actividad: ${audit.length} registros de auditoría, ${notifications.length} avisos, ${integrations.length} llamadas a integraciones`);
}

// --- Principal ------------------------------------------------------------------------------------

function printAccounts(): void {
  console.log('\nCuentas (contraseña: LOCAL_IDENTITY_PASSWORD de back-centro-salud/.env):');
  const byGroup = new Map<string, string[]>();
  for (const { role, status, email } of BULK_ACCOUNTS) {
    const group = status === 'ACTIVE' ? role : `${role} (${status})`;
    byGroup.set(group, [...(byGroup.get(group) ?? []), email]);
  }
  for (const [group, emails] of byGroup) {
    console.log(`  ${group.padEnd(28)} ${emails.slice(0, 3).join('  ')}${emails.length > 3 ? `  ... (${emails.length} en total)` : ''}`);
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('La semilla masiva solo se ejecuta en desarrollo.');
  }
  const owner = await createMigrationDataSource().initialize();
  let app: INestApplicationContext | undefined;
  try {
    console.log(`Semilla masiva (escala ${SCALE})...`);
    console.log('Taxonomía ampliada...');
    await seedTaxonomy(owner, TAXONOMY);
    await seedTaxonomy(owner, EXTRA_TAXONOMY);

    console.log('Cuentas...');
    await seedAccounts(owner);

    app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
    const users = app.get<UserRepository>(USER_REPOSITORY);
    const editorial = app.get(EditorialService);

    const sessionOf = async (role: string): Promise<SessionUser[]> => {
      const accounts = BULK_ACCOUNTS.filter((a) => a.role === role && a.status === 'ACTIVE');
      return Promise.all(accounts.map(async (a) => users.findSessionUser((await users.findBySubject(a.subject)).id)));
    };
    const team: Team = {
      authors: await sessionOf('AUTHOR'),
      managers: await sessionOf('ACADEMIC_MANAGER'),
      reviewers: await sessionOf('REVIEWER'),
      admins: await sessionOf('FUNCTIONAL_ADMIN'),
    };

    const terms = new Map<string, string>(
      (await owner.query(`SELECT name, id FROM taxonomy_terms ORDER BY created_at DESC`)).map((r: { name: string; id: string }) => [r.name, r.id]),
    );
    const context: Context = {
      app,
      owner,
      team,
      termId: (name) => {
        const id = terms.get(name);
        if (!id) throw new Error(`No existe el término de taxonomía "${name}".`);
        return id;
      },
      exists: async (table, title) => (await owner.query(`SELECT 1 FROM ${table} WHERE title = $1`, [title])).length > 0,
      run: async (entity, id, steps) => {
        for (const [who, to, comment] of steps) await editorial.transition(who, entity, id, to, comment);
      },
    };

    console.log('Recursos...');
    await seedResources(context);
    console.log('Iniciativas...');
    await seedInitiatives(context);
    console.log('Cursos...');
    await seedCourses(context);
    console.log('Actividad...');
    await seedActivity(owner);

    printAccounts();
    console.log('\nSemilla masiva aplicada.');
  } finally {
    await app?.close();
    await owner.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
