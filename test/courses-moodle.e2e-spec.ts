import { Account, courseBody, createHarness, Harness, initiativeBody } from './support/harness';

/**
 * Catalogo educativo e integracion con Moodle (RF-06 · H-22 a H-27; Plan de pruebas 5.3).
 * Moodle se sustituye por su doble de prueba para poder provocar cada escenario: curso
 * encontrado, identificador inexistente, duplicado, LMS inalcanzable y respuesta invalida.
 */
describe('Catálogo de cursos e integración con Moodle', () => {
  let h: Harness;
  const MOODLE = 'http://moodle.prueba';

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  beforeEach(async () => {
    h.moodle.reset();
    await h.owner.query(`TRUNCATE courses, integration_logs CASCADE`);
  });

  const createCourse = async (overrides: Record<string, unknown> = {}) =>
    (await h.as('gestor')).post('/courses').send(courseBody(overrides));

  const transition = async (account: Account, id: string, to: string, comment?: string) =>
    (await h.as(account)).post(`/editorial/courses/${id}/transitions`).send({ to, comment });

  /** Recorre el flujo editorial hasta publicar; devuelve la respuesta del ultimo paso. */
  const publish = async (id: string) => {
    for (const [account, to] of [['gestor', 'SUBMITTED'], ['revisor', 'IN_REVIEW'], ['revisor', 'APPROVED']] as const) {
      expect((await transition(account, id, to)).status).toBe(200);
    }
    return transition('revisor', id, 'PUBLISHED');
  };

  const lastLog = async () => (await h.owner.query(`SELECT * FROM integration_logs ORDER BY occurred_at DESC, id LIMIT 1`))[0];

  describe('enlace verificado al guardar (H-23)', () => {
    it('curso encontrado: el enlace queda verificado y la URL apunta al aula', async () => {
      h.moodle.addCourse('cvsp-salud-basica', { id: 42, shortname: 'salud-basica', fullname: 'Curso Básico de Salud' });

      const course = (await createCourse({ moodleExternalId: 'cvsp-salud-basica' })).body;

      expect(course.state).toBe('DRAFT');
      expect(course.link).toMatchObject({
        externalId: 'cvsp-salud-basica',
        url: `${MOODLE}/course/view.php?id=42`,
        status: 'VERIFIED',
        error: null,
      });
      expect(course.link.verifiedAt).not.toBeNull();
    });

    it('identificador inexistente: la ficha se guarda, pero el enlace queda en error', async () => {
      const response = await createCourse({ moodleExternalId: 'cvsp-no-existe' });

      expect(response.status).toBe(201);
      expect(response.body.link).toMatchObject({ status: 'ERROR', error: 'curso_no_encontrado', url: null });
    });

    it('identificador duplicado en Moodle: enlace en error, sin elegir un curso', async () => {
      h.moodle
        .addCourse('cvsp-repetido', { id: 1, shortname: 'a', fullname: 'A' })
        .addCourse('cvsp-repetido', { id: 2, shortname: 'b', fullname: 'B' });

      const course = (await createCourse({ moodleExternalId: 'cvsp-repetido' })).body;

      expect(course.link).toMatchObject({ status: 'ERROR', error: 'idnumber_duplicado', url: null });
    });

    it.each(['lms_inalcanzable', 'respuesta_invalida', 'token_invalido'] as const)(
      'Moodle falla con %s: la ficha se guarda con el enlace pendiente',
      async (errorCode) => {
        h.moodle.failWith(errorCode);

        const response = await createCourse({ moodleExternalId: 'cvsp-salud-basica' });

        expect(response.status).toBe(201);
        expect(response.body.link).toMatchObject({ status: 'PENDING', error: errorCode });
      },
    );

    it('el gestor reintenta la verificación cuando Moodle vuelve', async () => {
      h.moodle.failWith('lms_inalcanzable');
      const id = (await createCourse({ moodleExternalId: 'cvsp-salud-basica' })).body.id;

      h.moodle.reset().addCourse('cvsp-salud-basica', { id: 42, shortname: 'salud-basica', fullname: 'Curso' });
      const verified = (await (await h.as('gestor')).post(`/courses/${id}/verify-link`).expect(200)).body;

      expect(verified.link).toMatchObject({ status: 'VERIFIED', url: `${MOODLE}/course/view.php?id=42`, error: null });
    });

    it('dos fichas no pueden apuntar al mismo curso de Moodle', async () => {
      h.moodle.addCourse('cvsp-salud-basica', { id: 42, shortname: 'salud-basica', fullname: 'Curso' });
      await createCourse({ moodleExternalId: 'cvsp-salud-basica' });

      const second = await createCourse({ title: 'Otra ficha del mismo curso', moodleExternalId: 'cvsp-salud-basica' });

      expect(second.status).toBe(409);
      expect(second.body.code).toBe('idnumber_en_uso');
      expect((await h.owner.query(`SELECT count(*)::int AS n FROM courses`))[0].n).toBe(1);
    });

    it('rechaza un idnumber del Centro que no cumple la convención cvsp-<slug>', async () => {
      const response = await createCourse({ moodleExternalId: 'cvsp-Salud Básica' });
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('idnumber_invalido');
      expect(h.moodle.calls).toBe(0);
    });

    it('respeta un idnumber heredado de otro sistema institucional', async () => {
      h.moodle.addCourse('SIA-2026-SP101', { id: 9, shortname: 'sp101', fullname: 'Salud pública I' });
      const course = (await createCourse({ moodleExternalId: 'SIA-2026-SP101' })).body;
      expect(course.link).toMatchObject({ externalId: 'SIA-2026-SP101', status: 'VERIFIED' });
    });

    it('una ficha sin idnumber queda sin enlace y no consulta a Moodle', async () => {
      const course = (await createCourse({ moodleExternalId: '   ' })).body;
      expect(course.link).toMatchObject({ externalId: null, status: 'NOT_LINKED' });
      expect(h.moodle.calls).toBe(0);
    });

    it('quitar el idnumber al editar deja la ficha sin enlace', async () => {
      h.moodle.addCourse('cvsp-salud-basica', { id: 42, shortname: 'salud-basica', fullname: 'Curso' });
      const id = (await createCourse({ moodleExternalId: 'cvsp-salud-basica' })).body.id;

      const updated = (await (await h.as('gestor')).put(`/courses/${id}`).send(courseBody()).expect(200)).body;

      expect(updated.link).toEqual({ externalId: null, url: null, status: 'NOT_LINKED', verifiedAt: null, error: null });
    });
  });

  describe('la ficha completa del modelo', () => {
    it('guarda requisitos, cupos y su clasificación, y asocia iniciativas publicadas', async () => {
      const autor = await h.as('autor');
      const initiativeId = (await autor.post('/initiatives').send(initiativeBody()).expect(201)).body.id;
      await h.forceState('initiatives', initiativeId, 'PUBLISHED');

      const course = (
        await createCourse({
          requirements: 'Vinculación con una secretaría de salud.',
          capacity: 30,
          termIds: [h.catalog.themeA, h.catalog.populationA],
          initiativeIds: [initiativeId],
        })
      ).body;

      expect(course).toMatchObject({
        requirements: 'Vinculación con una secretaría de salud.',
        capacity: 30,
        terms: expect.arrayContaining([expect.objectContaining({ id: h.catalog.populationA, type: 'POPULATION' })]),
        initiatives: [{ id: initiativeId, title: 'Red de vigilancia comunitaria', state: 'PUBLISHED' }],
        createdBy: h.userId('gestor'),
      });
    });

    it('no asocia una iniciativa que no está publicada', async () => {
      const draft = (await (await h.as('autor')).post('/initiatives').send(initiativeBody()).expect(201)).body.id;
      const response = await createCourse({ initiativeIds: [draft] });
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('contenido_invalido');
    });

    it.each([
      ['sin resumen', { summary: undefined }],
      ['tipo fuera del modelo', { type: 'SEMINAR' }],
      ['modalidad fuera del modelo', { modality: 'TELEPATHIC' }],
      ['cupo en cero', { capacity: 0 }],
    ])('rechaza %s', async (_name, overrides) => {
      expect((await createCourse(overrides)).status).toBe(400);
    });
  });

  describe('registro de integraciones (RF-11, RNF-08)', () => {
    it('cada verificación deja un registro con operación, resultado, entidad y duración', async () => {
      h.moodle.addCourse('cvsp-salud-basica', { id: 42, shortname: 'salud-basica', fullname: 'Curso' });
      const id = (await createCourse({ moodleExternalId: 'cvsp-salud-basica' })).body.id;

      expect(await lastLog()).toMatchObject({
        integration: 'moodle',
        operation: 'core_course_get_courses_by_field',
        status: 'OK',
        error_code: null,
        entity_type: 'courses',
        entity_id: id,
      });
      expect((await lastLog()).duration_ms).toEqual(expect.any(Number));
    });

    it('un identificador inexistente o duplicado se registra como error con su código', async () => {
      await createCourse({ moodleExternalId: 'cvsp-no-existe' });
      expect(await lastLog()).toMatchObject({ status: 'ERROR', error_code: 'curso_no_encontrado' });
    });

    it('una demora del LMS se registra como timeout', async () => {
      h.moodle.failWith('lms_inalcanzable', true);
      await createCourse({ moodleExternalId: 'cvsp-salud-basica' });
      expect(await lastLog()).toMatchObject({ status: 'TIMEOUT', error_code: 'lms_inalcanzable' });
    });

    it('el panel de errores de integración los lista para el administrador', async () => {
      await createCourse({ moodleExternalId: 'cvsp-no-existe' });
      h.moodle.addCourse('cvsp-ok', { id: 5, shortname: 'ok', fullname: 'Curso' });
      await createCourse({ title: 'Curso enlazado', moodleExternalId: 'cvsp-ok' });

      const errors = (await (await h.as('admin')).get('/admin/integration-logs').query({ status: 'ERROR' }).expect(200)).body;

      expect(errors.total).toBe(1);
      expect(errors.items[0]).toMatchObject({ integration: 'moodle', errorCode: 'curso_no_encontrado', entityType: 'courses' });
    });
  });

  describe('regla de publicación: todo curso publicado lleva al aula o explica cómo entrar', () => {
    it('con enlace verificado se publica y el visitante recibe el enlace al aula (H-26)', async () => {
      h.moodle.addCourse('cvsp-salud-basica', { id: 42, shortname: 'salud-basica', fullname: 'Curso' });
      const id = (await createCourse({ moodleExternalId: 'cvsp-salud-basica' })).body.id;

      expect((await publish(id)).status).toBe(200);

      const ficha = (await h.visitor().get(`/public/courses/${id}`).expect(200)).body;
      expect(ficha.access).toEqual({ kind: 'LMS', url: `${MOODLE}/course/view.php?id=42` });
      expect(ficha.publishedAt).not.toBeNull();
    });

    it('con el enlace en error y sin instrucción de acceso no se puede publicar', async () => {
      const id = (await createCourse({ moodleExternalId: 'cvsp-no-existe' })).body.id;

      const response = await publish(id);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('curso_sin_acceso');
      await h.visitor().get(`/public/courses/${id}`).expect(404);
    });

    it('sin enlace directo pero con instrucción de acceso se publica y el visitante la recibe (H-25)', async () => {
      const id = (await createCourse({ accessInstructions: 'Inscripción presencial en la sede Versalles.' })).body.id;

      expect((await publish(id)).status).toBe(200);

      const ficha = (await h.visitor().get(`/public/courses/${id}`).expect(200)).body;
      expect(ficha.access).toEqual({ kind: 'INSTRUCTIONS', text: 'Inscripción presencial en la sede Versalles.' });
    });

    it('la ficha pública no expone el estado interno del enlace ni quién la creó', async () => {
      h.moodle.addCourse('cvsp-salud-basica', { id: 42, shortname: 'salud-basica', fullname: 'Curso' });
      const id = (await createCourse({ moodleExternalId: 'cvsp-salud-basica' })).body.id;
      await publish(id);

      const ficha = (await h.visitor().get(`/public/courses/${id}`).expect(200)).body;

      expect(Object.keys(ficha)).not.toEqual(expect.arrayContaining(['link', 'createdBy', 'state', 'accessInstructions']));
      expect(JSON.stringify(ficha)).not.toContain(h.userId('gestor'));
    });

    it('el gestor crea la ficha pero no la publica: pasa por un revisor', async () => {
      const id = (await createCourse({ accessInstructions: 'Instrucción.' })).body.id;
      await transition('gestor', id, 'SUBMITTED');

      expect((await transition('gestor', id, 'IN_REVIEW')).status).toBe(403);
    });
  });

  describe('modo degradado: con Moodle caído el catálogo se sigue sirviendo (H-27)', () => {
    let verifiedId: string;

    beforeEach(async () => {
      h.moodle.addCourse('cvsp-salud-basica', { id: 42, shortname: 'salud-basica', fullname: 'Curso' });
      verifiedId = (await createCourse({ moodleExternalId: 'cvsp-salud-basica', accessInstructions: 'Busca el curso por su nombre en Moodle.' }))
        .body.id;
      await publish(verifiedId);
      h.moodle.failWith('lms_inalcanzable');
      h.moodle.calls = 0;
    });

    it('el listado y la ficha pública responden sin consultar al LMS', async () => {
      const list = (await h.visitor().get('/public/courses').expect(200)).body;
      const ficha = (await h.visitor().get(`/public/courses/${verifiedId}`).expect(200)).body;

      expect(list.total).toBe(1);
      expect(ficha.access).toEqual({ kind: 'LMS', url: `${MOODLE}/course/view.php?id=42` });
      expect(h.moodle.calls).toBe(0);
    });

    it('la verificación de salud no depende de Moodle', async () => {
      expect((await h.visitor().get('/health/ready').expect(200)).body).toEqual({ status: 'ok', database: 'ok' });
      expect(h.moodle.calls).toBe(0);
    });

    it('la conciliación con Moodle caído conserva los enlaces ya verificados', async () => {
      const summary = (await (await h.as('admin')).post('/admin/moodle/reconcile').expect(200)).body;

      expect(summary).toMatchObject({ reviewed: 1, unanswered: 1, verified: 0, orphaned: 0 });
      const ficha = (await h.visitor().get(`/public/courses/${verifiedId}`).expect(200)).body;
      expect(ficha.access.kind).toBe('LMS');
    });
  });

  describe('conciliación (H-24)', () => {
    it('detecta el curso huérfano y el visitante pasa a ver la instrucción de acceso', async () => {
      h.moodle.addCourse('cvsp-salud-basica', { id: 42, shortname: 'salud-basica', fullname: 'Curso' });
      const id = (await createCourse({ moodleExternalId: 'cvsp-salud-basica', accessInstructions: 'Escribe a la coordinación.' })).body.id;
      await publish(id);

      h.moodle.removeCourse('cvsp-salud-basica'); // el aula fue eliminada en Moodle
      const summary = (await (await h.as('tecnico')).post('/admin/moodle/reconcile').expect(200)).body;

      expect(summary).toMatchObject({ reviewed: 1, orphaned: 1, verified: 0 });
      const detail = (await (await h.as('gestor')).get(`/courses/${id}`).expect(200)).body;
      expect(detail.link).toMatchObject({ status: 'ORPHAN', error: 'curso_no_encontrado' });
      // La ficha sigue publicada, pero ya no ofrece un enlace a un aula que no existe.
      const ficha = (await h.visitor().get(`/public/courses/${id}`).expect(200)).body;
      expect(ficha.access).toEqual({ kind: 'INSTRUCTIONS', text: 'Escribe a la coordinación.' });
    });

    it('actualiza la URL cuando el id interno cambia tras restaurar Moodle', async () => {
      h.moodle.addCourse('cvsp-salud-basica', { id: 42, shortname: 'salud-basica', fullname: 'Curso' });
      const id = (await createCourse({ moodleExternalId: 'cvsp-salud-basica' })).body.id;

      h.moodle.reset().addCourse('cvsp-salud-basica', { id: 907, shortname: 'salud-basica', fullname: 'Curso' });
      await (await h.as('admin')).post('/admin/moodle/reconcile').expect(200);

      const detail = (await (await h.as('gestor')).get(`/courses/${id}`).expect(200)).body;
      expect(detail.link).toMatchObject({ url: `${MOODLE}/course/view.php?id=907`, status: 'VERIFIED' });
    });

    it('solo toca las columnas del enlace: nunca el contenido editorial de la ficha', async () => {
      h.moodle.addCourse('cvsp-salud-basica', { id: 42, shortname: 'nombre-en-moodle', fullname: 'TÍTULO DISTINTO EN MOODLE' });
      const id = (await createCourse({ title: 'Título de la ficha', summary: 'Resumen propio.', moodleExternalId: 'cvsp-salud-basica' })).body.id;
      const columns = `title, summary, editorial_status, updated_at`;
      const before = (await h.owner.query(`SELECT ${columns} FROM courses WHERE id = $1`, [id]))[0];

      await (await h.as('admin')).post('/admin/moodle/reconcile').expect(200);

      expect((await h.owner.query(`SELECT ${columns} FROM courses WHERE id = $1`, [id]))[0]).toEqual(before);
    });

    it('todas las llamadas de una corrida comparten correlationId y la corrida queda en la bitácora', async () => {
      h.moodle.addCourse('cvsp-a', { id: 1, shortname: 'a', fullname: 'A' }).addCourse('cvsp-b', { id: 2, shortname: 'b', fullname: 'B' });
      await createCourse({ title: 'Curso A', moodleExternalId: 'cvsp-a' });
      await createCourse({ title: 'Curso B', moodleExternalId: 'cvsp-b' });
      await h.owner.query(`TRUNCATE integration_logs`);

      const summary = (await (await h.as('admin')).post('/admin/moodle/reconcile').expect(200)).body;

      const logs = await h.owner.query(`SELECT correlation_id FROM integration_logs`);
      expect(logs).toHaveLength(2);
      expect(new Set(logs.map((l) => l.correlation_id))).toEqual(new Set([summary.correlationId]));
      const [audit] = await h.owner.query(
        `SELECT actor_id, minimal_detail FROM audit_logs WHERE action = 'integration.moodle_reconciliation' ORDER BY occurred_at DESC LIMIT 1`,
      );
      expect(audit).toMatchObject({
        actor_id: h.userId('admin'),
        minimal_detail: { correlationId: summary.correlationId, reviewed: 2, verified: 2 },
      });
    });
  });

  describe('catálogo público: filtros del recorrido R3', () => {
    beforeEach(async () => {
      for (const data of [
        {
          title: 'Atención primaria para líderes',
          summary: 'Rutas y actores.',
          modality: 'VIRTUAL',
          termIds: [h.catalog.themeA, h.catalog.populationA],
        },
        { title: 'Salud mental comunitaria', summary: 'Acompañamiento psicosocial.', modality: 'IN_PERSON', type: 'DIPLOMA', termIds: [h.catalog.themeB] },
      ]) {
        const id = (await createCourse({ ...data, accessInstructions: 'Instrucción de acceso.' })).body.id;
        expect((await publish(id)).status).toBe(200);
      }
      await createCourse({ title: 'Borrador de curso sin publicar', accessInstructions: 'x' });
    });

    const search = async (query: Record<string, unknown>) => (await h.visitor().get('/public/courses').query(query).expect(200)).body;

    it('solo lista las fichas publicadas', async () => {
      expect((await search({})).items.map((c) => c.title)).toEqual(['Atención primaria para líderes', 'Salud mental comunitaria']);
    });

    it('filtra por tema, población, tipo y modalidad', async () => {
      expect((await search({ themeId: h.catalog.themeB })).items.map((c) => c.title)).toEqual(['Salud mental comunitaria']);
      expect((await search({ populationId: h.catalog.populationA })).items.map((c) => c.title)).toEqual(['Atención primaria para líderes']);
      expect((await search({ modality: 'IN_PERSON' })).items.map((c) => c.title)).toEqual(['Salud mental comunitaria']);
      expect((await search({ type: 'DIPLOMA' })).items.map((c) => c.title)).toEqual(['Salud mental comunitaria']);
      expect((await search({ modality: 'VIRTUAL', themeId: h.catalog.themeB })).total).toBe(0);
    });

    it('busca por texto sin tildes', async () => {
      expect((await search({ q: 'atencion' })).items.map((c) => c.title)).toEqual(['Atención primaria para líderes']);
    });
  });

  describe('la ficha es de su gestor', () => {
    it('otro usuario con permiso de cursos no edita ni reverifica una ficha ajena', async () => {
      const id = (await createCourse()).body.id;
      await h.owner.query(
        `INSERT INTO role_assignments (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'ACADEMIC_MANAGER' ON CONFLICT DO NOTHING`,
        [h.userId('autor2')],
      );
      const other = await h.as('autor2');

      await other.put(`/courses/${id}`).send(courseBody({ title: 'Cambio ajeno' })).expect(404);
      await other.post(`/courses/${id}/verify-link`).expect(404);
      await other.get(`/courses/${id}`).expect(404);
    });
  });
});
