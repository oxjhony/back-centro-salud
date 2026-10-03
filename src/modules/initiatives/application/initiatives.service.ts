import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { assertCoherentDates } from '../../../shared/dates';
import { DomainError } from '../../../shared/errors';
import { Page, PageRequest, Tx, UNIT_OF_WORK, UnitOfWork } from '../../../shared/persistence';
import { EditorialService } from '../../editorial/application/editorial.service';
import { EditorialInfo, PublishableContent } from '../../editorial/application/ports';
import { EDITABLE_STATES, EditorialStatus } from '../../editorial/domain/state-machine';
import { hasPermission, Permission, SessionUser } from '../../identity/domain/permissions';
import { AUDIT_LOG, AuditLog } from '../../operations/ports';
import {
  InitiativeData,
  InitiativeDetail,
  InitiativeSummary,
  PublicInitiative,
  toPublicInitiative,
} from '../domain/initiative';

export const INITIATIVE_REPOSITORY = Symbol('INITIATIVE_REPOSITORY');

export interface PublicInitiativeFilter {
  q?: string;
  type?: string;
  /** Todos deben estar asociados a la iniciativa. */
  termIds: string[];
}

export interface InitiativeRepository {
  /** Valida los terminos y los recursos asociados; lanza un error de dominio si alguno no sirve. */
  insert(data: InitiativeData, authorId: string, tx: Tx): Promise<string>;
  update(id: string, data: InitiativeData, actorId: string, tx: Tx): Promise<void>;
  findById(id: string): Promise<InitiativeDetail | null>;
  listByAuthor(userId: string): Promise<InitiativeSummary[]>;
  searchPublished(filter: PublicInitiativeFilter, page: PageRequest): Promise<Page<InitiativeSummary>>;
}

@Injectable()
export class InitiativesService implements PublishableContent, OnModuleInit {
  readonly entityType = 'initiatives' as const;
  readonly authorPath = '/mis-iniciativas';

  constructor(
    @Inject(INITIATIVE_REPOSITORY) private readonly repository: InitiativeRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    private readonly editorial: EditorialService,
  ) {}

  onModuleInit() {
    this.editorial.register(this);
  }

  async create(actor: SessionUser, data: InitiativeData): Promise<{ id: string }> {
    assertCoherentDates(data.startDate, data.endDate);
    const id = await this.unitOfWork.run(async (tx) => {
      const newId = await this.repository.insert(data, actor.id, tx);
      await this.audit.record({ actorId: actor.id, action: 'initiative.created', objectType: 'initiatives', objectId: newId }, tx);
      return newId;
    });
    return { id };
  }

  async update(actor: SessionUser, id: string, data: InitiativeData): Promise<void> {
    assertCoherentDates(data.startDate, data.endDate);
    const current = await this.repository.findById(id);
    if (!current || !isAuthor(current, actor)) {
      throw notFound();
    }
    if (!EDITABLE_STATES.includes(current.state)) {
      throw DomainError.conflict('no_editable', 'Solo se edita un contenido en borrador o devuelto.');
    }
    await this.unitOfWork.run(async (tx) => {
      await this.repository.update(id, data, actor.id, tx);
      await this.audit.record({ actorId: actor.id, action: 'initiative.updated', objectType: 'initiatives', objectId: id }, tx);
    });
  }

  /** Vista interna: solo para sus autores y para quienes revisan (H-07). */
  async getForUser(actor: SessionUser, id: string): Promise<InitiativeDetail> {
    const detail = await this.repository.findById(id);
    if (!detail || (!isAuthor(detail, actor) && !hasPermission(actor, Permission.ContentReview))) {
      throw notFound();
    }
    return detail;
  }

  mine(actor: SessionUser): Promise<InitiativeSummary[]> {
    return this.repository.listByAuthor(actor.id);
  }

  searchPublished(filter: PublicInitiativeFilter, page: PageRequest): Promise<Page<InitiativeSummary>> {
    return this.repository.searchPublished(filter, page);
  }

  /** Un contenido no publicado responde igual que uno inexistente, aunque se conozca su URL. */
  async getPublished(id: string): Promise<PublicInitiative> {
    const detail = await this.repository.findById(id);
    if (!detail || detail.state !== EditorialStatus.Published) {
      throw notFound();
    }
    return toPublicInitiative(detail);
  }

  async editorialInfo(id: string): Promise<EditorialInfo | null> {
    const detail = await this.repository.findById(id);
    return detail ? { state: detail.state, title: detail.title, authorIds: detail.authors.map((a) => a.id) } : null;
  }
}

function isAuthor(detail: InitiativeDetail, actor: SessionUser): boolean {
  return detail.authors.some((author) => author.id === actor.id);
}

function notFound() {
  return DomainError.notFound('iniciativa_no_encontrada', 'La iniciativa no existe.');
}
