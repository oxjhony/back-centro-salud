/**
 * Codigos de la tabla `permissions`, al estilo de las capacidades de Moodle (area:verbo).
 * Los roles solo son agrupaciones: el codigo pregunta por permisos, nunca por roles.
 */
export const Permission = {
  InitiativeManage: 'initiative:manage',
  ResourceManage: 'resource:manage',
  CourseManage: 'course:manage',
  ContentSubmit: 'content:submit',
  ContentReview: 'content:review',
  ContentApprove: 'content:approve',
  ContentPublish: 'content:publish',
  ContentArchive: 'content:archive',
  UserManage: 'user:manage',
  TaxonomyManage: 'taxonomy:manage',
  AuditView: 'audit:view',
  IntegrationOperate: 'integration:operate',
} as const;

export type PermissionCode = (typeof Permission)[keyof typeof Permission];

/** Enumeracion RoleName del modelo de datos. */
export const RoleName = {
  Visitor: 'VISITOR',
  Registered: 'REGISTERED',
  Author: 'AUTHOR',
  Reviewer: 'REVIEWER',
  AcademicManager: 'ACADEMIC_MANAGER',
  FunctionalAdmin: 'FUNCTIONAL_ADMIN',
  TechnicalAdmin: 'TECHNICAL_ADMIN',
} as const;

/** Rol que recibe toda cuenta al entrar por primera vez. */
export const DEFAULT_ROLE = RoleName.Registered;

/** VISITOR es quien navega sin sesion: no se asigna a una cuenta. */
export const NON_ASSIGNABLE_ROLES: string[] = [RoleName.Visitor];

export const USER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
}

export function hasPermission(user: Pick<SessionUser, 'permissions'>, permission: string): boolean {
  return user.permissions.includes(permission);
}
