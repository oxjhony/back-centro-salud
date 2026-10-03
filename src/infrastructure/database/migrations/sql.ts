/**
 * Valores de las enumeraciones del modelo de datos (v3) tal como los fijan estas migraciones.
 * Son una foto del esquema: una migracion ya aplicada no debe cambiar si el dominio cambia despues.
 */
export const ENUMS = {
  editorialStatus: ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'RETURNED', 'ARCHIVED'],
  roleName: ['VISITOR', 'REGISTERED', 'AUTHOR', 'REVIEWER', 'ACADEMIC_MANAGER', 'FUNCTIONAL_ADMIN', 'TECHNICAL_ADMIN'],
  userStatus: ['ACTIVE', 'INACTIVE', 'SUSPENDED'],
  contextLevel: ['SYSTEM', 'INITIATIVE', 'RESOURCE', 'COURSE'],
  taxonomyType: ['THEME', 'TERRITORY', 'POPULATION', 'RESOURCE_TYPE', 'TAG'],
  initiativeType: ['PROJECT', 'PROGRAM', 'RESEARCH', 'EXTENSION', 'TRAINING_PRACTICE', 'COMMUNITY_EXPERIENCE'],
  courseType: ['COURSE', 'MICROCOURSE', 'DIPLOMA'],
  courseModality: ['VIRTUAL', 'IN_PERSON', 'HYBRID', 'SELF_PACED'],
  lmsLinkStatus: ['NOT_LINKED', 'PENDING', 'VERIFIED', 'ERROR', 'ORPHAN'],
  visibility: ['PUBLIC', 'RESTRICTED'],
  contentType: ['EVENT', 'NEWS'],
  actorType: ['INSTITUTION', 'ORGANIZATION', 'COMMUNITY_GROUP', 'NETWORK', 'PUBLIC_ENTITY'],
  consultationStatus: ['DRAFT', 'OPEN', 'CLOSED'],
  moderationStatus: ['PENDING', 'APPROVED', 'REJECTED'],
  notificationType: ['EDITORIAL_TRANSITION', 'CONTENT_PUBLISHED', 'CONSULTATION_OPEN', 'SYSTEM'],
  deliveryStatus: ['PENDING', 'SENT', 'FAILED'],
  integrationStatus: ['OK', 'ERROR', 'TIMEOUT'],
  publishableEntity: ['initiatives', 'resources', 'courses', 'events_news'],
} as const;

/** `'A', 'B', 'C'` para usar dentro de un CHECK (... IN (...)). Los valores son constantes, nunca entrada. */
export function inList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/** Expresion de busqueda en espanol, sin tildes, con pesos por columna. */
export function searchVector(weighted: [column: string, weight: 'A' | 'B' | 'C'][]): string {
  return weighted
    .map(([column, weight]) => `setweight(to_tsvector('spanish', immutable_unaccent(coalesce(${column}, ''))), '${weight}')`)
    .join(' || ');
}
