import { Page, PageRequest, Tx } from '../../shared/persistence';

export const AUDIT_LOG = Symbol('AUDIT_LOG');
export const INTEGRATION_LOG = Symbol('INTEGRATION_LOG');

/** Una entrada de AuditLog. `objectType` + `objectId` senalan cualquier entidad auditada. */
export interface AuditEntry {
  actorId?: string | null;
  action: string;
  objectType?: string;
  objectId?: string;
  /** Por donde llego la accion: api (por defecto), seed, job... */
  source?: string;
  /** Datos minimos del cambio. Sin secretos ni informacion personal innecesaria. */
  minimalDetail?: Record<string, unknown>;
}

export interface AuditRecord {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  objectType: string | null;
  objectId: string | null;
  occurredAt: string;
  source: string;
  minimalDetail: Record<string, unknown> | null;
}

export interface AuditFilter {
  action?: string;
  objectType?: string;
  objectId?: string;
}

/** Bitacora de acciones de personas (RF-14). Solo se agrega: no existe operacion de edicion ni borrado. */
export interface AuditLog {
  /** Con `tx`, la entrada se confirma o se descarta junto con la operacion que la origina. */
  record(entry: AuditEntry, tx?: Tx): Promise<void>;
  search(filter: AuditFilter, page: PageRequest): Promise<Page<AuditRecord>>;
}

export type IntegrationName = 'moodle' | 'oidc' | 'smtp' | 'object_storage';
export const INTEGRATION_STATUSES = ['OK', 'ERROR', 'TIMEOUT'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export interface IntegrationLogEntry {
  integration: IntegrationName;
  operation: string;
  status: IntegrationStatus;
  httpStatus?: number | null;
  errorCode?: string | null;
  /** Mensaje saneado: prohibido incluir tokens, contrasenas o datos personales (RNF-08). */
  message?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  correlationId?: string | null;
  durationMs?: number | null;
}

export interface IntegrationLogRecord extends IntegrationLogEntry {
  id: string;
  occurredAt: string;
}

/** Registro operativo de llamadas a sistemas externos (RF-11). Distinto de la bitacora de personas. */
export interface IntegrationLog {
  record(entry: IntegrationLogEntry): Promise<void>;
  search(filter: { status?: IntegrationStatus }, page: PageRequest): Promise<Page<IntegrationLogRecord>>;
}
