import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors';
import { Tx, UNIT_OF_WORK, UnitOfWork } from '../../../shared/persistence';
import { SessionUser } from '../../identity/domain/permissions';
import { AUDIT_LOG, AuditLog } from '../../operations/ports';
import { TaxonomyType, Term, TermAdmin, TermData } from '../domain/taxonomy';

export const TAXONOMY_REPOSITORY = Symbol('TAXONOMY_REPOSITORY');

export interface TaxonomyRepository {
  listActive(): Promise<Term[]>;
  listForAdmin(type?: TaxonomyType): Promise<TermAdmin[]>;
  find(id: string, tx?: Tx): Promise<TermAdmin | null>;
  /** Lanza `termino_duplicado` si ya hay un termino igual (sin tildes ni mayusculas) bajo el mismo padre. */
  insert(type: TaxonomyType, data: TermData, tx: Tx): Promise<string>;
  update(id: string, data: TermData, tx: Tx): Promise<void>;
  remove(id: string, tx: Tx): Promise<void>;
  /** Ids de los ancestros de un termino, del padre hacia la raiz. */
  ancestors(id: string, tx?: Tx): Promise<string[]>;
}

/** Administracion de catalogos sin cambiar codigo (RF-15): validacion de uso, duplicados y trazabilidad. */
@Injectable()
export class TaxonomyService {
  constructor(
    @Inject(TAXONOMY_REPOSITORY) private readonly terms: TaxonomyRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
  ) {}

  active(): Promise<Term[]> {
    return this.terms.listActive();
  }

  list(type?: TaxonomyType): Promise<TermAdmin[]> {
    return this.terms.listForAdmin(type);
  }

  async create(actor: SessionUser, type: TaxonomyType, data: TermData): Promise<TermAdmin> {
    const id = await this.unitOfWork.run(async (tx) => {
      await this.assertParent(type, null, data.parentId, tx);
      const newId = await this.terms.insert(type, data, tx);
      await this.audit.record(
        { actorId: actor.id, action: 'taxonomy.term_created', objectType: 'taxonomy_terms', objectId: newId, minimalDetail: { type, name: data.name } },
        tx,
      );
      return newId;
    });
    return this.terms.find(id);
  }

  async update(actor: SessionUser, id: string, data: TermData): Promise<TermAdmin> {
    await this.unitOfWork.run(async (tx) => {
      const current = await this.findOrFail(id, tx);
      await this.assertParent(current.type, id, data.parentId, tx);
      await this.terms.update(id, data, tx);
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'taxonomy.term_updated',
          objectType: 'taxonomy_terms',
          objectId: id,
          minimalDetail: { before: pick(current), after: data },
        },
        tx,
      );
    });
    return this.terms.find(id);
  }

  /** Un termino en uso no se borra: se desactiva, para que lo ya clasificado siga siendo trazable. */
  async remove(actor: SessionUser, id: string): Promise<void> {
    await this.unitOfWork.run(async (tx) => {
      const current = await this.findOrFail(id, tx);
      if (current.usage > 0 || current.children > 0) {
        throw DomainError.conflict(
          'termino_en_uso',
          'El término clasifica contenidos o tiene subtérminos: desactívalo en lugar de borrarlo.',
        );
      }
      await this.terms.remove(id, tx);
      await this.audit.record(
        { actorId: actor.id, action: 'taxonomy.term_deleted', objectType: 'taxonomy_terms', objectId: id, minimalDetail: { ...pick(current) } },
        tx,
      );
    });
  }

  private async findOrFail(id: string, tx: Tx): Promise<TermAdmin> {
    const term = await this.terms.find(id, tx);
    if (!term) throw DomainError.notFound('termino_no_encontrado', 'El término no existe.');
    return term;
  }

  /** El padre existe, es del mismo tipo y no crea un ciclo. */
  private async assertParent(type: TaxonomyType, id: string | null, parentId: string | null, tx: Tx): Promise<void> {
    if (!parentId) return;
    const parent = await this.terms.find(parentId, tx);
    if (!parent || parent.type !== type) {
      throw DomainError.invalid('padre_invalido', 'El término padre no existe o es de otro tipo.');
    }
    if (id && (parentId === id || (await this.terms.ancestors(parentId, tx)).includes(id))) {
      throw DomainError.invalid('padre_invalido', 'Un término no puede quedar bajo sí mismo ni bajo uno de sus subtérminos.');
    }
  }
}

function pick(term: Term): TermData & { type: TaxonomyType } {
  return { type: term.type, name: term.name, parentId: term.parentId, active: term.active };
}
