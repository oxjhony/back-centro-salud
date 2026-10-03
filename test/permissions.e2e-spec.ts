import {
  Account,
  courseBody,
  createHarness,
  draftResource,
  Harness,
  initiativeBody,
  resourceBody,
  ROLE_ACCOUNTS,
  Session,
} from './support/harness';

/**
 * Matriz rol x operacion (RF-01, H-04; Plan de pruebas 5.2).
 *
 * Cada celda se prueba por API: quien tiene el permiso puede (caso positivo) y quien no lo
 * tiene recibe 403, o 401 si no hay sesion (caso negativo). La interfaz no interviene: ocultar
 * un boton no es el control de acceso.
 */
describe('Matriz de permisos', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  type Call = (session: Session) => Promise<{ status: number; body: any }>;
  type Actor = Account | 'visitante';
  const actors: Actor[] = [...ROLE_ACCOUNTS, 'visitante'];
  const sessionOf = async (actor: Actor) => (actor === 'visitante' ? h.visitor() : h.as(actor));
  const denied = (actor: Actor) => (actor === 'visitante' ? 401 : 403);
  const everyoneWithSession: Account[] = [...ROLE_ACCOUNTS];

  describe('operaciones', () => {
    const operations: { name: string; allowed: Account[]; success: number; call: Call }[] = [
      { name: 'crear una iniciativa', allowed: ['autor'], success: 201, call: (s) => s.post('/initiatives').send(initiativeBody()) },
      { name: 'listar mis iniciativas', allowed: ['autor'], success: 200, call: (s) => s.get('/initiatives/mine') },
      { name: 'crear un recurso', allowed: ['autor', 'gestor'], success: 201, call: (s) => s.post('/resources').send(resourceBody()) },
      { name: 'listar mis recursos', allowed: ['autor', 'gestor'], success: 200, call: (s) => s.get('/resources/mine') },
      { name: 'crear una ficha de curso', allowed: ['gestor'], success: 201, call: (s) => s.post('/courses').send(courseBody()) },
      { name: 'listar mis fichas de curso', allowed: ['gestor'], success: 200, call: (s) => s.get('/courses/mine') },
      { name: 'ver la bandeja de revisión', allowed: ['revisor', 'admin'], success: 200, call: (s) => s.get('/editorial/queue') },
      { name: 'consultar mi perfil', allowed: everyoneWithSession, success: 200, call: (s) => s.get('/me/profile') },
      { name: 'consultar mis notificaciones', allowed: everyoneWithSession, success: 200, call: (s) => s.get('/me/notifications') },
      { name: 'listar recursos asociables', allowed: everyoneWithSession, success: 200, call: (s) => s.get('/resources/linkable') },
      { name: 'listar usuarios', allowed: ['admin'], success: 200, call: (s) => s.get('/admin/users') },
      { name: 'listar roles', allowed: ['admin'], success: 200, call: (s) => s.get('/admin/roles') },
      {
        name: 'asignar roles a un usuario',
        allowed: ['admin'],
        success: 204,
        call: (s) => s.put(`/admin/users/${h.userId('autor2')}/roles`).send({ roles: ['AUTHOR'] }),
      },
      {
        name: 'cambiar el estado de una cuenta',
        allowed: ['admin'],
        success: 204,
        call: (s) => s.put(`/admin/users/${h.userId('autor2')}/status`).send({ status: 'ACTIVE' }),
      },
      { name: 'administrar la taxonomía', allowed: ['admin'], success: 200, call: (s) => s.get('/admin/taxonomy') },
      {
        name: 'crear un término de la taxonomía',
        allowed: ['admin'],
        success: 201,
        call: (s) => s.post('/admin/taxonomy').send({ type: 'TAG', name: `Etiqueta ${Math.random().toString(36).slice(2)}` }),
      },
      { name: 'consultar la bitácora de auditoría', allowed: ['admin', 'tecnico'], success: 200, call: (s) => s.get('/admin/audits') },
      {
        name: 'consultar el registro de integraciones',
        allowed: ['admin', 'tecnico'],
        success: 200,
        call: (s) => s.get('/admin/integration-logs'),
      },
      {
        name: 'lanzar la conciliación con Moodle',
        allowed: ['admin', 'tecnico'],
        success: 200,
        call: (s) => s.post('/admin/moodle/reconcile'),
      },
    ];

    for (const operation of operations) {
      describe(operation.name, () => {
        it.each(actors)('%s', async (actor) => {
          const response = await operation.call(await sessionOf(actor));
          const expected = operation.allowed.includes(actor as Account) ? operation.success : denied(actor);
          expect(response.status).toBe(expected);
        });
      });
    }
  });

  describe('transiciones editoriales', () => {
    // Cada fila: estado de origen, destino, comentario si la transicion lo exige, y quien puede.
    // El contenido es de 'autor'; por eso 'autor' es el unico que puede enviarlo.
    const transitions: { from: string; to: string; comment?: string; allowed: Account[] }[] = [
      { from: 'DRAFT', to: 'SUBMITTED', allowed: ['autor'] },
      { from: 'RETURNED', to: 'SUBMITTED', allowed: ['autor'] },
      { from: 'SUBMITTED', to: 'IN_REVIEW', allowed: ['revisor', 'admin'] },
      { from: 'IN_REVIEW', to: 'RETURNED', comment: 'Falta el territorio.', allowed: ['revisor', 'admin'] },
      { from: 'IN_REVIEW', to: 'APPROVED', allowed: ['revisor', 'admin'] },
      { from: 'IN_REVIEW', to: 'ARCHIVED', comment: 'Fuera del alcance.', allowed: ['revisor', 'admin'] },
      { from: 'APPROVED', to: 'PUBLISHED', allowed: ['revisor', 'admin'] },
      { from: 'PUBLISHED', to: 'ARCHIVED', comment: 'Dejó de estar vigente.', allowed: ['admin'] },
      { from: 'ARCHIVED', to: 'DRAFT', comment: 'Se reactiva.', allowed: ['admin'] },
    ];

    for (const entity of ['initiatives', 'resources'] as const) {
      describe(entity, () => {
        let id: string;

        beforeAll(async () => {
          const autor = await h.as('autor');
          id =
            entity === 'initiatives'
              ? (await autor.post('/initiatives').send(initiativeBody()).expect(201)).body.id
              : await draftResource(autor);
        });

        for (const transition of transitions) {
          describe(`${transition.from} → ${transition.to}`, () => {
            it.each(actors)('%s', async (actor) => {
              await h.forceState(entity, id, transition.from);

              const response = await (await sessionOf(actor))
                .post(`/editorial/${entity}/${id}/transitions`)
                .send({ to: transition.to, comment: transition.comment });

              const allowed = transition.allowed.includes(actor as Account);
              expect(response.status).toBe(allowed ? 200 : denied(actor));

              // Un rechazo no puede dejar el contenido en otro estado.
              const [{ state }] = await h.owner.query(`SELECT editorial_status AS state FROM ${entity} WHERE id = $1`, [id]);
              expect(state).toBe(allowed ? transition.to : transition.from);
            });
          });
        }
      });
    }
  });

  describe('casos explícitos del plan de pruebas', () => {
    let initiativeId: string;

    beforeEach(async () => {
      const created = await (await h.as('autor')).post('/initiatives').send(initiativeBody()).expect(201);
      initiativeId = created.body.id;
    });

    const transition = async (actor: Account, to: string, comment?: string) =>
      (await h.as(actor)).post(`/editorial/initiatives/${initiativeId}/transitions`).send({ to, comment });

    it('el autor intenta aprobar su propia iniciativa: rechazado', async () => {
      await h.forceState('initiatives', initiativeId, 'IN_REVIEW');
      expect((await transition('autor', 'APPROVED')).status).toBe(403);
    });

    it('el autor intenta publicar directamente desde el borrador: rechazado', async () => {
      const response = await transition('autor', 'PUBLISHED');
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('transicion_no_permitida');
    });

    it('el autor intenta publicar su iniciativa ya aprobada: rechazado', async () => {
      await h.forceState('initiatives', initiativeId, 'APPROVED');
      expect((await transition('autor', 'PUBLISHED')).status).toBe(403);
    });

    it('quien es autor y revisor a la vez no revisa, aprueba ni publica lo que escribió', async () => {
      const both = await h.as('autorRevisor');
      const own = (await both.post('/initiatives').send(initiativeBody({ title: 'Iniciativa propia' })).expect(201)).body.id;
      await both.post(`/editorial/initiatives/${own}/transitions`).send({ to: 'SUBMITTED' }).expect(200);

      for (const [from, to] of [['SUBMITTED', 'IN_REVIEW'], ['IN_REVIEW', 'APPROVED'], ['APPROVED', 'PUBLISHED']]) {
        await h.forceState('initiatives', own, from);
        const response = await both.post(`/editorial/initiatives/${own}/transitions`).send({ to });
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('contenido_propio');
      }

      // Pero si revisa lo que escribio otra persona.
      await h.forceState('initiatives', initiativeId, 'SUBMITTED');
      await both.post(`/editorial/initiatives/${initiativeId}/transitions`).send({ to: 'IN_REVIEW' }).expect(200);
    });

    it('el revisor devuelve o rechaza sin comentario: rechazado', async () => {
      await h.forceState('initiatives', initiativeId, 'IN_REVIEW');
      for (const to of ['RETURNED', 'ARCHIVED']) {
        for (const comment of [undefined, '', '   ']) {
          const response = await transition('revisor', to, comment);
          expect(response.status).toBe(422);
          expect(response.body.code).toBe('comentario_obligatorio');
        }
      }
    });

    it('el administrador técnico ejecuta una acción editorial: rechazado en todas', async () => {
      for (const [from, to] of [
        ['SUBMITTED', 'IN_REVIEW'],
        ['IN_REVIEW', 'APPROVED'],
        ['APPROVED', 'PUBLISHED'],
        ['PUBLISHED', 'ARCHIVED'],
      ]) {
        await h.forceState('initiatives', initiativeId, from);
        expect((await transition('tecnico', to, 'comentario')).status).toBe(403);
      }
    });

    it('otro autor no envía, edita ni ve un borrador ajeno', async () => {
      const other = await h.as('autor2');
      expect((await transition('autor2', 'SUBMITTED')).body.code).toBe('no_es_autor');
      await other.put(`/initiatives/${initiativeId}`).send(initiativeBody({ title: 'Título cambiado' })).expect(404);
      await other.get(`/initiatives/${initiativeId}`).expect(404);
      await other.get(`/editorial/initiatives/${initiativeId}/history`).expect(404);
    });

    it('el gestor académico tiene permiso de enviar, pero no envía una iniciativa ajena', async () => {
      const response = await transition('gestor', 'SUBMITTED');
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('no_es_autor');
    });

    it('un visitante no lee un contenido no publicado aunque conozca su URL', async () => {
      for (const state of ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'RETURNED', 'ARCHIVED']) {
        await h.forceState('initiatives', initiativeId, state);
        await h.visitor().get(`/public/initiatives/${initiativeId}`).expect(404);
        await h.visitor().get(`/initiatives/${initiativeId}`).expect(401);
      }
    });

    it('un usuario sin sesión no entra a ninguna ruta de administración', async () => {
      for (const path of ['/admin/users', '/admin/roles', '/admin/taxonomy', '/admin/audits', '/admin/integration-logs']) {
        await h.visitor().get(path).expect(401);
      }
    });

    it('el autor no gestiona cursos y el gestor académico no gestiona iniciativas', async () => {
      await (await h.as('autor')).post('/courses').send(courseBody()).expect(403);
      await (await h.as('gestor')).post('/initiatives').send(initiativeBody()).expect(403);
    });

    it('una entidad que no es publicable no tiene flujo editorial', async () => {
      const response = await (await h.as('revisor')).get(`/editorial/users/${initiativeId}/history`).expect(404);
      expect(response.body.code).toBe('entidad_desconocida');
    });
  });
});
