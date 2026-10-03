import { DataSource } from 'typeorm';
import { createHarness, draftResource, Harness } from './support/harness';

/**
 * Reglas garantizadas por la base de datos (Plan de pruebas 5.4). Se prueban contra la base,
 * intentando violarlas con SQL directo: si solo existieran en el codigo, un script o una
 * migracion podrian evadirlas.
 */
describe('Reglas garantizadas por la base de datos', () => {
  let h: Harness;
  /** Conexion con el mismo rol que usa la aplicacion (privilegios reducidos). */
  let app: DataSource;

  const PERMISSION_DENIED = '42501';
  const CHECK_VIOLATION = '23514';
  const UNIQUE_VIOLATION = '23505';
  const FOREIGN_KEY_VIOLATION = '23503';

  beforeAll(async () => {
    h = await createHarness();
    app = await new DataSource({ type: 'postgres', url: process.env.DATABASE_URL }).initialize();
  });
  afterAll(async () => {
    await app.destroy();
    await h.close();
  });

  const codeOf = async (work: Promise<unknown>): Promise<string> => {
    try {
      await work;
    } catch (error) {
      return (error as { driverError?: { code?: string } }).driverError?.code ?? 'sin-codigo';
    }
    return 'aceptado';
  };

  describe('la bitácora de auditoría no es modificable desde la aplicación (RF-14, H-36)', () => {
    let auditId: string;

    beforeAll(async () => {
      [{ id: auditId }] = await app.query(`INSERT INTO audit_logs (action, source) VALUES ('prueba.regla', 'prueba') RETURNING id`);
    });

    it('el rol de la aplicación puede agregar y consultar entradas', async () => {
      expect(await app.query(`SELECT action FROM audit_logs WHERE id = $1`, [auditId])).toEqual([{ action: 'prueba.regla' }]);
    });

    it('no puede modificarlas', async () => {
      expect(await codeOf(app.query(`UPDATE audit_logs SET action = 'alterada' WHERE id = $1`, [auditId]))).toBe(PERMISSION_DENIED);
    });

    it('no puede borrarlas', async () => {
      expect(await codeOf(app.query(`DELETE FROM audit_logs WHERE id = $1`, [auditId]))).toBe(PERMISSION_DENIED);
      expect(await codeOf(app.query(`TRUNCATE audit_logs`))).toBe(PERMISSION_DENIED);
    });

    it('la entrada sigue intacta', async () => {
      expect(await h.owner.query(`SELECT action FROM audit_logs WHERE id = $1`, [auditId])).toEqual([{ action: 'prueba.regla' }]);
    });
  });

  describe('el registro de integraciones tampoco se reescribe', () => {
    it('la aplicación agrega, pero no modifica ni borra', async () => {
      const [{ id }] = await app.query(
        `INSERT INTO integration_logs (integration, operation, status) VALUES ('moodle', 'prueba', 'ERROR') RETURNING id`,
      );
      expect(await codeOf(app.query(`UPDATE integration_logs SET status = 'OK' WHERE id = $1`, [id]))).toBe(PERMISSION_DENIED);
      expect(await codeOf(app.query(`DELETE FROM integration_logs WHERE id = $1`, [id]))).toBe(PERMISSION_DENIED);
    });
  });

  describe('el flujo editorial, los permisos y las versiones no se alteran desde la aplicación', () => {
    it.each([
      ['las transiciones', `UPDATE editorial_transitions SET forbid_self = false`],
      ['los roles', `UPDATE roles SET description = 'x'`],
      [
        'los permisos de los roles',
        `INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = 'AUTHOR' AND p.code = 'content:publish'`,
      ],
      ['el historial de revisiones', `UPDATE editorial_reviews SET comment = 'reescrito'`],
      ['una versión de un recurso', `UPDATE resource_versions SET checksum = repeat('0', 64)`],
      ['el borrado de una versión', `DELETE FROM resource_versions`],
    ])('%s', async (_name, sql) => {
      expect(await codeOf(app.query(sql))).toBe(PERMISSION_DENIED);
    });
  });

  describe('transiciones editoriales', () => {
    const permission = `(SELECT id FROM permissions WHERE code = 'content:submit')`;

    it('una transición siempre cambia de estado y usa estados del modelo', async () => {
      for (const [from, to] of [['DRAFT', 'DRAFT'], ['DRAFT', 'REJECTED']]) {
        const sql = `INSERT INTO editorial_transitions (from_status, to_status, required_permission_id) VALUES ('${from}', '${to}', ${permission})`;
        expect(await codeOf(h.owner.query(sql))).toBe(CHECK_VIOLATION);
      }
    });

    it('no admite dos reglas para la misma transición', async () => {
      const sql = `INSERT INTO editorial_transitions (from_status, to_status, required_permission_id) VALUES ('DRAFT', 'SUBMITTED', ${permission})`;
      expect(await codeOf(h.owner.query(sql))).toBe(UNIQUE_VIOLATION);
    });

    it('existen las nueve transiciones del modelo y todos los estados son alcanzables', async () => {
      const transitions = await h.owner.query(`SELECT from_status AS de, to_status AS a FROM editorial_transitions`);
      expect(transitions).toHaveLength(9);
      const reachable = new Set(['DRAFT', ...transitions.map((t) => t.a)]);
      expect(['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'RETURNED', 'ARCHIVED'].filter((s) => !reachable.has(s))).toEqual([]);
    });

    it('una revisión apunta exactamente a un contenido', async () => {
      const resourceId = await draftResource(await h.as('autor'));
      const insert = (targets: string) =>
        h.owner.query(
          `INSERT INTO editorial_reviews (${targets}, from_status, to_status, actor_id)
           VALUES (${targets.split(',').map(() => `'${resourceId}'`).join(', ')}, 'DRAFT', 'SUBMITTED', $1)`,
          [h.userId('autor')],
        );
      expect(await codeOf(insert('resource_id'))).toBe('aceptado');
      expect(await codeOf(insert('resource_id, course_id'))).toBe(CHECK_VIOLATION);
      expect(
        await codeOf(h.owner.query(`INSERT INTO editorial_reviews (from_status, to_status, actor_id) VALUES ('DRAFT', 'SUBMITTED', $1)`, [h.userId('autor')])),
      ).toBe(CHECK_VIOLATION);
    });

    it('un contenido publicado tiene fecha de publicación', async () => {
      const resourceId = await draftResource(await h.as('autor'));
      expect(await codeOf(h.owner.query(`UPDATE resources SET editorial_status = 'PUBLISHED' WHERE id = $1`, [resourceId]))).toBe(CHECK_VIOLATION);
    });
  });

  describe('fichas de curso', () => {
    const insertCourse = (columns: Record<string, unknown>) => {
      const data = { title: 'Curso de prueba', summary: 'Resumen.', type: 'COURSE', modality: 'VIRTUAL', created_by: h.userId('gestor'), ...columns };
      const names = Object.keys(data);
      return h.owner.query(
        `INSERT INTO courses (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`,
        Object.values(data),
      );
    };
    const linked = { moodle_external_id: 'cvsp-regla' };

    beforeEach(() => h.owner.query(`TRUNCATE courses CASCADE`));

    it('acepta una ficha sin enlace y una con enlace verificado completo', async () => {
      expect(await codeOf(insertCourse({}))).toBe('aceptado');
      expect(
        await codeOf(insertCourse({ ...linked, lms_link_status: 'VERIFIED', lms_url: 'http://m/course/view.php?id=42', lms_verified_at: new Date() })),
      ).toBe('aceptado');
    });

    it.each([
      ['enlace verificado sin URL ni fecha de verificación', { ...linked, lms_link_status: 'VERIFIED' }],
      ['idnumber vacío', { moodle_external_id: '   ', lms_link_status: 'PENDING' }],
      ['idnumber presente pero marcada como no enlazada', { ...linked, lms_link_status: 'NOT_LINKED' }],
      ['sin idnumber pero marcada como verificada', { lms_link_status: 'VERIFIED' }],
      ['estado de enlace fuera del modelo', { ...linked, lms_link_status: 'ROTO' }],
      ['fecha final anterior a la inicial', { start_date: '2026-05-01', end_date: '2026-04-30' }],
      ['cupo en cero', { capacity: 0 }],
      ['modalidad fuera del modelo', { modality: 'TELEPATHIC' }],
      ['tipo fuera del modelo', { type: 'SEMINAR' }],
    ])('rechaza: %s', async (_name, columns) => {
      expect(await codeOf(insertCourse(columns))).toBe(CHECK_VIOLATION);
    });

    it('una ficha siempre tiene responsable', async () => {
      expect(await codeOf(insertCourse({ created_by: null }))).toBe('23502');
    });

    it('dos fichas no pueden apuntar al mismo curso de Moodle', async () => {
      await insertCourse({ ...linked, lms_link_status: 'PENDING' });
      expect(await codeOf(insertCourse({ ...linked, title: 'Segunda ficha', lms_link_status: 'PENDING' }))).toBe(UNIQUE_VIOLATION);
    });
  });

  describe('taxonomía', () => {
    it('no admite el mismo nombre dos veces bajo el mismo padre, sin importar tildes ni mayúsculas', async () => {
      expect(
        await codeOf(h.owner.query(`INSERT INTO taxonomy_terms (type, name, parent_id) VALUES ('TERRITORY', 'MANIZALES', $1)`, [h.catalog.territoryParent])),
      ).toBe(UNIQUE_VIOLATION);
      expect(await codeOf(h.owner.query(`INSERT INTO taxonomy_terms (type, name) VALUES ('THEME', 'atencion primaria en salud')`))).toBe(UNIQUE_VIOLATION);
    });

    it('el padre es del mismo tipo', async () => {
      expect(
        await codeOf(h.owner.query(`INSERT INTO taxonomy_terms (type, name, parent_id) VALUES ('THEME', 'Subtema', $1)`, [h.catalog.territoryParent])),
      ).toBe(FOREIGN_KEY_VIOLATION);
    });

    it('un término en uso no se puede borrar', async () => {
      const resourceId = await draftResource(await h.as('autor'), { termIds: [h.catalog.resourceTypeA] });
      expect(resourceId).toBeDefined();
      expect(await codeOf(app.query(`DELETE FROM taxonomy_terms WHERE id = $1`, [h.catalog.resourceTypeA]))).toBe(FOREIGN_KEY_VIOLATION);
    });
  });

  describe('identidad', () => {
    it('no admite dos usuarios con el mismo correo ni con la misma identidad externa', async () => {
      expect(await codeOf(h.owner.query(`INSERT INTO users (email, display_name) SELECT email, 'x' FROM users LIMIT 1`))).toBe(UNIQUE_VIOLATION);
      expect(
        await codeOf(
          h.owner.query(`INSERT INTO users (email, display_name, external_subject_id) SELECT 'otro@prueba.local', 'x', external_subject_id FROM users LIMIT 1`),
        ),
      ).toBe(UNIQUE_VIOLATION);
    });

    it('la tabla de usuarios no tiene ninguna columna de contraseña', async () => {
      const columns = await h.owner.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`);
      expect(columns.map((c) => c.column_name).filter((name) => /pass|clave|contrase|secret|hash/i.test(name))).toEqual([]);
    });

    it('una asignación de sistema no lleva contexto, y una de contexto sí lo lleva', async () => {
      const assign = (level: string, contextId: string | null) =>
        h.owner.query(
          `INSERT INTO role_assignments (user_id, role_id, context_level, context_id) SELECT $1, id, $2, $3 FROM roles WHERE name = 'REVIEWER'`,
          [h.userId('usuario'), level, contextId],
        );
      expect(await codeOf(assign('SYSTEM', '00000000-0000-4000-8000-000000000000'))).toBe(CHECK_VIOLATION);
      expect(await codeOf(assign('COURSE', null))).toBe(CHECK_VIOLATION);
      expect(await codeOf(assign('COURSE', '00000000-0000-4000-8000-000000000000'))).toBe('aceptado');
    });

    it('un rol asignado en un contexto no da permisos en toda la plataforma', async () => {
      const response = await (await h.as('usuario')).get('/editorial/queue');
      expect(response.status).toBe(403);
    });

    it('el rol de la aplicación no se otorga roles ni permisos nuevos', async () => {
      expect(await codeOf(app.query(`INSERT INTO roles (name, description) VALUES ('VISITOR', 'x')`))).toBe(PERMISSION_DENIED);
      expect(await codeOf(app.query(`INSERT INTO permissions (code, description) VALUES ('todo:hacer', 'x')`))).toBe(PERMISSION_DENIED);
    });
  });

  describe('participación moderada', () => {
    it('un aporte sin consentimiento no se guarda y ninguno nace aprobado', async () => {
      const [{ id }] = await h.owner.query(
        `INSERT INTO consultations (title, purpose, questions, open_from, privacy_notice) VALUES ('C', 'P', ARRAY['¿Qué opinas?'], '2026-10-01', 'Aviso') RETURNING id`,
      );
      const contribute = (consent: boolean, code: string) =>
        h.owner.query(`INSERT INTO contributions (consultation_id, answers, consent, identifier) VALUES ($1, ARRAY['Sí'], $2, $3) RETURNING moderation_status`, [
          id,
          consent,
          code,
        ]);
      expect(await codeOf(contribute(false, 'A-1'))).toBe(CHECK_VIOLATION);
      expect((await contribute(true, 'A-2'))[0].moderation_status).toBe('PENDING');
    });
  });

  describe('búsqueda de texto', () => {
    it('la función de búsqueda elimina tildes', async () => {
      const [{ texto }] = await h.owner.query(`SELECT immutable_unaccent('Atención primaria en salud pública') AS texto`);
      expect(texto).toBe('Atencion primaria en salud publica');
    });

    it('el índice de texto es una columna generada: no se escribe desde la aplicación', async () => {
      const sql = `INSERT INTO initiatives (title, summary, type, search_vector) VALUES ('t', 's', 'PROJECT', to_tsvector('x'))`;
      // 428C9: no se puede insertar un valor en una columna generada.
      expect(await codeOf(app.query(sql))).toBe('428C9');
    });
  });
});
