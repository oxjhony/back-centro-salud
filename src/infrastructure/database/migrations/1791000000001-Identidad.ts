import { MigrationInterface, QueryRunner } from 'typeorm';
import { APP_ROLE } from './app-role';
import { ENUMS, inList } from './sql';

/**
 * Identidad y acceso (modelo v3): User, UserProfile, Role, Permission y RoleAssignment.
 * Sigue la estructura de Moodle: roles que agrupan capacidades (permisos) y asignaciones de rol
 * dentro de un contexto. No hay columna de contrasena: la autenticacion es del proveedor de identidad.
 */
export class Identidad1791000000001 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);
    // unaccent() no es IMMUTABLE y PostgreSQL no la admite en columnas generadas ni en indices.
    await q.query(`
      CREATE FUNCTION immutable_unaccent(text) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE
      AS $$ SELECT public.unaccent('public.unaccent', $1) $$`);

    await q.query(`
      CREATE TABLE users (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        external_subject_id varchar(255),
        display_name        varchar(150) NOT NULL,
        email               varchar(255) NOT NULL,
        affiliation         varchar(255),
        general_territory   varchar(150),
        status              varchar(20)  NOT NULL DEFAULT 'ACTIVE',
        created_at          timestamptz  NOT NULL DEFAULT now(),
        updated_at          timestamptz  NOT NULL DEFAULT now(),
        last_login_at       timestamptz,
        CONSTRAINT uq_users_email UNIQUE (email),
        CONSTRAINT ck_users_status CHECK (status IN (${inList(ENUMS.userStatus)})),
        CONSTRAINT ck_users_display_name CHECK (length(trim(display_name)) > 0)
      )`);
    await q.query(`
      CREATE UNIQUE INDEX uq_users_external_subject ON users (external_subject_id)
      WHERE external_subject_id IS NOT NULL`);

    // Solo datos opcionales y no sensibles (RF-02).
    await q.query(`
      CREATE TABLE user_profiles (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id             uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
        interests           text[]  NOT NULL DEFAULT '{}',
        notification_opt_in boolean NOT NULL DEFAULT false,
        updated_at          timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_profiles_interests CHECK (cardinality(interests) <= 20)
      )`);

    await q.query(`
      CREATE TABLE roles (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name        varchar(40) NOT NULL UNIQUE,
        description text        NOT NULL,
        CONSTRAINT ck_roles_name CHECK (name IN (${inList(ENUMS.roleName)}))
      )`);
    await q.query(`
      CREATE TABLE permissions (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code        varchar(80) NOT NULL UNIQUE,
        description text        NOT NULL,
        CONSTRAINT ck_permissions_code CHECK (code ~ '^[a-z_]+:[a-z_]+$')
      )`);
    await q.query(`
      CREATE TABLE role_permissions (
        role_id       uuid NOT NULL REFERENCES roles (id),
        permission_id uuid NOT NULL REFERENCES permissions (id),
        PRIMARY KEY (role_id, permission_id)
      )`);

    // Como mdl_role_assignments: el contexto dice donde vale el rol. SYSTEM = en toda la plataforma.
    await q.query(`
      CREATE TABLE role_assignments (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        role_id       uuid NOT NULL REFERENCES roles (id),
        context_level varchar(20) NOT NULL DEFAULT 'SYSTEM',
        context_id    uuid,
        assigned_by   uuid REFERENCES users (id) ON DELETE SET NULL,
        assigned_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_role_assignments_level CHECK (context_level IN (${inList(ENUMS.contextLevel)})),
        CONSTRAINT ck_role_assignments_context CHECK ((context_level = 'SYSTEM') = (context_id IS NULL))
      )`);
    await q.query(`
      CREATE UNIQUE INDEX uq_role_assignments ON role_assignments
        (user_id, role_id, context_level, coalesce(context_id, '00000000-0000-0000-0000-000000000000'::uuid))`);

    // Los siete roles de la Especificacion Ejecutable (seccion 2.1). VISITOR no se asigna: es quien navega sin sesion.
    await q.query(`
      INSERT INTO roles (name, description) VALUES
        ('VISITOR',          'Consulta contenidos públicos sin autenticarse'),
        ('REGISTERED',       'Actualiza su perfil mínimo y recibe notificaciones'),
        ('AUTHOR',           'Crea iniciativas y recursos, y los envía a revisión'),
        ('REVIEWER',         'Evalúa contenidos: los toma, devuelve, aprueba o publica'),
        ('ACADEMIC_MANAGER', 'Administra fichas de cursos y su enlace con Moodle'),
        ('FUNCTIONAL_ADMIN', 'Gestiona usuarios, taxonomías, flujo editorial e indicadores'),
        ('TECHNICAL_ADMIN',  'Opera la plataforma sin asumir decisiones editoriales')`);

    // Capacidades al estilo de Moodle (area:verbo). El codigo pregunta por permisos, nunca por roles.
    await q.query(`
      INSERT INTO permissions (code, description) VALUES
        ('initiative:manage',   'Crear y editar borradores de iniciativas'),
        ('resource:manage',     'Crear recursos y cargar sus versiones'),
        ('course:manage',       'Crear y editar fichas de cursos y su enlace con Moodle'),
        ('content:submit',      'Enviar contenido propio a revisión'),
        ('content:review',      'Tomar contenido en revisión y devolverlo con observaciones'),
        ('content:approve',     'Aprobar o rechazar contenido en revisión'),
        ('content:publish',     'Publicar contenido aprobado'),
        ('content:archive',     'Archivar y reactivar contenido'),
        ('user:manage',         'Consultar usuarios, asignar roles y cambiar su estado'),
        ('taxonomy:manage',     'Administrar los términos de la taxonomía'),
        ('audit:view',          'Consultar la bitácora de auditoría'),
        ('integration:operate', 'Consultar el registro de integraciones y lanzar la conciliación')`);

    await q.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM (VALUES
        ('AUTHOR',           'initiative:manage'),
        ('AUTHOR',           'resource:manage'),
        ('AUTHOR',           'content:submit'),
        ('ACADEMIC_MANAGER', 'course:manage'),
        ('ACADEMIC_MANAGER', 'resource:manage'),
        ('ACADEMIC_MANAGER', 'content:submit'),
        ('REVIEWER',         'content:review'),
        ('REVIEWER',         'content:approve'),
        ('REVIEWER',         'content:publish'),
        ('FUNCTIONAL_ADMIN', 'content:review'),
        ('FUNCTIONAL_ADMIN', 'content:approve'),
        ('FUNCTIONAL_ADMIN', 'content:publish'),
        ('FUNCTIONAL_ADMIN', 'content:archive'),
        ('FUNCTIONAL_ADMIN', 'user:manage'),
        ('FUNCTIONAL_ADMIN', 'taxonomy:manage'),
        ('FUNCTIONAL_ADMIN', 'audit:view'),
        ('FUNCTIONAL_ADMIN', 'integration:operate'),
        ('TECHNICAL_ADMIN',  'audit:view'),
        ('TECHNICAL_ADMIN',  'integration:operate')
      ) AS grant_list (role_name, permission_code)
      JOIN roles r ON r.name = grant_list.role_name
      JOIN permissions p ON p.code = grant_list.permission_code`);

    await q.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON users, user_profiles, role_assignments TO ${APP_ROLE}`);
    await q.query(`GRANT SELECT ON roles, permissions, role_permissions TO ${APP_ROLE}`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE role_assignments, role_permissions, permissions, roles, user_profiles, users`);
    await q.query(`DROP FUNCTION immutable_unaccent(text)`);
    await q.query(`REVOKE USAGE ON SCHEMA public FROM ${APP_ROLE}`);
  }
}
