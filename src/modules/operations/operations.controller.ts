import { Controller, Get, Inject, Query, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { pageRequest } from '../../shared/persistence';
import { Permission } from '../identity/domain/permissions';
import { Public, RequirePermissions } from '../identity/http/access';
import { AUDIT_LOG, AuditLog, INTEGRATION_LOG, INTEGRATION_STATUSES, IntegrationLog, IntegrationStatus } from './ports';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /**
   * No consulta Moodle a proposito: si el LMS cae, la plataforma sigue en modo degradado.
   * Marcarla como no lista provocaria reinicios en cadena por una dependencia externa.
   */
  @Get('ready')
  async ready() {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'sin conexión' });
    }
    return { status: 'ok', database: 'ok' };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('admin')
export class OperationsAdminController {
  constructor(
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(INTEGRATION_LOG) private readonly integrations: IntegrationLog,
  ) {}

  /** Solo consulta: la bitacora no tiene operaciones de edicion ni de borrado (RF-14). */
  @Get('audits')
  @RequirePermissions(Permission.AuditView)
  audits(
    @Query('action') action?: string,
    @Query('objectType') objectType?: string,
    @Query('objectId') objectId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.audit.search(
      {
        action: action || undefined,
        objectType: objectType || undefined,
        // Un objectId que no es un UUID no puede existir: se ignora en lugar de romper la consulta.
        objectId: objectId && UUID.test(objectId) ? objectId : undefined,
      },
      pageRequest(page, pageSize),
    );
  }

  @Get('integration-logs')
  @RequirePermissions(Permission.IntegrationOperate)
  integrationLogs(@Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const filter = INTEGRATION_STATUSES.includes(status as IntegrationStatus) ? (status as IntegrationStatus) : undefined;
    return this.integrations.search({ status: filter }, pageRequest(page, pageSize));
  }
}
