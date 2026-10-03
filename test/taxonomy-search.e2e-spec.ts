import { courseBody, createHarness, draftResource, Harness, initiativeBody } from './support/harness';

/** RF-15 (catalogos administrables) y RF-10 (busqueda unica sobre lo publicado). */
describe('Taxonomía y búsqueda', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  describe('catálogos públicos', () => {
    it('entregan los términos activos con su tipo y jerarquía, y las enumeraciones del modelo', async () => {
      const catalogs = (await h.visitor().get('/catalogs').expect(200)).body;

      expect(catalogs.terms).toEqual(
        expect.arrayContaining([
          { id: h.catalog.territoryA, name: 'Manizales', type: 'TERRITORY', parentId: h.catalog.territoryParent, active: true },
        ]),
      );
      expect(catalogs).toMatchObject({
        taxonomyTypes: ['THEME', 'TERRITORY', 'POPULATION', 'RESOURCE_TYPE', 'TAG'],
        editorialStatuses: ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'RETURNED', 'ARCHIVED'],
        courseTypes: ['COURSE', 'MICROCOURSE', 'DIPLOMA'],
        visibilities: ['PUBLIC', 'RESTRICTED'],
      });
      expect(catalogs.resourceFormats).toContain('pdf');
      expect(catalogs.maxUploadBytes).toBeGreaterThan(0);
    });
  });

  describe('administración de la taxonomía (RF-15)', () => {
    it('el administrador crea un término y queda en la bitácora', async () => {
      const admin = await h.as('admin');
      const term = (await admin.post('/admin/taxonomy').send({ type: 'TERRITORY', name: '  Villamaría ', parentId: h.catalog.territoryParent }).expect(201))
        .body;

      expect(term).toMatchObject({ type: 'TERRITORY', name: 'Villamaría', parentId: h.catalog.territoryParent, active: true, usage: 0 });
      const [audit] = await h.owner.query(`SELECT actor_id, object_id FROM audit_logs WHERE action = 'taxonomy.term_created' ORDER BY occurred_at DESC LIMIT 1`);
      expect(audit).toEqual({ actor_id: h.userId('admin'), object_id: term.id });
    });

    it('no admite duplicados: mismo tipo, mismo padre, mismo nombre sin importar tildes ni mayúsculas', async () => {
      const response = await (await h.as('admin'))
        .post('/admin/taxonomy')
        .send({ type: 'TERRITORY', name: 'MANIZALES', parentId: h.catalog.territoryParent })
        .expect(409);
      expect(response.body.code).toBe('termino_duplicado');

      // Bajo otro padre, o en otro tipo, el mismo nombre si es valido.
      await (await h.as('admin')).post('/admin/taxonomy').send({ type: 'TAG', name: 'Manizales' }).expect(201);
    });

    it('el padre debe ser del mismo tipo y no puede formar un ciclo', async () => {
      const admin = await h.as('admin');
      expect((await admin.post('/admin/taxonomy').send({ type: 'THEME', name: 'Subtema', parentId: h.catalog.territoryParent }).expect(422)).body.code).toBe(
        'padre_invalido',
      );
      const cycle = await admin
        .put(`/admin/taxonomy/${h.catalog.territoryParent}`)
        .send({ name: 'Caldas', parentId: h.catalog.territoryA })
        .expect(422);
      expect(cycle.body.code).toBe('padre_invalido');
    });

    it('un término en uso no se borra: se desactiva, y deja de ofrecerse para clasificar contenido nuevo', async () => {
      const admin = await h.as('admin');
      const autor = await h.as('autor');
      const { id: term } = (await admin.post('/admin/taxonomy').send({ type: 'THEME', name: 'Salud ambiental' }).expect(201)).body;
      const initiativeId = (await autor.post('/initiatives').send(initiativeBody({ termIds: [term] })).expect(201)).body.id;

      const blocked = await admin.delete(`/admin/taxonomy/${term}`).expect(409);
      expect(blocked.body.code).toBe('termino_en_uso');
      expect((await admin.get('/admin/taxonomy').query({ type: 'THEME' })).body.find((t) => t.id === term).usage).toBe(1);

      await admin.put(`/admin/taxonomy/${term}`).send({ name: 'Salud ambiental', active: false }).expect(200);

      expect((await h.visitor().get('/catalogs')).body.terms.map((t) => t.id)).not.toContain(term);
      const reused = await autor.post('/initiatives').send(initiativeBody({ termIds: [term] })).expect(422);
      expect(reused.body.code).toBe('catalogo_invalido');
      // Lo que ya estaba clasificado conserva el termino al editarse.
      await autor.put(`/initiatives/${initiativeId}`).send(initiativeBody({ termIds: [term] })).expect(204);
    });

    it('un término sin uso se borra', async () => {
      const admin = await h.as('admin');
      const { id } = (await admin.post('/admin/taxonomy').send({ type: 'TAG', name: 'Temporal' }).expect(201)).body;
      await admin.delete(`/admin/taxonomy/${id}`).expect(204);
      expect((await h.owner.query(`SELECT 1 FROM taxonomy_terms WHERE id = $1`, [id])).length).toBe(0);
    });

    it('rechaza un tipo que no está en el modelo', async () => {
      await (await h.as('admin')).post('/admin/taxonomy').send({ type: 'COLOR', name: 'Verde' }).expect(400);
    });
  });

  describe('búsqueda única del portal (RF-10)', () => {
    beforeAll(async () => {
      await h.owner.query(`TRUNCATE initiatives, resources, courses CASCADE`);
      const autor = await h.as('autor');
      const gestor = await h.as('gestor');

      const initiative = (
        await autor
          .post('/initiatives')
          .send(initiativeBody({ title: 'Vacunación en zonas rurales', summary: 'Jornadas de vacunación.', termIds: [h.catalog.territoryA] }))
          .expect(201)
      ).body.id;
      const resource = await draftResource(autor, { title: 'Guía de vacunación infantil', termIds: [h.catalog.themeA] });
      const course = (await gestor.post('/courses').send(courseBody({ title: 'Curso de vacunación segura', accessInstructions: 'x' })).expect(201)).body.id;
      const hidden = (await autor.post('/initiatives').send(initiativeBody({ title: 'Vacunación: borrador' })).expect(201)).body.id;

      await h.forceState('initiatives', initiative, 'PUBLISHED');
      await h.forceState('resources', resource, 'PUBLISHED');
      await h.forceState('courses', course, 'PUBLISHED');
      expect(hidden).toBeDefined();
    });

    const search = async (query: Record<string, unknown>) => (await h.visitor().get('/public/search').query(query).expect(200)).body;

    it('encuentra iniciativas, recursos y cursos publicados con una sola consulta, sin tildes', async () => {
      const result = await search({ q: 'vacunacion' });
      expect(result.total).toBe(3);
      expect(result.items.map((i) => i.type).sort()).toEqual(['courses', 'initiatives', 'resources']);
      expect(result.items.map((i) => i.title)).not.toContain('Vacunación: borrador');
    });

    it('cada resultado trae tipo, resumen corto y su clasificación', async () => {
      const [hit] = (await search({ q: 'guia vacunacion' })).items;
      expect(hit).toMatchObject({
        type: 'resources',
        title: 'Guía de vacunación infantil',
        terms: [{ id: h.catalog.themeA, name: 'Atención primaria en salud', type: 'THEME' }],
      });
      expect(hit.excerpt.length).toBeLessThanOrEqual(280);
    });

    it('filtra por tipo de contenido y por término, incluido un territorio padre', async () => {
      expect((await search({ q: 'vacunacion', type: 'courses' })).items.map((i) => i.title)).toEqual(['Curso de vacunación segura']);
      expect((await search({ territoryId: h.catalog.territoryParent })).items.map((i) => i.title)).toEqual(['Vacunación en zonas rurales']);
    });

    it('sin resultados devuelve una página vacía', async () => {
      expect(await search({ q: 'astronomia' })).toEqual({ items: [], total: 0, page: 1, pageSize: 12 });
    });

    it('un filtro inválido se ignora en lugar de romper la búsqueda', async () => {
      expect((await search({ type: 'users', themeId: 'no-es-uuid', q: 'vacunacion' })).total).toBe(3);
    });
  });
});
