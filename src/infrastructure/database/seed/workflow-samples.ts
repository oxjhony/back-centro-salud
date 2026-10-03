import { INestApplicationContext } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CoursesService } from '../../../modules/courses/application/courses.service';
import { EditorialService } from '../../../modules/editorial/application/editorial.service';
import { USER_REPOSITORY, UserRepository } from '../../../modules/identity/application/ports';
import { SessionUser } from '../../../modules/identity/domain/permissions';
import { InitiativesService } from '../../../modules/initiatives/application/initiatives.service';
import { ResourcesService } from '../../../modules/resources/application/resources.service';
import { simplePdf } from './demo-files';

type Step = [SessionUser, string, string?];

/**
 * Contenido en todos los estados del flujo editorial, de varios autores y revisores, para recorrer
 * las pantallas de cada rol. Se crea con los casos de uso reales. Se puede ejecutar varias veces.
 */
export async function seedWorkflowSamples(app: INestApplicationContext, owner: DataSource): Promise<void> {
  const users = app.get<UserRepository>(USER_REPOSITORY);
  const resources = app.get(ResourcesService);
  const initiatives = app.get(InitiativesService);
  const courses = app.get(CoursesService);
  const editorial = app.get(EditorialService);

  const actor = async (subject: string): Promise<SessionUser> =>
    users.findSessionUser((await users.findBySubject(subject)).id);
  const [autor2, autor3, gestor2, revisor, revisor2, admin] = await Promise.all(
    ['dev-autor2', 'dev-autor3', 'dev-gestor2', 'dev-revisor', 'dev-revisor2', 'dev-admin'].map(actor),
  );

  const termIds = async (names: string[]): Promise<string[]> =>
    (await owner.query(`SELECT id FROM taxonomy_terms WHERE name = ANY($1::varchar[])`, [names])).map((r) => r.id);
  const exists = async (table: string, title: string) =>
    (await owner.query(`SELECT 1 FROM ${table} WHERE title = $1`, [title])).length > 0;

  const run = async (entity: string, id: string, steps: Step[]) => {
    for (const [who, to, comment] of steps) await editorial.transition(who, entity, id, to, comment);
  };
  const submit = (a: SessionUser): Step => [a, 'SUBMITTED'];
  const take = (r: SessionUser): Step => [r, 'IN_REVIEW'];
  const full = (a: SessionUser, r: SessionUser): Step[] => [submit(a), take(r), [r, 'APPROVED'], [r, 'PUBLISHED']];

  // --- Iniciativas ------------------------------------------------------------------------------
  const initiativeSamples: { title: string; summary: string; type: string; author: SessionUser; terms: string[]; steps: Step[] }[] = [
    { title: 'Mapeo de entornos saludables en Manizales', summary: 'Inventario participativo de parques, ciclovías y espacios que favorecen la actividad física.', type: 'PROJECT', author: autor2, terms: ['Promoción de la salud', 'Manizales'], steps: full(autor2, revisor2) },
    { title: 'Agua segura en veredas de Riosucio', summary: 'Vigilancia comunitaria de la calidad del agua de consumo.', type: 'COMMUNITY_EXPERIENCE', author: autor3, terms: ['Salud ambiental', 'Riosucio', 'Ruralidad'], steps: full(autor3, revisor) },
    { title: 'Cuidado de cuidadores', summary: 'Programa de acompañamiento psicosocial a personas que cuidan familiares.', type: 'PROGRAM', author: autor3, terms: ['Salud mental comunitaria'], steps: [submit(autor3)] },
    { title: 'Prácticas formativas en La Dorada', summary: 'Estudiantes de pregrado realizan prácticas en centros de salud del Magdalena Caldense.', type: 'TRAINING_PRACTICE', author: autor2, terms: ['Atención primaria en salud', 'La Dorada'], steps: [submit(autor2), take(revisor)] },
    { title: 'Investigación sobre nutrición escolar', summary: 'Estudio de hábitos alimentarios en instituciones educativas.', type: 'RESEARCH', author: autor2, terms: ['Seguridad alimentaria y nutricional'], steps: [submit(autor2), take(revisor), [revisor, 'APPROVED']] },
    { title: 'Prevención de dengue en Chinchiná', summary: 'Campaña comunitaria de eliminación de criaderos.', type: 'EXTENSION', author: autor3, terms: ['Vigilancia epidemiológica', 'Chinchiná'], steps: [submit(autor3), take(revisor2), [revisor2, 'RETURNED', 'Faltan los resultados esperados y las fechas.']] },
    { title: 'Jornadas de salud 2024', summary: 'Jornadas comunitarias del año anterior, ya concluidas.', type: 'PROGRAM', author: autor3, terms: ['Promoción de la salud'], steps: [...full(autor3, revisor), [admin, 'ARCHIVED', 'Concluyó en 2024.']] },
    { title: 'Propuesta fuera de alcance', summary: 'Propuesta de diagnóstico clínico individual.', type: 'PROJECT', author: autor3, terms: [], steps: [submit(autor3), take(revisor), [revisor, 'ARCHIVED', 'Fuera del alcance: no se tratan datos clínicos.']] },
  ];
  for (const s of initiativeSamples) {
    if (await exists('initiatives', s.title)) continue;
    const { id } = await initiatives.create(s.author, {
      title: s.title, summary: s.summary, type: s.type, startDate: null, endDate: null, results: null,
      termIds: await termIds(s.terms), resourceIds: [],
    });
    await run('initiatives', id, s.steps);
    console.log(`  iniciativa de ejemplo: ${s.title}`);
  }

  // --- Recursos ---------------------------------------------------------------------------------
  const resourceSamples: { title: string; visibility: 'PUBLIC' | 'RESTRICTED'; author: SessionUser; terms: string[]; steps: Step[]; versions: number }[] = [
    { title: 'Infografía: lavado de manos', visibility: 'PUBLIC', author: autor2, terms: ['Infografía', 'Promoción de la salud'], steps: full(autor2, revisor2), versions: 2 },
    { title: 'Informe técnico de agua de consumo', visibility: 'RESTRICTED', author: autor3, terms: ['Informe técnico', 'Salud ambiental'], steps: full(autor3, revisor), versions: 1 },
    { title: 'Protocolo de vigilancia en revisión', visibility: 'PUBLIC', author: autor3, terms: ['Guía', 'Vigilancia epidemiológica'], steps: [submit(autor3), take(revisor)], versions: 1 },
    { title: 'Datos de dengue 2025 (devuelto)', visibility: 'RESTRICTED', author: autor2, terms: ['Conjunto de datos'], steps: [submit(autor2), take(revisor), [revisor, 'RETURNED', 'Anonimiza los datos por municipio antes de reenviar.']], versions: 1 },
  ];
  for (const s of resourceSamples) {
    if (await exists('resources', s.title)) continue;
    const { id } = await resources.create(s.author, {
      title: s.title, description: `Recurso de demostración: ${s.title}.`, license: 'CC BY-NC 4.0',
      visibility: s.visibility, termIds: await termIds(s.terms),
    });
    for (let v = 1; v <= s.versions; v++) {
      const bytes = simplePdf(s.title, [`Versión ${v}`, 'Documento sintético de demostración.']);
      await resources.addVersion(s.author, id, { originalname: `documento-v${v}.pdf`, size: bytes.length, buffer: bytes });
    }
    await run('resources', id, s.steps);
    console.log(`  recurso de ejemplo: ${s.title}`);
  }

  // --- Cursos -----------------------------------------------------------------------------------
  const courseSamples: { title: string; idnumber: string | null; access: string | null; type: string; modality: string; steps: Step[] }[] = [
    { title: 'Salud mental comunitaria básica', idnumber: null, access: 'Inscripción presencial en la sede Versalles.', type: 'MICROCOURSE', modality: 'IN_PERSON', steps: full(gestor2, revisor) },
    { title: 'Vigilancia comunitaria (aula no encontrada)', idnumber: 'cvsp-no-existe-en-moodle', access: 'Escribe a formacion@cvsp.local.', type: 'COURSE', modality: 'VIRTUAL', steps: full(gestor2, revisor2) },
    { title: 'Curso en preparación', idnumber: null, access: null, type: 'COURSE', modality: 'HYBRID', steps: [] },
    { title: 'Nutrición comunitaria (en revisión)', idnumber: null, access: 'Consulta con la coordinación.', type: 'DIPLOMA', modality: 'SELF_PACED', steps: [submit(gestor2)] },
  ];
  for (const s of courseSamples) {
    if (await exists('courses', s.title)) continue;
    const course = await courses.create(
      gestor2,
      {
        title: s.title, summary: `Curso de demostración: ${s.title}.`, type: s.type, modality: s.modality,
        duration: '20 horas', startDate: null, endDate: null, capacity: 40, requirements: null,
        accessInstructions: s.access, termIds: await termIds(['Promoción de la salud', 'Líderes comunitarios']),
        initiativeIds: [], resourceIds: [],
      },
      s.idnumber,
    );
    await run('courses', course.id, s.steps);
    console.log(`  curso de ejemplo: ${s.title} [enlace: ${course.link.status}]`);
  }

  // Segunda autora en una iniciativa publicada, y una cuenta inactiva que no puede entrar.
  await owner.query(
    `INSERT INTO initiative_authors (initiative_id, user_id)
     SELECT i.id, u.id FROM initiatives i, users u
      WHERE i.title = 'Red de vigilancia comunitaria en salud' AND u.email = 'autor2@cvsp.local'
     ON CONFLICT DO NOTHING`,
  );
  await owner.query(`UPDATE users SET status = 'INACTIVE' WHERE email = 'inactivo@cvsp.local'`);
}
