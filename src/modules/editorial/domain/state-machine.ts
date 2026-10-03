import { DomainError } from '../../../shared/errors';

/**
 * Maquina de estados editorial. Es una sola para todas las entidades publicables y no contiene
 * ningun `if` por entidad ni por estado: las reglas llegan como datos desde `editorial_transitions`.
 */

export const PUBLISHABLE_ENTITIES = ['initiatives', 'resources', 'courses'] as const;
export type PublishableEntity = (typeof PUBLISHABLE_ENTITIES)[number];

/** Enumeracion EditorialStatus del modelo de datos. */
export const EditorialStatus = {
  Draft: 'DRAFT',
  Submitted: 'SUBMITTED',
  InReview: 'IN_REVIEW',
  Approved: 'APPROVED',
  Published: 'PUBLISHED',
  Returned: 'RETURNED',
  Archived: 'ARCHIVED',
} as const;

export const EDITORIAL_STATUSES = Object.values(EditorialStatus);

/** Estados en los que el autor todavia puede editar el contenido. */
export const EDITABLE_STATES: string[] = [EditorialStatus.Draft, EditorialStatus.Returned];

/** Estados que aparecen en la bandeja de revision. */
export const QUEUE_STATES: string[] = [EditorialStatus.Submitted, EditorialStatus.InReview, EditorialStatus.Approved];

/**
 * Mientras el contenido esta en manos del autor (borrador o devuelto) solo sus autores lo mueven:
 * tener el permiso de enviar no autoriza a enviar el borrador de otra persona.
 */
function isAuthorsWorkspace(state: string): boolean {
  return EDITABLE_STATES.includes(state);
}

export interface TransitionRule {
  /** null = aplica a todas las entidades publicables. */
  entityType: string | null;
  from: string;
  to: string;
  requiredPermission: string;
  requiresComment: boolean;
  /** Quien ejecuta la transicion no puede ser autor del contenido. */
  forbidSelf: boolean;
}

export interface TransitionAttempt {
  entityType: string;
  currentState: string;
  targetState: string;
  actor: { id: string; permissions: string[] };
  authorIds: string[];
  comment?: string | null;
}

/** Una regla propia de la entidad tiene prioridad sobre la general. */
function findRule(rules: TransitionRule[], entityType: string, from: string, to: string) {
  const candidates = rules.filter((r) => r.from === from && r.to === to);
  return (
    candidates.find((r) => r.entityType === entityType) ?? candidates.find((r) => r.entityType === null)
  );
}

/**
 * Decide si la transicion puede ejecutarse. Devuelve la regla aplicada o lanza el motivo del rechazo.
 * No toca la base de datos ni conoce HTTP: se prueba con datos en memoria.
 */
export function decideTransition(rules: TransitionRule[], attempt: TransitionAttempt): TransitionRule {
  const rule = findRule(rules, attempt.entityType, attempt.currentState, attempt.targetState);
  if (!rule) {
    throw DomainError.conflict(
      'transicion_no_permitida',
      `No existe la transición de "${attempt.currentState}" a "${attempt.targetState}".`,
    );
  }
  if (!attempt.actor.permissions.includes(rule.requiredPermission)) {
    throw DomainError.forbidden(
      'permiso_insuficiente',
      `Esta transición exige el permiso ${rule.requiredPermission}.`,
    );
  }
  if (isAuthorsWorkspace(attempt.currentState) && !attempt.authorIds.includes(attempt.actor.id)) {
    throw DomainError.forbidden('no_es_autor', 'Un borrador solo lo mueven sus autores.');
  }
  if (rule.forbidSelf && attempt.authorIds.includes(attempt.actor.id)) {
    throw DomainError.forbidden(
      'contenido_propio',
      'Nadie revisa, aprueba ni publica un contenido del que es autor.',
    );
  }
  if (rule.requiresComment && !attempt.comment?.trim()) {
    throw DomainError.invalid('comentario_obligatorio', 'Esta transición exige un comentario.');
  }
  return rule;
}

/** Transiciones que el actor puede ejecutar ahora mismo; la interfaz las usa para mostrar acciones. */
export function availableTransitions(
  rules: TransitionRule[],
  attempt: Omit<TransitionAttempt, 'targetState' | 'comment'>,
): { to: string; requiresComment: boolean }[] {
  const targets = [...new Set(rules.filter((r) => r.from === attempt.currentState).map((r) => r.to))];
  return targets.flatMap((to) => {
    const rule = findRule(rules, attempt.entityType, attempt.currentState, to);
    const isAuthor = attempt.authorIds.includes(attempt.actor.id);
    const allowed =
      rule &&
      attempt.actor.permissions.includes(rule.requiredPermission) &&
      (isAuthor || !isAuthorsWorkspace(attempt.currentState)) &&
      !(rule.forbidSelf && isAuthor);
    return allowed ? [{ to, requiresComment: rule.requiresComment }] : [];
  });
}
