import { Tx } from '../../../shared/persistence';
import { PublishableEntity, TransitionRule } from '../domain/state-machine';

export const EDITORIAL_STORE = Symbol('EDITORIAL_STORE');

export interface StateChange {
  entityType: PublishableEntity;
  entityId: string;
  from: string;
  to: string;
  actorId: string;
  comment: string | null;
}

/** Una fila de EditorialReview, lista para mostrar. */
export interface ReviewEntry {
  from: string;
  to: string;
  actorName: string;
  comment: string | null;
  createdAt: string;
}

export interface QueueItem {
  entityType: PublishableEntity;
  id: string;
  title: string;
  state: string;
  authorName: string;
  /** Momento en que el contenido llego a su estado actual. */
  since: string;
}

export interface EditorialStore {
  activeRules(): Promise<TransitionRule[]>;
  /** Cambia el estado solo si sigue siendo `from`. Devuelve false si otro lo cambio antes. */
  changeState(change: StateChange, tx: Tx): Promise<boolean>;
  recordReview(change: StateChange, tx: Tx): Promise<void>;
  history(entityType: PublishableEntity, entityId: string): Promise<ReviewEntry[]>;
  queue(states: string[]): Promise<QueueItem[]>;
}

/** Lo que la maquina de estados necesita saber de un contenido, sea cual sea su entidad. */
export interface EditorialInfo {
  state: string;
  title: string;
  authorIds: string[];
}

/**
 * Puerto que implementa cada modulo con contenido publicable. Asi el flujo editorial
 * no conoce iniciativas, recursos ni cursos: solo contenidos con estado y autores.
 */
export interface PublishableContent {
  readonly entityType: PublishableEntity;
  /** Ruta del contenido en el area personal del autor; va en las notificaciones. */
  readonly authorPath: string;
  editorialInfo(entityId: string): Promise<EditorialInfo | null>;
  /** Reglas propias de la entidad para entrar a un estado (p. ej. un curso publicable). */
  assertCanEnter?(entityId: string, targetState: string): Promise<void>;
}
