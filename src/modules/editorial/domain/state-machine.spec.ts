import { DomainError } from '../../../shared/errors';
import { availableTransitions, decideTransition, TransitionAttempt, TransitionRule } from './state-machine';

/** Las nueve transiciones semilla del modelo de datos, tal como las devuelve la base. */
const RULES: TransitionRule[] = [
  ['DRAFT', 'SUBMITTED', 'content:submit', false, false],
  ['SUBMITTED', 'IN_REVIEW', 'content:review', false, true],
  ['IN_REVIEW', 'RETURNED', 'content:review', true, true],
  ['IN_REVIEW', 'APPROVED', 'content:approve', false, true],
  ['IN_REVIEW', 'ARCHIVED', 'content:approve', true, true],
  ['RETURNED', 'SUBMITTED', 'content:submit', false, false],
  ['APPROVED', 'PUBLISHED', 'content:publish', false, true],
  ['PUBLISHED', 'ARCHIVED', 'content:archive', true, false],
  ['ARCHIVED', 'DRAFT', 'content:archive', true, false],
].map(([from, to, requiredPermission, requiresComment, forbidSelf]) => ({
  entityType: null,
  from,
  to,
  requiredPermission,
  requiresComment,
  forbidSelf,
})) as TransitionRule[];

const AUTHOR = { id: 'autor-1', permissions: ['initiative:manage', 'content:submit'] };
const REVIEWER = { id: 'revisor-1', permissions: ['content:review', 'content:approve', 'content:publish'] };

function attempt(overrides: Partial<TransitionAttempt>): TransitionAttempt {
  return {
    entityType: 'initiatives',
    currentState: 'DRAFT',
    targetState: 'SUBMITTED',
    actor: AUTHOR,
    authorIds: [AUTHOR.id],
    ...overrides,
  };
}

function rejection(overrides: Partial<TransitionAttempt>): DomainError {
  try {
    decideTransition(RULES, attempt(overrides));
  } catch (error) {
    return error as DomainError;
  }
  throw new Error('La transición debió rechazarse y fue aceptada.');
}

describe('máquina de estados editorial', () => {
  it('el autor envía su borrador a revisión', () => {
    expect(decideTransition(RULES, attempt({})).to).toBe('SUBMITTED');
  });

  it('el revisor aprueba un contenido ajeno en revisión', () => {
    const rule = decideTransition(RULES, attempt({ currentState: 'IN_REVIEW', targetState: 'APPROVED', actor: REVIEWER }));
    expect(rule.requiredPermission).toBe('content:approve');
  });

  it('rechaza una transición que no está declarada en la tabla (H-14)', () => {
    const error = rejection({ currentState: 'DRAFT', targetState: 'PUBLISHED', actor: REVIEWER });
    expect(error.code).toBe('transicion_no_permitida');
    expect(error.kind).toBe('conflict');
  });

  it('nada se publica sin pasar por revisión: de SUBMITTED no se salta a PUBLISHED', () => {
    expect(rejection({ currentState: 'SUBMITTED', targetState: 'PUBLISHED', actor: REVIEWER }).code).toBe(
      'transicion_no_permitida',
    );
  });

  it('exige el permiso que declara la transición', () => {
    const error = rejection({ currentState: 'APPROVED', targetState: 'PUBLISHED', actor: AUTHOR, authorIds: ['otro'] });
    expect(error.code).toBe('permiso_insuficiente');
    expect(error.kind).toBe('forbidden');
  });

  it('nadie aprueba ni publica su propio contenido, aunque tenga el permiso', () => {
    const authorAndReviewer = { id: 'doble', permissions: [...AUTHOR.permissions, ...REVIEWER.permissions] };
    for (const [currentState, targetState] of [
      ['SUBMITTED', 'IN_REVIEW'],
      ['IN_REVIEW', 'APPROVED'],
      ['APPROVED', 'PUBLISHED'],
    ]) {
      const error = rejection({ currentState, targetState, actor: authorAndReviewer, authorIds: ['doble'] });
      expect(error.code).toBe('contenido_propio');
    }
  });

  it('la prohibición alcanza a los coautores, no solo a quien creó el contenido', () => {
    const coauthor = { id: 'coautor', permissions: REVIEWER.permissions };
    const error = rejection({
      currentState: 'IN_REVIEW',
      targetState: 'APPROVED',
      actor: coauthor,
      authorIds: [AUTHOR.id, 'coautor'],
    });
    expect(error.code).toBe('contenido_propio');
  });

  it('devolver exige comentario: vacío o solo espacios se rechaza', () => {
    for (const comment of [undefined, null, '', '   ']) {
      const error = rejection({ currentState: 'IN_REVIEW', targetState: 'RETURNED', actor: REVIEWER, comment });
      expect(error.code).toBe('comentario_obligatorio');
      expect(error.kind).toBe('invalid');
    }
  });

  it('rechazar es archivar desde la revisión, y también exige comentario', () => {
    expect(rejection({ currentState: 'IN_REVIEW', targetState: 'ARCHIVED', actor: REVIEWER }).code).toBe('comentario_obligatorio');
    const rule = decideTransition(
      RULES,
      attempt({ currentState: 'IN_REVIEW', targetState: 'ARCHIVED', actor: REVIEWER, comment: 'Fuera del alcance.' }),
    );
    expect(rule.requiredPermission).toBe('content:approve');
  });

  it('devolver con comentario se acepta', () => {
    const rule = decideTransition(
      RULES,
      attempt({ currentState: 'IN_REVIEW', targetState: 'RETURNED', actor: REVIEWER, comment: 'Falta el territorio.' }),
    );
    expect(rule.requiresComment).toBe(true);
  });

  it('un borrador solo lo envían sus autores, aunque otro tenga el permiso de enviar', () => {
    const anotherAuthor = { id: 'autor-2', permissions: AUTHOR.permissions };
    expect(rejection({ actor: anotherAuthor }).code).toBe('no_es_autor');
    expect(rejection({ currentState: 'RETURNED', actor: anotherAuthor }).code).toBe('no_es_autor');
  });

  it('una regla propia de la entidad tiene prioridad sobre la general', () => {
    const rules: TransitionRule[] = [
      ...RULES,
      {
        entityType: 'courses',
        from: 'APPROVED',
        to: 'PUBLISHED',
        requiredPermission: 'course:publish',
        requiresComment: false,
        forbidSelf: true,
      },
    ];
    const base = { currentState: 'APPROVED', targetState: 'PUBLISHED', actor: REVIEWER, authorIds: ['otro'] };

    expect(decideTransition(rules, attempt({ ...base, entityType: 'initiatives' })).requiredPermission).toBe('content:publish');
    expect(() => decideTransition(rules, attempt({ ...base, entityType: 'courses' }))).toThrow(/course:publish/);
  });

  describe('transiciones disponibles', () => {
    const available = (overrides: Partial<TransitionAttempt>) =>
      availableTransitions(RULES, attempt(overrides)).map((t) => t.to);

    it('al autor se le ofrece enviar su borrador', () => {
      expect(available({})).toEqual(['SUBMITTED']);
    });

    it('al revisor se le ofrece devolver, aprobar o rechazar lo que está en revisión', () => {
      expect(available({ currentState: 'IN_REVIEW', actor: REVIEWER, authorIds: ['otro'] }).sort()).toEqual([
        'APPROVED',
        'ARCHIVED',
        'RETURNED',
      ]);
    });

    it('no se ofrece ninguna acción sobre un contenido propio en revisión', () => {
      const both = { id: 'doble', permissions: [...AUTHOR.permissions, ...REVIEWER.permissions] };
      expect(available({ currentState: 'IN_REVIEW', actor: both, authorIds: ['doble'] })).toEqual([]);
    });

    it('indica cuáles exigen comentario', () => {
      const transitions = availableTransitions(RULES, attempt({ currentState: 'IN_REVIEW', actor: REVIEWER, authorIds: ['otro'] }));
      expect(transitions.find((t) => t.to === 'RETURNED').requiresComment).toBe(true);
      expect(transitions.find((t) => t.to === 'APPROVED').requiresComment).toBe(false);
    });
  });
});
