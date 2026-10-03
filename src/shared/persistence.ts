/** Transaccion en curso. Es opaca para los casos de uso: solo los adaptadores saben que contiene. */
export type Tx = { readonly __brand: 'Tx' };

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

export interface UnitOfWork {
  /** Ejecuta `work` en una sola transaccion: todo se confirma o nada. */
  run<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PageRequest {
  page: number;
  pageSize: number;
}

export function pageRequest(page?: unknown, pageSize?: unknown): PageRequest {
  const p = Math.floor(Number(page));
  const s = Math.floor(Number(pageSize));
  return {
    page: Number.isFinite(p) && p >= 1 ? p : 1,
    pageSize: Number.isFinite(s) && s >= 1 ? Math.min(s, 50) : 12,
  };
}
