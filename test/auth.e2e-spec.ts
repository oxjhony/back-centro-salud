import { createHarness, emailFor, Harness, PASSWORD } from './support/harness';

/** RF-01, RF-02 · H-01, H-02, H-03: identidad, sesion, perfil minimo y asignacion de roles. */
describe('Autenticación, sesión y perfil', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  const login = (email: string, password: string) => h.visitor().post('/auth/login').send({ email, password });

  describe('inicio de sesión', () => {
    it('con credenciales válidas devuelve el usuario con sus roles y permisos', async () => {
      const response = await login(emailFor('autor'), PASSWORD).expect(200);

      expect(response.body.user).toMatchObject({
        email: emailFor('autor'),
        displayName: 'Andrea Autora',
        roles: ['AUTHOR'],
        permissions: ['content:submit', 'initiative:manage', 'resource:manage'],
      });
    });

    it('entrega la sesión en una cookie httpOnly y SameSite, ilegible desde JavaScript', async () => {
      const response = await login(emailFor('autor'), PASSWORD).expect(200);

      const cookie = ([] as string[]).concat(response.headers['set-cookie']).find((c) => c.startsWith('cvsp_session='));
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(JSON.stringify(response.body)).not.toContain(cookie.split(';')[0].split('=')[1]);
    });

    it('rechaza una contraseña incorrecta sin revelar si la cuenta existe', async () => {
      const wrongPassword = await login(emailFor('autor'), 'incorrecta').expect(401);
      const unknownAccount = await login('nadie@prueba.local', PASSWORD).expect(401);

      expect(wrongPassword.body.code).toBe('credenciales_invalidas');
      expect(unknownAccount.body).toEqual(wrongPassword.body);
      expect(wrongPassword.headers['set-cookie']).toBeUndefined();
    });

    it('deja en la bitácora el ingreso, y el intento fallido sin guardar el correo', async () => {
      await login(emailFor('revisor'), PASSWORD).expect(200);
      await login('intruso@prueba.local', 'x').expect(401);

      const audits = await h.owner.query(
        `SELECT action, actor_id, minimal_detail FROM audit_logs WHERE action LIKE 'auth.%' ORDER BY occurred_at DESC LIMIT 2`,
      );
      expect(audits[0]).toEqual({ action: 'auth.login_failed', actor_id: null, minimal_detail: null });
      expect(audits[1]).toMatchObject({ action: 'auth.login', actor_id: h.userId('revisor') });
      expect(JSON.stringify(audits)).not.toContain('intruso');
    });

    it('registra la fecha del último ingreso', async () => {
      await login(emailFor('gestor'), PASSWORD).expect(200);
      const [{ last_login_at }] = await h.owner.query(`SELECT last_login_at FROM users WHERE id = $1`, [h.userId('gestor')]);
      expect(last_login_at).not.toBeNull();
    });

    it('rechaza un cuerpo con campos no declarados', async () => {
      await h
        .visitor()
        .post('/auth/login')
        .send({ email: emailFor('autor'), password: PASSWORD, roles: ['FUNCTIONAL_ADMIN'] })
        .expect(400);
    });
  });

  describe('sesión', () => {
    it('/auth/me sin sesión responde user: null, no un error', async () => {
      expect((await h.visitor().get('/auth/me').expect(200)).body).toEqual({ user: null });
    });

    it('/auth/me con sesión devuelve al usuario', async () => {
      const response = await (await h.as('gestor')).get('/auth/me').expect(200);
      expect(response.body.user).toMatchObject({
        roles: ['ACADEMIC_MANAGER'],
        permissions: ['content:submit', 'course:manage', 'resource:manage'],
      });
    });

    it('una ruta protegida sin sesión responde 401', async () => {
      const response = await h.visitor().get('/initiatives/mine').expect(401);
      expect(response.body.code).toBe('sesion_requerida');
    });

    it('una cookie manipulada no abre sesión', async () => {
      await h.visitor().get('/initiatives/mine').set('Cookie', 'cvsp_session=eyJhbGciOiJIUzI1NiJ9.e30.firma-falsa').expect(401);
    });

    it('una cookie firmada con otro secreto no abre sesión', async () => {
      const { JwtService } = await import('@nestjs/jwt');
      const forged = await new JwtService({ secret: 'otro-secreto' }).signAsync({ sub: h.userId('admin') });
      await h.visitor().get('/admin/users').set('Cookie', `cvsp_session=${forged}`).expect(401);
    });

    it('cerrar sesión borra la cookie y la ruta protegida vuelve a exigir sesión', async () => {
      const agent = h.visitor();
      await agent.post('/auth/login').send({ email: emailFor('autor'), password: PASSWORD }).expect(200);
      await agent.get('/initiatives/mine').expect(200);

      await agent.post('/auth/logout').expect(204);
      await agent.get('/initiatives/mine').expect(401);
    });

    it.each(['INACTIVE', 'SUSPENDED'])('una cuenta %s pierde la sesión de inmediato y no puede volver a entrar', async (status) => {
      const agent = h.visitor();
      await agent.post('/auth/login').send({ email: emailFor('usuario'), password: PASSWORD }).expect(200);
      expect((await agent.get('/auth/me')).body.user).not.toBeNull();

      await h.owner.query(`UPDATE users SET status = $2 WHERE id = $1`, [h.userId('usuario'), status]);
      try {
        expect((await agent.get('/auth/me')).body.user).toBeNull();
        expect((await login(emailFor('usuario'), PASSWORD).expect(403)).body.code).toBe('cuenta_inactiva');
      } finally {
        await h.owner.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [h.userId('usuario')]);
      }
    });

    it('la primera vez que entra una identidad nueva se crea con el rol REGISTERED', async () => {
      await h.owner.query(`DELETE FROM users WHERE id = $1`, [h.userId('usuario')]);
      const response = await login(emailFor('usuario'), PASSWORD).expect(200);
      expect(response.body.user).toMatchObject({ roles: ['REGISTERED'], permissions: [] });
      const [{ count }] = await h.owner.query(`SELECT count(*)::int AS count FROM user_profiles WHERE user_id = $1`, [response.body.user.id]);
      expect(count).toBe(1);
    });
  });

  describe('perfil mínimo (RF-02)', () => {
    it('la persona consulta su perfil sin datos sensibles', async () => {
      const profile = (await (await h.as('autor')).get('/me/profile').expect(200)).body;
      expect(profile).toEqual({
        email: emailFor('autor'),
        displayName: 'Andrea Autora',
        affiliation: null,
        generalTerritory: null,
        interests: [],
        notificationOptIn: false,
        updatedAt: expect.any(String),
      });
    });

    it('lo corrige, y la bitácora guarda qué campos cambiaron pero no sus valores', async () => {
      const autor = await h.as('autor');
      const updated = (
        await autor
          .put('/me/profile')
          .send({
            displayName: 'Andrea Autora',
            affiliation: 'Universidad de Caldas',
            generalTerritory: 'Caldas',
            interests: ['salud mental', ' salud mental ', 'nutrición'],
            notificationOptIn: true,
          })
          .expect(200)
      ).body;
      expect(updated).toMatchObject({ affiliation: 'Universidad de Caldas', interests: ['salud mental', 'nutrición'], notificationOptIn: true });

      const [audit] = await h.owner.query(
        `SELECT minimal_detail FROM audit_logs WHERE action = 'profile.updated' ORDER BY occurred_at DESC LIMIT 1`,
      );
      expect(audit.minimal_detail).toEqual({ fields: ['affiliation', 'generalTerritory', 'interests', 'notificationOptIn'] });
      expect(JSON.stringify(audit)).not.toContain('Universidad');
    });

    it('puede borrar sus datos opcionales', async () => {
      const autor = await h.as('autor');
      const cleared = (await autor.delete('/me/profile/optional-data').expect(200)).body;
      expect(cleared).toMatchObject({ affiliation: null, generalTerritory: null, interests: [], notificationOptIn: false });
    });

    it('rechaza campos que el perfil no tiene', async () => {
      await (await h.as('autor'))
        .put('/me/profile')
        .send({ displayName: 'Andrea', interests: [], notificationOptIn: false, documento: '123' })
        .expect(400);
    });

    it('sin sesión no hay perfil', async () => {
      await h.visitor().get('/me/profile').expect(401);
    });
  });

  describe('portal público (H-01)', () => {
    it.each([
      '/health/live',
      '/health/ready',
      '/catalogs',
      '/public/search',
      '/public/initiatives',
      '/public/resources',
      '/public/courses',
    ])('%s responde sin sesión', async (path) => {
      await h.visitor().get(path).expect(200);
    });
  });

  describe('administración de cuentas (H-03)', () => {
    it('los siete roles del modelo existen, con sus permisos', async () => {
      const response = await (await h.as('admin')).get('/admin/roles').expect(200);
      expect(response.body.map((r) => r.name)).toEqual([
        'VISITOR',
        'REGISTERED',
        'AUTHOR',
        'REVIEWER',
        'ACADEMIC_MANAGER',
        'FUNCTIONAL_ADMIN',
        'TECHNICAL_ADMIN',
      ]);
      expect(response.body.find((r) => r.name === 'VISITOR').assignable).toBe(false);
      expect(response.body.find((r) => r.name === 'TECHNICAL_ADMIN').permissions).toEqual(['audit:view', 'integration:operate']);
    });

    it('el administrador asigna un rol, surte efecto en la sesión abierta y queda en la bitácora', async () => {
      const admin = await h.as('admin');
      const target = h.visitor();
      await target.post('/auth/login').send({ email: emailFor('autor2'), password: PASSWORD }).expect(200);
      await target.get('/courses/mine').expect(403);

      await admin.put(`/admin/users/${h.userId('autor2')}/roles`).send({ roles: ['AUTHOR', 'ACADEMIC_MANAGER'] }).expect(204);

      await target.get('/courses/mine').expect(200);
      const [audit] = await h.owner.query(
        `SELECT actor_id, object_id, minimal_detail FROM audit_logs WHERE action = 'user.roles_assigned' ORDER BY occurred_at DESC LIMIT 1`,
      );
      expect(audit).toEqual({
        actor_id: h.userId('admin'),
        object_id: h.userId('autor2'),
        minimal_detail: { before: ['AUTHOR'], after: ['ACADEMIC_MANAGER', 'AUTHOR'] },
      });

      await admin.put(`/admin/users/${h.userId('autor2')}/roles`).send({ roles: ['AUTHOR'] }).expect(204);
      await target.get('/courses/mine').expect(403);
    });

    it('las asignaciones quedan en el contexto SYSTEM, con quién las hizo', async () => {
      const rows = await h.owner.query(
        `SELECT context_level, context_id, assigned_by FROM role_assignments WHERE user_id = $1`,
        [h.userId('autor2')],
      );
      expect(rows).toEqual([{ context_level: 'SYSTEM', context_id: null, assigned_by: h.userId('admin') }]);
    });

    it('el administrador suspende una cuenta y la reactiva', async () => {
      const admin = await h.as('admin');
      await admin.put(`/admin/users/${h.userId('autor2')}/status`).send({ status: 'SUSPENDED' }).expect(204);
      await login(emailFor('autor2'), PASSWORD).expect(403);

      await admin.put(`/admin/users/${h.userId('autor2')}/status`).send({ status: 'ACTIVE' }).expect(204);
      await login(emailFor('autor2'), PASSWORD).expect(200);

      const users = (await admin.get('/admin/users').expect(200)).body;
      expect(users.find((u) => u.id === h.userId('autor2'))).toMatchObject({ status: 'ACTIVE', roles: ['AUTHOR'] });
    });

    it('nadie cambia sus propios roles ni su propio estado', async () => {
      const admin = await h.as('admin');
      const roles = await admin.put(`/admin/users/${h.userId('admin')}/roles`).send({ roles: ['FUNCTIONAL_ADMIN', 'AUTHOR'] }).expect(403);
      expect(roles.body.code).toBe('autoasignacion');
      await admin.put(`/admin/users/${h.userId('admin')}/status`).send({ status: 'INACTIVE' }).expect(403);
    });

    it('rechaza un rol inexistente, el rol VISITOR y un estado fuera del modelo', async () => {
      const admin = await h.as('admin');
      await admin.put(`/admin/users/${h.userId('usuario')}/roles`).send({ roles: ['SUPERUSER'] }).expect(422);
      await admin.put(`/admin/users/${h.userId('usuario')}/roles`).send({ roles: ['VISITOR'] }).expect(422);
      await admin.put(`/admin/users/${h.userId('usuario')}/status`).send({ status: 'BORRADO' }).expect(400);
    });

    it('un usuario inexistente responde 404', async () => {
      const admin = await h.as('admin');
      const missing = '00000000-0000-4000-8000-000000000000';
      await admin.put(`/admin/users/${missing}/roles`).send({ roles: ['AUTHOR'] }).expect(404);
      await admin.put(`/admin/users/${missing}/status`).send({ status: 'INACTIVE' }).expect(404);
    });
  });
});
