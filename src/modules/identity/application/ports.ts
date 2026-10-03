import { Tx } from '../../../shared/persistence';
import { SessionUser, UserStatus } from '../domain/permissions';

export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

/** Lo minimo que la plataforma recibe del proveedor de identidad. Nunca la contrasena. */
export interface ExternalIdentity {
  /** Identificador estable del proveedor (claim `sub` en OIDC). */
  subject: string;
  email: string;
  displayName: string;
}

/**
 * Puerto del proveedor de identidad. Hoy lo implementa el proveedor local de desarrollo;
 * el institucional se conecta con otro adaptador, sin tocar los casos de uso (H-06).
 */
export interface IdentityProvider {
  authenticate(email: string, password: string): Promise<ExternalIdentity | null>;
}

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  roles: string[];
  createdAt: string;
  lastLoginAt: string | null;
}

export interface RoleSummary {
  name: string;
  description: string;
  assignable: boolean;
  permissions: string[];
}

/** User + UserProfile: lo que la persona ve y corrige de si misma (RF-02). */
export interface Profile {
  email: string;
  displayName: string;
  affiliation: string | null;
  generalTerritory: string | null;
  interests: string[];
  notificationOptIn: boolean;
  updatedAt: string;
}

export type ProfileData = Omit<Profile, 'email' | 'updatedAt'>;

export interface UserRepository {
  /** Usuario activo con sus roles y permisos efectivos (asignaciones de contexto SYSTEM), o null. */
  findSessionUser(id: string, tx?: Tx): Promise<SessionUser | null>;
  findBySubject(subject: string, tx?: Tx): Promise<{ id: string; status: UserStatus } | null>;
  /** Crea usuario, perfil minimo y rol por defecto. */
  createFromIdentity(identity: ExternalIdentity, defaultRole: string, tx: Tx): Promise<string>;
  touchLastLogin(id: string, tx: Tx): Promise<void>;
  list(): Promise<UserSummary[]>;
  roles(): Promise<RoleSummary[]>;
  rolesOf(userId: string, tx?: Tx): Promise<string[] | null>;
  replaceRoles(userId: string, roles: string[], assignedBy: string, tx: Tx): Promise<void>;
  statusOf(userId: string, tx?: Tx): Promise<UserStatus | null>;
  setStatus(userId: string, status: UserStatus, tx: Tx): Promise<void>;
  profile(userId: string): Promise<Profile | null>;
  updateProfile(userId: string, data: ProfileData, tx: Tx): Promise<void>;
}
