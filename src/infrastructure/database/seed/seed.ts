import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { CoursesService } from '../../../modules/courses/application/courses.service';
import { CourseData } from '../../../modules/courses/domain/course';
import { EditorialService } from '../../../modules/editorial/application/editorial.service';
import { USER_REPOSITORY, UserRepository } from '../../../modules/identity/application/ports';
import { SessionUser } from '../../../modules/identity/domain/permissions';
import { InitiativesService } from '../../../modules/initiatives/application/initiatives.service';
import { InitiativeData } from '../../../modules/initiatives/domain/initiative';
import { ResourcesService } from '../../../modules/resources/application/resources.service';
import { ResourceData } from '../../../modules/resources/domain/resource';
import { DEV_ACCOUNTS } from '../../identity/dev-accounts';
import { createMigrationDataSource } from '../data-source';
import { csv, simplePdf } from './demo-files';
import { seedTaxonomy, TAXONOMY } from './taxonomy-data';
import { seedWorkflowSamples } from './workflow-samples';

/**
 * Datos de prueba, todos sinteticos. Se puede ejecutar varias veces.
 *
 *  1. Taxonomia y cuentas de desarrollo: se insertan con el rol propietario.
 *  2. Contenido de demostracion: se crea con los mismos casos de uso que usa la API, de modo que
 *     recorre el flujo editorial real (autor -> revisor) y deja su historia, su bitacora y sus avisos.
 */

async function seedReferenceData(owner: DataSource): Promise<void> {
  await seedTaxonomy(owner, TAXONOMY);

  for (const account of DEV_ACCOUNTS) {
    await owner.query(
      `INSERT INTO users (external_subject_id, email, display_name) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
      [account.subject, account.email, account.displayName],
    );
    const [{ id }] = await owner.query(`SELECT id FROM users WHERE email = $1`, [account.email]);
    await owner.query(`INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [id]);
    await owner.query(
      `INSERT INTO role_assignments (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2 ON CONFLICT DO NOTHING`,
      [id, account.role],
    );
  }
}

type WithTerms<T> = Omit<T, 'termIds'> & { terms: string[] };

async function seedDemoContent(app: INestApplicationContext, owner: DataSource): Promise<void> {
  const users = app.get<UserRepository>(USER_REPOSITORY);
  const resources = app.get(ResourcesService);
  const initiatives = app.get(InitiativesService);
  const courses = app.get(CoursesService);
  const editorial = app.get(EditorialService);

  const actor = async (subject: string): Promise<SessionUser> =>
    users.findSessionUser((await users.findBySubject(subject)).id);
  const author = await actor('dev-autor');
  const manager = await actor('dev-gestor');
  const reviewer = await actor('dev-revisor');

  const termIds = async (names: string[]): Promise<string[]> =>
    (await owner.query(`SELECT id FROM taxonomy_terms WHERE name = ANY($1::varchar[])`, [names])).map((r) => r.id);
  const idOf = async (table: string, title: string): Promise<string | null> =>
    (await owner.query(`SELECT id FROM ${table} WHERE title = $1`, [title]))[0]?.id ?? null;

  /** El recorrido completo: el creador envia; el revisor toma, aprueba y publica. */
  const publish = async (creator: SessionUser, entityType: string, id: string) => {
    await editorial.transition(creator, entityType, id, 'SUBMITTED');
    await editorial.transition(reviewer, entityType, id, 'IN_REVIEW');
    await editorial.transition(reviewer, entityType, id, 'APPROVED');
    await editorial.transition(reviewer, entityType, id, 'PUBLISHED');
  };

  // --- Recursos ---------------------------------------------------------------------------------
  const demoResources: (WithTerms<ResourceData> & { file: { name: string; bytes: Buffer }; publish: boolean })[] = [
    {
      title: 'Guía de vigilancia comunitaria en salud',
      description:
        'Paso a paso para que líderes comunitarios identifiquen y reporten eventos de interés en salud pública en su barrio o vereda.',
      license: 'CC BY-NC-SA 4.0',
      visibility: 'PUBLIC',
      terms: ['Vigilancia epidemiológica', 'Guía', 'Caldas', 'Líderes comunitarios', 'Comunidad'],
      file: {
        name: 'guia-vigilancia-comunitaria.pdf',
        bytes: simplePdf('Guía de vigilancia comunitaria en salud', [
          '1. Observa: identifica situaciones que afectan la salud de tu comunidad.',
          '2. Registra: anota qué pasó, dónde y cuándo, sin datos personales.',
          '3. Reporta: comunica el evento al punto de contacto de tu municipio.',
          '4. Acompaña: participa en la respuesta y en el boletín mensual.',
          '',
          'Documento sintético de demostración - Centro Virtual de Salud Pública.',
        ]),
      },
      publish: true,
    },
    {
      title: 'Indicadores de atención primaria por municipio',
      description: 'Conjunto de datos agregado (sin datos personales) con la cobertura de atención primaria por municipio de Caldas.',
      license: 'CC BY 4.0',
      visibility: 'RESTRICTED',
      terms: ['Atención primaria en salud', 'Conjunto de datos', 'Caldas', 'Datos abiertos'],
      file: {
        name: 'indicadores-aps-caldas.csv',
        bytes: csv([
          ['municipio', 'anio', 'cobertura_aps_porcentaje'],
          ['Chinchiná', '2025', '78.4'],
          ['La Dorada', '2025', '71.9'],
          ['Manizales', '2025', '85.2'],
          ['Riosucio', '2025', '64.3'],
          ['Villamaría', '2025', '80.1'],
        ]),
      },
      publish: true,
    },
    {
      title: 'Presentación: huertas escolares y nutrición',
      description: 'Diapositivas de apoyo para el taller de huertas escolares (en preparación).',
      license: 'CC BY-NC 4.0',
      visibility: 'PUBLIC',
      terms: ['Seguridad alimentaria y nutricional', 'Presentación', 'Ruralidad'],
      file: {
        name: 'huertas-escolares.pdf',
        bytes: simplePdf('Huertas escolares y nutrición', ['Borrador del taller.', 'Documento sintético de demostración.']),
      },
      publish: false,
    },
  ];

  for (const { terms, file, publish: shouldPublish, ...data } of demoResources) {
    if (await idOf('resources', data.title)) continue;
    const { id } = await resources.create(author, { ...data, termIds: await termIds(terms) });
    await resources.addVersion(author, id, { originalname: file.name, size: file.bytes.length, buffer: file.bytes });
    if (shouldPublish) await publish(author, 'resources', id);
    console.log(`  recurso ${shouldPublish ? 'publicado' : 'en borrador'}: ${data.title}`);
  }

  // --- Iniciativas ------------------------------------------------------------------------------
  const demoInitiatives: (WithTerms<Omit<InitiativeData, 'resourceIds'>> & { resources: string[]; publish: boolean })[] = [
    {
      title: 'Red de vigilancia comunitaria en salud',
      summary:
        'Líderes comunitarios y estudiantes reportan eventos de interés en salud pública de sus barrios y veredas. La red consolida los reportes y los devuelve a cada comunidad en boletines mensuales.',
      type: 'RESEARCH',
      startDate: '2026-02-02',
      endDate: '2026-11-27',
      results: 'Cuarenta líderes formados y doce boletines publicados en el primer semestre.',
      terms: ['Vigilancia epidemiológica', 'Promoción de la salud', 'Manizales', 'Chinchiná', 'Líderes comunitarios'],
      resources: ['Guía de vigilancia comunitaria en salud', 'Indicadores de atención primaria por municipio'],
      publish: true,
    },
    {
      title: 'Escuela de líderes en atención primaria',
      summary:
        'Programa de extensión que forma líderes territoriales en los fundamentos de la atención primaria en salud, con prácticas en los centros de salud de cada municipio.',
      type: 'EXTENSION',
      startDate: '2026-03-09',
      endDate: null,
      results: null,
      terms: ['Atención primaria en salud', 'Riosucio', 'La Dorada', 'Gestores territoriales'],
      resources: ['Indicadores de atención primaria por municipio'],
      publish: true,
    },
    {
      title: 'Huertas escolares saludables',
      summary: 'Experiencia en instituciones educativas rurales que une la huerta escolar con la educación nutricional.',
      type: 'COMMUNITY_EXPERIENCE',
      startDate: null,
      endDate: null,
      results: null,
      terms: ['Seguridad alimentaria y nutricional', 'Villamaría', 'Ruralidad'],
      resources: ['Presentación: huertas escolares y nutrición'],
      publish: false,
    },
  ];

  for (const { terms, resources: linked, publish: shouldPublish, ...data } of demoInitiatives) {
    if (await idOf('initiatives', data.title)) continue;
    const resourceIds = await Promise.all(linked.map((title) => idOf('resources', title)));
    const { id } = await initiatives.create(author, { ...data, termIds: await termIds(terms), resourceIds });
    if (shouldPublish) await publish(author, 'initiatives', id);
    console.log(`  iniciativa ${shouldPublish ? 'publicada' : 'en borrador'}: ${data.title}`);
  }

  // --- Cursos -----------------------------------------------------------------------------------
  const demoCourses: (WithTerms<Omit<CourseData, 'initiativeIds' | 'resourceIds'>> & {
    initiatives: string[];
    resources: string[];
    moodleExternalId: string | null;
  })[] = [
    {
      title: 'Curso básico de salud',
      summary: 'Curso introductorio sobre atención primaria en salud: conceptos, actores y rutas de atención.',
      type: 'COURSE',
      modality: 'VIRTUAL',
      duration: '40 horas',
      startDate: '2026-10-19',
      endDate: '2026-12-11',
      capacity: 60,
      requirements: 'Ninguno. Se recomienda conexión estable a internet.',
      accessInstructions: 'Ingresa a Moodle con tu cuenta institucional y busca el curso por su nombre.',
      terms: ['Atención primaria en salud', 'Estudiantes de pregrado', 'Líderes comunitarios'],
      initiatives: ['Escuela de líderes en atención primaria'],
      resources: ['Indicadores de atención primaria por municipio'],
      moodleExternalId: 'cvsp-salud-basica',
    },
    {
      title: 'Primeros auxilios',
      summary: 'Curso práctico de primeros auxilios para el personal de los centros de salud y la comunidad.',
      type: 'MICROCOURSE',
      modality: 'SELF_PACED',
      duration: '12 horas',
      startDate: null,
      endDate: null,
      capacity: null,
      requirements: null,
      accessInstructions: null,
      terms: ['Promoción de la salud', 'Personal de salud', 'Líderes comunitarios'],
      initiatives: [],
      resources: [],
      moodleExternalId: 'cvsp-primeros-auxilios',
    },
    {
      title: 'Diplomado en salud pública territorial',
      summary: 'Diplomado para gestores territoriales sobre planeación, vigilancia y participación en salud pública.',
      type: 'DIPLOMA',
      modality: 'HYBRID',
      duration: '120 horas',
      startDate: '2027-02-08',
      endDate: '2027-06-25',
      capacity: 35,
      requirements: 'Vinculación con una secretaría de salud o una organización comunitaria.',
      accessInstructions:
        'El aula virtual se habilita al abrir la inscripción. Escribe a formacion@cvsp.local para recibir el aviso de apertura.',
      terms: ['Vigilancia epidemiológica', 'Atención primaria en salud', 'Gestores territoriales', 'Docentes'],
      initiatives: ['Red de vigilancia comunitaria en salud'],
      resources: ['Guía de vigilancia comunitaria en salud'],
      moodleExternalId: null,
    },
  ];

  for (const { terms, initiatives: linkedInitiatives, resources: linkedResources, moodleExternalId, ...data } of demoCourses) {
    if (await idOf('courses', data.title)) continue;
    const course = await courses.create(
      manager,
      {
        ...data,
        termIds: await termIds(terms),
        initiativeIds: await Promise.all(linkedInitiatives.map((title) => idOf('initiatives', title))),
        resourceIds: await Promise.all(linkedResources.map((title) => idOf('resources', title))),
      },
      moodleExternalId,
    );
    let outcome = 'publicado';
    try {
      await publish(manager, 'courses', course.id);
    } catch (error) {
      // Sin enlace verificado ni instruccion de acceso el curso no es publicable: queda aprobado.
      outcome = `no publicado (${(error as Error).message})`;
    }
    console.log(`  curso ${outcome}: ${data.title} [enlace: ${course.link.status}]`);
  }
}

async function main() {
  const owner = await createMigrationDataSource().initialize();
  let app: INestApplicationContext | undefined;
  try {
    console.log('Taxonomía y cuentas de desarrollo...');
    await seedReferenceData(owner);

    console.log('Contenido de demostración...');
    app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
    await seedDemoContent(app, owner);
    await seedWorkflowSamples(app, owner);
    console.log('Semilla aplicada.');
  } finally {
    await app?.close();
    await owner.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
