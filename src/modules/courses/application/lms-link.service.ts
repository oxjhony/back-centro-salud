import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SessionUser } from '../../identity/domain/permissions';
import { AUDIT_LOG, AuditLog, INTEGRATION_LOG, IntegrationLog } from '../../operations/ports';
import { LmsLink, resolveLink } from '../domain/lms-link';
import { COURSE_REPOSITORY, CourseRepository, MOODLE_GATEWAY, MoodleGateway } from './ports';

export interface ReconciliationSummary {
  correlationId: string;
  reviewed: number;
  verified: number;
  orphaned: number;
  withError: number;
  unanswered: number;
}

/** Verifica enlaces contra el LMS y deja constancia de cada llamada en el registro de integraciones. */
@Injectable()
export class LmsLinkService {
  constructor(
    @Inject(MOODLE_GATEWAY) private readonly moodle: MoodleGateway,
    @Inject(COURSE_REPOSITORY) private readonly courses: CourseRepository,
    @Inject(INTEGRATION_LOG) private readonly integrationLog: IntegrationLog,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  async verify(params: {
    courseId: string;
    idnumber: string;
    previous: LmsLink;
    mode: 'guardar' | 'conciliar';
    correlationId?: string;
  }): Promise<{ link: LmsLink; answered: boolean }> {
    const startedAt = Date.now();
    const lookup = await this.moodle.findCoursesByIdnumber(params.idnumber);
    const link = resolveLink({
      idnumber: params.idnumber,
      lookup,
      previous: params.previous,
      moodleBaseUrl: this.moodle.baseUrl,
      now: new Date(),
      mode: params.mode,
    });

    // Fallo del LMS, o respuesta valida que no permite enlazar (cero o varios cursos).
    const errorCode = lookup.ok === false ? lookup.errorCode : link.status === 'VERIFIED' ? null : link.error;
    await this.integrationLog.record({
      integration: 'moodle',
      operation: this.moodle.lookupOperation,
      status: lookup.ok === false && lookup.timedOut ? 'TIMEOUT' : errorCode ? 'ERROR' : 'OK',
      httpStatus: lookup.ok === false ? (lookup.httpStatus ?? null) : 200,
      errorCode,
      message: lookup.ok === false ? lookup.message : null,
      entityType: 'courses',
      entityId: params.courseId,
      correlationId: params.correlationId ?? randomUUID(),
      durationMs: Date.now() - startedAt,
    });

    return { link, answered: lookup.ok };
  }

  /**
   * Conciliacion (H-24): revalida todos los enlaces. Detecta aulas eliminadas, cambios de id
   * tras una restauracion e idnumber duplicados. Todas las llamadas comparten correlationId.
   */
  async reconcile(actor: SessionUser): Promise<ReconciliationSummary> {
    const summary: ReconciliationSummary = {
      correlationId: randomUUID(),
      reviewed: 0,
      verified: 0,
      orphaned: 0,
      withError: 0,
      unanswered: 0,
    };

    for (const course of await this.courses.listLinked()) {
      const { link, answered } = await this.verify({
        courseId: course.id,
        idnumber: course.link.externalId,
        previous: course.link,
        mode: 'conciliar',
        correlationId: summary.correlationId,
      });
      await this.courses.updateLink(course.id, link);

      summary.reviewed++;
      if (!answered) summary.unanswered++;
      else if (link.status === 'VERIFIED') summary.verified++;
      else if (link.status === 'ORPHAN') summary.orphaned++;
      else summary.withError++;
    }

    await this.audit.record({ actorId: actor.id, action: 'integration.moodle_reconciliation', minimalDetail: { ...summary } });
    return summary;
  }
}
