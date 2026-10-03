import { DomainError } from '../../../shared/errors';

/**
 * Reglas del enlace entre una ficha de curso y su aula en Moodle. Dominio puro: recibe lo que
 * respondio el LMS y decide el estado del enlace, sin saber como se hizo la llamada.
 *
 * La clave de union es el `idnumber` del curso en Moodle (Course.moodleExternalId). Su id interno
 * solo aparece dentro de la URL del aula, que se revalida en cada conciliacion.
 */

/** Enumeracion LmsLinkStatus del modelo de datos. */
export type LinkStatus = 'NOT_LINKED' | 'PENDING' | 'VERIFIED' | 'ERROR' | 'ORPHAN';

export type MoodleErrorCode = 'lms_inalcanzable' | 'token_invalido' | 'respuesta_invalida';

export interface MoodleCourse {
  id: number;
  shortname: string;
  fullname: string;
}

/** Resultado de buscar cursos por idnumber. El adaptador nunca lanza: los fallos son datos. */
export type MoodleLookup =
  | { ok: true; courses: MoodleCourse[] }
  | { ok: false; errorCode: MoodleErrorCode; message: string; httpStatus?: number; timedOut?: boolean };

/** Columnas moodle_external_id y lms_* de Course. */
export interface LmsLink {
  /** idnumber del curso en Moodle; null si la ficha no esta enlazada. */
  externalId: string | null;
  url: string | null;
  status: LinkStatus;
  verifiedAt: Date | null;
  /** Codigo saneado del ultimo problema: nunca contiene tokens ni datos personales. */
  error: string | null;
}

export const NOT_LINKED: LmsLink = { externalId: null, url: null, status: 'NOT_LINKED', verifiedAt: null, error: null };

const OWN_IDNUMBER = /^cvsp-[a-z0-9]+(-[a-z0-9]+)*$/;
const IDNUMBER_MAX_LENGTH = 100;

/** Moodle admite idnumber vacio; la plataforma lo trata como ausente. */
export function normalizeIdnumber(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Los idnumber creados para el Centro siguen la convencion `cvsp-<slug>`. Los heredados de otro
 * sistema institucional se aceptan tal cual: la plataforma no los reescribe.
 */
export function assertIdnumberFormat(idnumber: string): void {
  if (idnumber.length > IDNUMBER_MAX_LENGTH) {
    throw DomainError.invalid('idnumber_invalido', `El idnumber admite máximo ${IDNUMBER_MAX_LENGTH} caracteres.`);
  }
  if (idnumber.toLowerCase().startsWith('cvsp') && !OWN_IDNUMBER.test(idnumber)) {
    throw DomainError.invalid(
      'idnumber_invalido',
      'Los idnumber del Centro tienen la forma cvsp-<slug> en minúsculas, por ejemplo cvsp-atencion-primaria-2026.',
    );
  }
}

export function courseUrl(moodleBaseUrl: string, numericId: number): string {
  return `${moodleBaseUrl}/course/view.php?id=${numericId}`;
}

/**
 * Decide el estado del enlace a partir de la respuesta del LMS.
 *
 * @param mode 'guardar' cuando el gestor guarda la ficha; 'conciliar' en la revalidacion periodica.
 */
export function resolveLink(params: {
  idnumber: string;
  lookup: MoodleLookup;
  previous: LmsLink;
  moodleBaseUrl: string;
  now: Date;
  mode: 'guardar' | 'conciliar';
}): LmsLink {
  const { idnumber, lookup, previous, moodleBaseUrl, now, mode } = params;
  const sameCourse = previous.externalId === idnumber;
  const cache = sameCourse ? previous : { ...NOT_LINKED };

  if (lookup.ok === false) {
    // El LMS no respondio bien: se conserva el ultimo estado verificado. Una caida de Moodle
    // no puede degradar un enlace que ya se habia comprobado.
    if (sameCourse && previous.status === 'VERIFIED') return previous;
    return { ...cache, externalId: idnumber, status: 'PENDING', verifiedAt: null, error: lookup.errorCode };
  }

  if (lookup.courses.length === 1) {
    const [course] = lookup.courses;
    return { externalId: idnumber, url: courseUrl(moodleBaseUrl, course.id), status: 'VERIFIED', verifiedAt: now, error: null };
  }

  if (lookup.courses.length > 1) {
    // Moodle no garantiza unicidad del idnumber en su base: no se elige un curso al azar.
    return { externalId: idnumber, url: null, status: 'ERROR', verifiedAt: null, error: 'idnumber_duplicado' };
  }

  // Cero resultados. Si el enlace ya habia existido, el aula fue eliminada: es un huerfano.
  const wasLinked = sameCourse && (previous.status === 'VERIFIED' || previous.status === 'ORPHAN');
  if (mode === 'conciliar' && wasLinked) {
    return { ...cache, externalId: idnumber, status: 'ORPHAN', verifiedAt: null, error: 'curso_no_encontrado' };
  }
  return { externalId: idnumber, url: null, status: 'ERROR', verifiedAt: null, error: 'curso_no_encontrado' };
}

/** RF-06: todo curso publicado lleva al aula o explica como entrar. */
export function isPublishable(link: Pick<LmsLink, 'status'>, accessInstructions: string | null): boolean {
  return link.status === 'VERIFIED' || Boolean(accessInstructions?.trim());
}

export type CourseAccess =
  | { kind: 'LMS'; url: string }
  | { kind: 'INSTRUCTIONS'; text: string }
  | { kind: 'UNAVAILABLE' };

/** Lo que ve el visitante: el enlace solo si esta verificado; si no, la instruccion alternativa. */
export function publicAccess(link: Pick<LmsLink, 'status' | 'url'>, accessInstructions: string | null): CourseAccess {
  if (link.status === 'VERIFIED' && link.url) return { kind: 'LMS', url: link.url };
  if (accessInstructions?.trim()) return { kind: 'INSTRUCTIONS', text: accessInstructions.trim() };
  return { kind: 'UNAVAILABLE' };
}
