import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AuditEntry,
  AuditFilter,
  AuditLog,
  AuditRecord,
  IntegrationLog,
  IntegrationLogEntry,
  IntegrationLogRecord,
  IntegrationStatus,
} from '../../../modules/operations/ports';
import { Page, PageRequest, Tx } from '../../../shared/persistence';
import { PgRepository } from '../database.module';
import { offset, toPage } from './sql';

@Injectable()
export class PgAuditLog extends PgRepository implements AuditLog {
  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  async record(entry: AuditEntry, tx?: Tx): Promise<void> {
    await this.query(
      `INSERT INTO audit_logs (actor_id, action, object_type, object_id, source, minimal_detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.actorId ?? null,
        entry.action,
        entry.objectType ?? null,
        entry.objectId ?? null,
        entry.source ?? 'api',
        entry.minimalDetail ? JSON.stringify(entry.minimalDetail) : null,
      ],
      tx,
    );
  }

  async search(filter: AuditFilter, page: PageRequest): Promise<Page<AuditRecord>> {
    const rows = await this.query<AuditRecord & { total: string }>(
      `SELECT a.id,
              a.actor_id       AS "actorId",
              u.display_name   AS "actorName",
              a.action,
              a.object_type    AS "objectType",
              a.object_id      AS "objectId",
              a.occurred_at    AS "occurredAt",
              a.source,
              a.minimal_detail AS "minimalDetail",
              count(*) OVER () AS total
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_id
        WHERE ($1::text IS NULL OR a.action = $1)
          AND ($2::text IS NULL OR a.object_type = $2)
          AND ($3::uuid IS NULL OR a.object_id = $3)
        ORDER BY a.occurred_at DESC, a.id
        LIMIT $4 OFFSET $5`,
      [filter.action ?? null, filter.objectType ?? null, filter.objectId ?? null, page.pageSize, offset(page)],
    );
    return toPage(rows, page);
  }
}

@Injectable()
export class PgIntegrationLog extends PgRepository implements IntegrationLog {
  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  async record(entry: IntegrationLogEntry): Promise<void> {
    await this.query(
      `INSERT INTO integration_logs
         (integration, operation, status, http_status, error_code, message,
          entity_type, entity_id, correlation_id, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entry.integration,
        entry.operation,
        entry.status,
        entry.httpStatus ?? null,
        entry.errorCode ?? null,
        entry.message ?? null,
        entry.entityType ?? null,
        entry.entityId ?? null,
        entry.correlationId ?? null,
        entry.durationMs ?? null,
      ],
    );
  }

  async search(filter: { status?: IntegrationStatus }, page: PageRequest): Promise<Page<IntegrationLogRecord>> {
    const rows = await this.query<IntegrationLogRecord & { total: string }>(
      `SELECT id, integration, operation, status,
              http_status    AS "httpStatus",
              error_code     AS "errorCode",
              message,
              entity_type    AS "entityType",
              entity_id      AS "entityId",
              correlation_id AS "correlationId",
              duration_ms    AS "durationMs",
              occurred_at    AS "occurredAt",
              count(*) OVER () AS total
         FROM integration_logs
        WHERE ($1::text IS NULL OR status = $1)
        ORDER BY occurred_at DESC, id
        LIMIT $2 OFFSET $3`,
      [filter.status ?? null, page.pageSize, offset(page)],
    );
    return toPage(rows, page);
  }
}
