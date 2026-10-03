import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { assertCoherentDates } from '../../../shared/dates';
import { DomainError } from '../../../shared/errors';
import { Page, PageRequest, UNIT_OF_WORK, UnitOfWork } from '../../../shared/persistence';
import { EditorialService } from '../../editorial/application/editorial.service';
import { EditorialInfo, PublishableContent } from '../../editorial/application/ports';
import { EDITABLE_STATES, EditorialStatus } from '../../editorial/domain/state-machine';
import { hasPermission, Permission, SessionUser } from '../../identity/domain/permissions';
import { AUDIT_LOG, AuditLog } from '../../operations/ports';
import { CourseData, CourseDetail, CourseSummary, PublicCourse, toPublicCourse } from '../domain/course';
import { assertIdnumberFormat, isPublishable, LmsLink, normalizeIdnumber, NOT_LINKED } from '../domain/lms-link';
import { LmsLinkService } from './lms-link.service';
import { COURSE_REPOSITORY, CourseRepository, PublicCourseFilter } from './ports';

@Injectable()
export class CoursesService implements PublishableContent, OnModuleInit {
  readonly entityType = 'courses' as const;
  readonly authorPath = '/mis-cursos';

  constructor(
    @Inject(COURSE_REPOSITORY) private readonly repository: CourseRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    private readonly links: LmsLinkService,
    private readonly editorial: EditorialService,
  ) {}

  onModuleInit() {
    this.editorial.register(this);
  }

  async create(actor: SessionUser, data: CourseData, moodleIdnumber?: string | null): Promise<CourseDetail> {
    assertCoherentDates(data.startDate, data.endDate);
    const id = randomUUID();
    const link = await this.linkFor(id, moodleIdnumber, NOT_LINKED);

    await this.unitOfWork.run(async (tx) => {
      await this.repository.insert(id, data, link, actor.id, tx);
      await this.audit.record({ actorId: actor.id, action: 'course.created', objectType: 'courses', objectId: id }, tx);
    });
    return this.repository.findById(id);
  }

  async update(actor: SessionUser, id: string, data: CourseData, moodleIdnumber?: string | null): Promise<CourseDetail> {
    assertCoherentDates(data.startDate, data.endDate);
    const current = await this.ownedOrFail(actor, id);
    if (!EDITABLE_STATES.includes(current.state)) {
      throw DomainError.conflict('no_editable', 'Solo se edita un contenido en borrador o devuelto.');
    }
    const link = await this.linkFor(id, moodleIdnumber, current.link);

    await this.unitOfWork.run(async (tx) => {
      await this.repository.update(id, data, link, actor.id, tx);
      await this.audit.record({ actorId: actor.id, action: 'course.updated', objectType: 'courses', objectId: id }, tx);
    });
    return this.repository.findById(id);
  }

  /** Reintenta la verificacion del enlace sin tocar el contenido editorial de la ficha. */
  async verifyLink(actor: SessionUser, id: string): Promise<CourseDetail> {
    const current = await this.ownedOrFail(actor, id);
    if (!current.link.externalId) {
      throw DomainError.conflict('sin_enlace', 'La ficha no tiene un idnumber de Moodle que verificar.');
    }
    const { link } = await this.links.verify({
      courseId: id,
      idnumber: current.link.externalId,
      previous: current.link,
      mode: 'guardar',
    });
    await this.repository.updateLink(id, link);
    return this.repository.findById(id);
  }

  /**
   * El enlace se verifica contra el LMS al guardar (H-23). Con cero o varios cursos la ficha
   * se guarda igual, pero el enlace queda en error y no basta para publicarla.
   */
  private async linkFor(courseId: string, rawIdnumber: string | null | undefined, previous: LmsLink): Promise<LmsLink> {
    const idnumber = normalizeIdnumber(rawIdnumber);
    if (!idnumber) return NOT_LINKED;
    assertIdnumberFormat(idnumber);
    const { link } = await this.links.verify({ courseId, idnumber, previous, mode: 'guardar' });
    return link;
  }

  async getForUser(actor: SessionUser, id: string): Promise<CourseDetail> {
    const detail = await this.repository.findById(id);
    if (!detail || (detail.createdBy !== actor.id && !hasPermission(actor, Permission.ContentReview))) {
      throw notFound();
    }
    return detail;
  }

  mine(actor: SessionUser): Promise<CourseSummary[]> {
    return this.repository.listByOwner(actor.id);
  }

  /** El catalogo publico sale siempre de la base local: nunca consulta el LMS (H-27). */
  async searchPublished(filter: PublicCourseFilter, page: PageRequest): Promise<Page<PublicCourse>> {
    const result = await this.repository.searchPublished(filter, page);
    return { ...result, items: result.items.map(toPublicCourse) };
  }

  async getPublished(id: string): Promise<PublicCourse> {
    const detail = await this.repository.findById(id);
    if (!detail || detail.state !== EditorialStatus.Published) {
      throw notFound();
    }
    return toPublicCourse(detail);
  }

  async editorialInfo(id: string): Promise<EditorialInfo | null> {
    const detail = await this.repository.findById(id);
    return detail ? { state: detail.state, title: detail.title, authorIds: [detail.createdBy] } : null;
  }

  async assertCanEnter(id: string, targetState: string): Promise<void> {
    if (targetState !== EditorialStatus.Published) return;
    const detail = await this.repository.findById(id);
    if (detail && !isPublishable(detail.link, detail.accessInstructions)) {
      throw DomainError.conflict(
        'curso_sin_acceso',
        'Para publicar, la ficha necesita un enlace verificado con Moodle o una instrucción de acceso.',
      );
    }
  }

  private async ownedOrFail(actor: SessionUser, id: string): Promise<CourseDetail> {
    const detail = await this.repository.findById(id);
    if (!detail || detail.createdBy !== actor.id) {
      throw notFound();
    }
    return detail;
  }
}

function notFound() {
  return DomainError.notFound('curso_no_encontrado', 'El curso no existe.');
}
