import { AUDIT_LOG } from '../src/modules/operations/ports';
import { Account, createHarness, draftResource, Harness, initiativeBody } from './support/harness';

/**
 * Recorrido R2 "Publicar una iniciativa" de punta a punta (RF-03, RF-04 · H-07 a H-15), mas las
 * reglas que el sistema no puede violar: nada se publica sin revision y toda transicion deja rastro.
 */
describe('Flujo editorial de iniciativas', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  const create = async (overrides: Record<string, unknown> = {}, account: Account = 'autor'): Promise<string> =>
    (await (await h.as(account)).post('/initiatives').send(initiativeBody(overrides)).expect(201)).body.id;

  const transition = async (account: Account, id: string, to: string, comment?: string) =>
    (await h.as(account)).post(`/editorial/initiatives/${id}/transitions`).send({ to, comment });

  const publish = async (id: string, entity = 'initiatives') => {
    for (const [account, to] of [['autor', 'SUBMITTED'], ['revisor', 'IN_REVIEW'], ['revisor', 'APPROVED'], ['revisor', 'PUBLISHED']] as const) {
      expect((await (await h.as(account)).post(`/editorial/${entity}/${id}/transitions`).send({ to })).status).toBe(200);
    }
  };

  describe('recorrido R2 completo', () => {
    let id: string;
    let resourceId: string;

    it('el autor crea la iniciativa en borrador, clasificada con la taxonomía y con un recurso propio', async () => {
      resourceId = await draftResource(await h.as('autor'), { title: 'Guía de líderes' });
      id = await create({
        title: 'Escuela de líderes en atención primaria',
        summary: 'Programa que forma líderes territoriales en atención primaria en salud.',
        termIds: [h.catalog.themeA, h.catalog.territoryA],
        resourceIds: [resourceId],
        startDate: '2026-03-09',
      });

      const detail = (await (await h.as('autor')).get(`/initiatives/${id}`).expect(200)).body;
      expect(detail).toMatchObject({
        state: 'DRAFT',
        startDate: '2026-03-09',
        terms: [
          { id: h.catalog.territoryA, name: 'Manizales', type: 'TERRITORY' },
          { id: h.catalog.themeA, name: 'Atención primaria en salud', type: 'THEME' },
        ],
        authors: [{ id: h.userId('autor'), displayName: 'Andrea Autora' }],
        resources: [{ id: resourceId, title: 'Guía de líderes', state: 'DRAFT' }],
        publishedAt: null,
      });
    });

    it('el borrador es visible para su autor y los revisores, y para nadie más', async () => {
      await (await h.as('autor')).get(`/initiatives/${id}`).expect(200);
      await (await h.as('revisor')).get(`/initiatives/${id}`).expect(200);
      await (await h.as('autor2')).get(`/initiatives/${id}`).expect(404);
      await (await h.as('gestor')).get(`/initiatives/${id}`).expect(404);
      await h.visitor().get(`/public/initiatives/${id}`).expect(404);
      expect((await h.visitor().get('/public/initiatives').expect(200)).body.total).toBe(0);
    });

    it('el autor corrige el borrador y lo envía a revisión', async () => {
      await (await h.as('autor'))
        .put(`/initiatives/${id}`)
        .send(
          initiativeBody({
            title: 'Escuela de líderes en atención primaria',
            summary: 'Resumen corregido.',
            termIds: [h.catalog.themeA, h.catalog.themeB],
            resourceIds: [resourceId],
          }),
        )
        .expect(204);

      expect((await transition('autor', id, 'SUBMITTED')).body).toEqual({ state: 'SUBMITTED' });
    });

    it('aparece en la bandeja del revisor', async () => {
      const queue = (await (await h.as('revisor')).get('/editorial/queue').expect(200)).body;
      expect(queue).toEqual([
        expect.objectContaining({ entityType: 'initiatives', id, state: 'SUBMITTED', authorName: 'Andrea Autora' }),
      ]);
    });

    it('enviada, el autor ya no puede editarla', async () => {
      const response = await (await h.as('autor')).put(`/initiatives/${id}`).send(initiativeBody()).expect(409);
      expect(response.body.code).toBe('no_editable');
    });

    it('el revisor la toma y la devuelve con observaciones', async () => {
      expect((await transition('revisor', id, 'IN_REVIEW')).status).toBe(200);
      expect((await transition('revisor', id, 'RETURNED', 'Falta precisar los territorios.')).status).toBe(200);
    });

    it('el autor recibe la notificación, sin el texto de la observación', async () => {
      const { items, unread } = (await (await h.as('autor')).get('/me/notifications').expect(200)).body;
      expect(unread).toBe(2);
      expect(items[0]).toMatchObject({
        type: 'EDITORIAL_TRANSITION',
        title: 'La iniciativa «Escuela de líderes en atención primaria» fue devuelta con observaciones',
        link: `/mis-iniciativas/${id}`,
        readAt: null,
      });
      expect(JSON.stringify(items)).not.toContain('Falta precisar');
    });

    it('el autor ve la observación, corrige y reenvía', async () => {
      const autor = await h.as('autor');
      const history = (await autor.get(`/editorial/initiatives/${id}/history`).expect(200)).body;
      expect(history.at(-1)).toMatchObject({
        from: 'IN_REVIEW',
        to: 'RETURNED',
        actorName: 'Ramiro Revisor',
        comment: 'Falta precisar los territorios.',
      });

      expect((await autor.get(`/editorial/initiatives/${id}/transitions`).expect(200)).body).toEqual([
        { to: 'SUBMITTED', requiresComment: false },
      ]);
      await autor
        .put(`/initiatives/${id}`)
        .send(initiativeBody({ title: 'Escuela de líderes en atención primaria', termIds: [h.catalog.territoryA], resourceIds: [resourceId] }))
        .expect(204);
      expect((await transition('autor', id, 'SUBMITTED')).status).toBe(200);
    });

    it('aprobar no publica: aprobada, sigue sin ser visible al público', async () => {
      expect((await transition('revisor', id, 'IN_REVIEW')).status).toBe(200);
      expect((await transition('revisor', id, 'APPROVED')).status).toBe(200);

      await h.visitor().get(`/public/initiatives/${id}`).expect(404);
      expect((await h.visitor().get('/public/initiatives').expect(200)).body.items).toEqual([]);
    });

    it('el revisor publica y la ficha queda visible, sin datos internos ni recursos sin publicar', async () => {
      expect((await transition('revisor', id, 'PUBLISHED')).status).toBe(200);

      const ficha = (await h.visitor().get(`/public/initiatives/${id}`).expect(200)).body;
      expect(ficha).toMatchObject({
        title: 'Escuela de líderes en atención primaria',
        authors: ['Andrea Autora'],
        terms: [{ name: 'Manizales' }],
        resources: [],
      });
      expect(ficha.publishedAt).not.toBeNull();
      // Ni identificadores de usuario ni estado editorial en la ficha publica (H-15).
      expect(Object.keys(ficha)).not.toEqual(expect.arrayContaining(['createdBy', 'state']));
      expect(JSON.stringify(ficha)).not.toContain(h.userId('autor'));
    });

    it('cuando el recurso asociado se publica, la ficha pública lo enlaza', async () => {
      await publish(resourceId, 'resources');
      const ficha = (await h.visitor().get(`/public/initiatives/${id}`).expect(200)).body;
      expect(ficha.resources).toEqual([{ id: resourceId, title: 'Guía de líderes' }]);
    });

    it('cada transición quedó registrada con usuario, fecha y comentario (RF-03)', async () => {
      const history = (await (await h.as('revisor')).get(`/editorial/initiatives/${id}/history`).expect(200)).body;

      expect(history.map((r) => [r.from, r.to, r.actorName])).toEqual([
        ['DRAFT', 'SUBMITTED', 'Andrea Autora'],
        ['SUBMITTED', 'IN_REVIEW', 'Ramiro Revisor'],
        ['IN_REVIEW', 'RETURNED', 'Ramiro Revisor'],
        ['RETURNED', 'SUBMITTED', 'Andrea Autora'],
        ['SUBMITTED', 'IN_REVIEW', 'Ramiro Revisor'],
        ['IN_REVIEW', 'APPROVED', 'Ramiro Revisor'],
        ['APPROVED', 'PUBLISHED', 'Ramiro Revisor'],
      ]);
      expect(history.every((r) => !Number.isNaN(Date.parse(r.createdAt)))).toBe(true);
    });

    it('y en la bitácora de auditoría, con quién, qué, sobre qué y cuándo (RF-14)', async () => {
      const audits = (
        await (await h.as('admin')).get('/admin/audits').query({ objectType: 'initiatives', objectId: id, pageSize: 50 }).expect(200)
      ).body;

      const transitions = audits.items.filter((a) => a.action === 'editorial.transition');
      expect(transitions).toHaveLength(7);
      expect(transitions[0]).toMatchObject({
        actorId: h.userId('revisor'),
        actorName: 'Ramiro Revisor',
        objectType: 'initiatives',
        objectId: id,
        source: 'api',
        minimalDetail: { from: 'APPROVED', to: 'PUBLISHED' },
      });
      expect(audits.items.map((a) => a.action)).toEqual(expect.arrayContaining(['initiative.created', 'initiative.updated']));
    });

    it('publicada, sale de la bandeja de revisión', async () => {
      expect((await (await h.as('revisor')).get('/editorial/queue').expect(200)).body).toEqual([]);
    });

    it('el autor marca sus notificaciones como leídas; las de otra persona no las toca', async () => {
      const autor = await h.as('autor');
      const { items } = (await autor.get('/me/notifications').expect(200)).body;
      expect(items.at(-1).type).toBe('EDITORIAL_TRANSITION');
      expect(items[0].type).toBe('CONTENT_PUBLISHED');

      await (await h.as('autor2')).post(`/me/notifications/${items[0].id}/read`).expect(404);
      await autor.post(`/me/notifications/${items[0].id}/read`).expect(204);
      expect((await autor.get('/me/notifications')).body.items[0].readAt).not.toBeNull();

      await autor.post('/me/notifications/read-all').expect(204);
      expect((await autor.get('/me/notifications')).body.unread).toBe(0);
    });
  });

  describe('atomicidad: estado, revisión, bitácora y aviso se escriben juntos o no se escribe nada', () => {
    it('si falla el registro en la bitácora, la iniciativa no cambia de estado', async () => {
      const id = await create();
      const failure = jest.spyOn(h.app.get(AUDIT_LOG), 'record').mockRejectedValueOnce(new Error('falla simulada de la bitácora'));

      try {
        expect((await transition('autor', id, 'SUBMITTED')).status).toBe(500);
      } finally {
        failure.mockRestore();
      }

      const [{ state, reviews }] = await h.owner.query(
        `SELECT i.editorial_status AS state,
                (SELECT count(*)::int FROM editorial_reviews r WHERE r.initiative_id = i.id) AS reviews
           FROM initiatives i WHERE i.id = $1`,
        [id],
      );
      expect(state).toBe('DRAFT');
      expect(reviews).toBe(0);

      // Sin la falla, la misma transicion si se registra completa.
      expect((await transition('autor', id, 'SUBMITTED')).status).toBe(200);
    });

    it('si la operación falla después de escribir la bitácora, la entrada de bitácora tampoco queda', async () => {
      const id = await create();
      const audit = h.app.get(AUDIT_LOG);
      const record = audit.record.bind(audit);
      const failure = jest.spyOn(audit, 'record').mockImplementationOnce(async (entry, tx) => {
        await record(entry, tx);
        throw new Error('falla simulada después de la bitácora');
      });

      try {
        expect((await transition('autor', id, 'SUBMITTED')).status).toBe(500);
      } finally {
        failure.mockRestore();
      }

      const actions = await h.owner.query(`SELECT action FROM audit_logs WHERE object_id = $1`, [id]);
      expect(actions).toEqual([{ action: 'initiative.created' }]);
      const [{ state }] = await h.owner.query(`SELECT editorial_status AS state FROM initiatives WHERE id = $1`, [id]);
      expect(state).toBe('DRAFT');
    });

    it('si dos revisores toman la misma iniciativa a la vez, solo una transición queda registrada', async () => {
      const id = await create();
      await transition('autor', id, 'SUBMITTED');

      const results = await Promise.all([transition('revisor', id, 'IN_REVIEW'), transition('admin', id, 'IN_REVIEW')]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const [{ count }] = await h.owner.query(
        `SELECT count(*)::int AS count FROM editorial_reviews WHERE initiative_id = $1 AND to_status = 'IN_REVIEW'`,
        [id],
      );
      expect(count).toBe(1);
    });
  });

  describe('el flujo se lee de la tabla de transiciones (H-14)', () => {
    it('desactivar una transición en la tabla la vuelve inválida, sin tocar código', async () => {
      const id = await create();
      const toggle = (active: boolean) =>
        h.owner.query(`UPDATE editorial_transitions SET active = $1 WHERE from_status = 'DRAFT' AND to_status = 'SUBMITTED'`, [active]);

      await toggle(false);
      try {
        const response = await transition('autor', id, 'SUBMITTED');
        expect(response.status).toBe(409);
        expect(response.body.code).toBe('transicion_no_permitida');
      } finally {
        await toggle(true);
      }
      expect((await transition('autor', id, 'SUBMITTED')).status).toBe(200);
    });
  });

  describe('validación de la iniciativa', () => {
    it.each([
      ['sin título', { title: undefined }],
      ['título demasiado corto', { title: 'ab' }],
      ['tipo fuera del catálogo', { type: 'OCURRENCIA' }],
      ['fecha con formato inválido', { startDate: '09/03/2026' }],
      ['término que no es un identificador', { termIds: ['atencion-primaria'] }],
      ['campo no declarado', { editorialStatus: 'PUBLISHED' }],
    ])('rechaza %s', async (_name, overrides) => {
      await (await h.as('autor')).post('/initiatives').send(initiativeBody(overrides)).expect(400);
    });

    it('rechaza una fecha final anterior a la inicial', async () => {
      const response = await (await h.as('autor'))
        .post('/initiatives')
        .send(initiativeBody({ startDate: '2026-05-01', endDate: '2026-04-30' }))
        .expect(422);
      expect(response.body.code).toBe('fechas_incoherentes');
    });

    it('rechaza un término que no existe y no deja la iniciativa a medias', async () => {
      const before = (await h.owner.query(`SELECT count(*)::int AS n FROM initiatives`))[0].n;

      const response = await (await h.as('autor'))
        .post('/initiatives')
        .send(initiativeBody({ termIds: ['00000000-0000-4000-8000-000000000000'] }))
        .expect(422);

      expect(response.body.code).toBe('catalogo_invalido');
      expect((await h.owner.query(`SELECT count(*)::int AS n FROM initiatives`))[0].n).toBe(before);
    });

    it('no adjunta el borrador de un recurso ajeno', async () => {
      const ajeno = await draftResource(await h.as('autor2'), { title: 'Recurso ajeno' });
      const response = await (await h.as('autor')).post('/initiatives').send(initiativeBody({ resourceIds: [ajeno] })).expect(422);
      expect(response.body.code).toBe('contenido_invalido');
    });

    it('un identificador con formato inválido responde 400, no un error del servidor', async () => {
      await (await h.as('autor')).get('/initiatives/no-es-un-uuid').expect(400);
      await h.visitor().get("/public/initiatives/1' OR '1'='1").expect(400);
    });
  });

  describe('portal público: búsqueda y filtros (RF-10)', () => {
    beforeAll(async () => {
      await h.owner.query(`TRUNCATE initiatives CASCADE`);
      for (const data of [
        { title: 'Atención primaria en el territorio', summary: 'Rutas de atención.', termIds: [h.catalog.themeA, h.catalog.territoryA] },
        { title: 'Salud mental en colegios', summary: 'Acompañamiento a estudiantes y docentes.', termIds: [h.catalog.themeB], type: 'PROGRAM' },
        { title: 'Huertas escolares', summary: 'Educación nutricional.', termIds: [] },
      ]) {
        await publish(await create(data));
      }
      await create({ title: 'Atención primaria: borrador sin publicar' });
    });

    const search = async (query: Record<string, unknown>) => (await h.visitor().get('/public/initiatives').query(query).expect(200)).body;

    it('solo lista lo publicado', async () => {
      const result = await search({});
      expect(result.total).toBe(3);
      expect(result.items.map((i) => i.title)).not.toContain('Atención primaria: borrador sin publicar');
    });

    it('"atencion primaria" sin tildes encuentra "Atención primaria"', async () => {
      expect((await search({ q: 'atencion primaria' })).items.map((i) => i.title)).toEqual(['Atención primaria en el territorio']);
    });

    it('reconoce raíces en español: "huerta" encuentra "Huertas"', async () => {
      expect((await search({ q: 'huerta' })).items.map((i) => i.title)).toEqual(['Huertas escolares']);
    });

    it('filtra por tema, territorio y tipo, y los filtros se combinan', async () => {
      expect((await search({ themeId: h.catalog.themeB })).items.map((i) => i.title)).toEqual(['Salud mental en colegios']);
      expect((await search({ territoryId: h.catalog.territoryA })).total).toBe(1);
      expect((await search({ type: 'PROGRAM' })).items.map((i) => i.title)).toEqual(['Salud mental en colegios']);
      expect((await search({ themeId: h.catalog.themeB, territoryId: h.catalog.territoryA })).total).toBe(0);
    });

    it('filtrar por un departamento encuentra lo clasificado en sus municipios', async () => {
      expect((await search({ territoryId: h.catalog.territoryParent })).items.map((i) => i.title)).toEqual([
        'Atención primaria en el territorio',
      ]);
    });

    it('sin resultados responde una página vacía, no un error', async () => {
      expect(await search({ q: 'astronomia' })).toEqual({ items: [], total: 0, page: 1, pageSize: 12 });
    });

    it('pagina de forma estable: las páginas no se solapan y juntas dan el total', async () => {
      const first = await search({ pageSize: 2, page: 1 });
      const second = await search({ pageSize: 2, page: 2 });

      expect(first.total).toBe(3);
      expect(first.items).toHaveLength(2);
      expect(second.items).toHaveLength(1);
      expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(3);
    });

    it('trata el texto de búsqueda como dato, no como SQL', async () => {
      expect((await search({ q: "'; DROP TABLE initiatives; --" })).total).toBe(0);
      expect((await search({})).total).toBe(3);
    });
  });
});
