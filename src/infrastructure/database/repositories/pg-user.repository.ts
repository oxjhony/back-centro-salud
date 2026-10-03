import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ExternalIdentity,
  Profile,
  ProfileData,
  RoleSummary,
  UserRepository,
  UserSummary,
} from '../../../modules/identity/application/ports';
import { NON_ASSIGNABLE_ROLES, SessionUser, UserStatus } from '../../../modules/identity/domain/permissions';
import { Tx } from '../../../shared/persistence';
import { PgRepository } from '../database.module';

/** Roles de la persona en el contexto de toda la plataforma (como el contexto de sistema de Moodle). */
const SYSTEM_ROLES = `
  coalesce((SELECT array_agg(r.name ORDER BY r.name)
              FROM role_assignments ra JOIN roles r ON r.id = ra.role_id
             WHERE ra.user_id = u.id AND ra.context_level = 'SYSTEM'), '{}')`;

@Injectable()
export class PgUserRepository extends PgRepository implements UserRepository {
  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  findSessionUser(id: string, tx?: Tx): Promise<SessionUser | null> {
    return this.one<SessionUser>(
      `SELECT u.id, u.email,
              u.display_name AS "displayName",
              ${SYSTEM_ROLES} AS roles,
              coalesce((SELECT array_agg(DISTINCT p.code ORDER BY p.code)
                          FROM role_assignments ra
                          JOIN role_permissions rp ON rp.role_id = ra.role_id
                          JOIN permissions p ON p.id = rp.permission_id
                         WHERE ra.user_id = u.id AND ra.context_level = 'SYSTEM'), '{}') AS permissions
         FROM users u
        WHERE u.id = $1 AND u.status = 'ACTIVE'`,
      [id],
      tx,
    );
  }

  findBySubject(subject: string, tx?: Tx): Promise<{ id: string; status: UserStatus } | null> {
    return this.one(`SELECT id, status FROM users WHERE external_subject_id = $1`, [subject], tx);
  }

  async createFromIdentity(identity: ExternalIdentity, defaultRole: string, tx: Tx): Promise<string> {
    const { id } = await this.one<{ id: string }>(
      `INSERT INTO users (external_subject_id, email, display_name) VALUES ($1, $2, $3) RETURNING id`,
      [identity.subject, identity.email, identity.displayName],
      tx,
    );
    await this.query(`INSERT INTO user_profiles (user_id) VALUES ($1)`, [id], tx);
    await this.query(
      `INSERT INTO role_assignments (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2`,
      [id, defaultRole],
      tx,
    );
    return id;
  }

  async touchLastLogin(id: string, tx: Tx): Promise<void> {
    await this.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [id], tx);
  }

  list(): Promise<UserSummary[]> {
    return this.query<UserSummary>(
      `SELECT u.id, u.email,
              u.display_name  AS "displayName",
              u.status,
              ${SYSTEM_ROLES} AS roles,
              u.created_at    AS "createdAt",
              u.last_login_at AS "lastLoginAt"
         FROM users u
        ORDER BY u.display_name, u.id`,
    );
  }

  roles(): Promise<RoleSummary[]> {
    return this.query<RoleSummary>(
      `SELECT r.name, r.description,
              NOT (r.name = ANY($1::varchar[])) AS assignable,
              coalesce((SELECT array_agg(p.code ORDER BY p.code)
                          FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                         WHERE rp.role_id = r.id), '{}') AS permissions
         FROM roles r
        ORDER BY array_position(ARRAY['VISITOR','REGISTERED','AUTHOR','REVIEWER','ACADEMIC_MANAGER','FUNCTIONAL_ADMIN','TECHNICAL_ADMIN']::varchar[], r.name)`,
      [NON_ASSIGNABLE_ROLES],
    );
  }

  async rolesOf(userId: string, tx?: Tx): Promise<string[] | null> {
    const row = await this.one<{ roles: string[] }>(`SELECT ${SYSTEM_ROLES} AS roles FROM users u WHERE u.id = $1`, [userId], tx);
    return row ? row.roles : null;
  }

  async replaceRoles(userId: string, roles: string[], assignedBy: string, tx: Tx): Promise<void> {
    await this.query(`DELETE FROM role_assignments WHERE user_id = $1 AND context_level = 'SYSTEM'`, [userId], tx);
    await this.query(
      `INSERT INTO role_assignments (user_id, role_id, assigned_by)
       SELECT $1, id, $3 FROM roles WHERE name = ANY($2::varchar[])`,
      [userId, roles, assignedBy],
      tx,
    );
  }

  async statusOf(userId: string, tx?: Tx): Promise<UserStatus | null> {
    const row = await this.one<{ status: UserStatus }>(`SELECT status FROM users WHERE id = $1`, [userId], tx);
    return row?.status ?? null;
  }

  async setStatus(userId: string, status: UserStatus, tx: Tx): Promise<void> {
    await this.query(`UPDATE users SET status = $2, updated_at = now() WHERE id = $1`, [userId, status], tx);
  }

  profile(userId: string): Promise<Profile | null> {
    return this.one<Profile>(
      `SELECT u.email,
              u.display_name      AS "displayName",
              u.affiliation,
              u.general_territory AS "generalTerritory",
              coalesce(p.interests, '{}') AS interests,
              coalesce(p.notification_opt_in, false) AS "notificationOptIn",
              greatest(u.updated_at, p.updated_at) AS "updatedAt"
         FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE u.id = $1`,
      [userId],
    );
  }

  async updateProfile(userId: string, data: ProfileData, tx: Tx): Promise<void> {
    await this.query(
      `UPDATE users SET display_name = $2, affiliation = $3, general_territory = $4, updated_at = now() WHERE id = $1`,
      [userId, data.displayName, data.affiliation, data.generalTerritory],
      tx,
    );
    await this.query(
      `INSERT INTO user_profiles (user_id, interests, notification_opt_in) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE
         SET interests = EXCLUDED.interests, notification_opt_in = EXCLUDED.notification_opt_in, updated_at = now()`,
      [userId, data.interests, data.notificationOptIn],
      tx,
    );
  }
}
