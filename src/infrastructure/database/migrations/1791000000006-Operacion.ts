import { MigrationInterface, QueryRunner } from 'typeorm';
import { APP_ROLE } from './app-role';
import { ENUMS, inList } from './sql';

/** AuditLog (acciones de personas, RF-14) e IntegrationLog (llamadas a sistemas externos, RF-11). */
export class Operacion1791000000006 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // Como mdl_logstore_standard_log: objectType/objectId senalan cualquier entidad auditada.
    await q.query(`
      CREATE TABLE audit_logs (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id       uuid REFERENCES users (id) ON DELETE SET NULL,
        action         varchar(100) NOT NULL,
        object_type    varchar(80),
        object_id      uuid,
        occurred_at    timestamptz  NOT NULL DEFAULT now(),
        source         varchar(40)  NOT NULL DEFAULT 'api',
        minimal_detail jsonb
      )`);
    await q.query(`CREATE INDEX ix_audit_logs_occurred ON audit_logs (occurred_at DESC)`);
    await q.query(`CREATE INDEX ix_audit_logs_object ON audit_logs (object_type, object_id)`);

    await q.query(`
      CREATE TABLE integration_logs (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        integration    varchar(30)  NOT NULL,
        operation      varchar(120) NOT NULL,
        status         varchar(10)  NOT NULL,
        http_status    integer,
        error_code     varchar(80),
        message        text,
        entity_type    varchar(80),
        entity_id      uuid,
        correlation_id varchar(80),
        duration_ms    integer,
        occurred_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_integration_name CHECK (integration IN ('moodle', 'oidc', 'smtp', 'object_storage')),
        CONSTRAINT ck_integration_status CHECK (status IN (${inList(ENUMS.integrationStatus)}))
      )`);
    await q.query(`CREATE INDEX ix_integration_logs_panel ON integration_logs (integration, status, occurred_at)`);

    // Solo lectura e insercion: sin UPDATE ni DELETE, la aplicacion no puede reescribir la evidencia.
    await q.query(`GRANT SELECT, INSERT ON audit_logs, integration_logs TO ${APP_ROLE}`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE integration_logs, audit_logs`);
  }
}
