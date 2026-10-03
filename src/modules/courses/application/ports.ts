import { Page, PageRequest, Tx } from '../../../shared/persistence';
import { CourseData, CourseDetail, CourseSummary } from '../domain/course';
import { LmsLink, MoodleLookup } from '../domain/lms-link';

export const MOODLE_GATEWAY = Symbol('MOODLE_GATEWAY');
export const COURSE_REPOSITORY = Symbol('COURSE_REPOSITORY');

/**
 * Puerto de acceso al LMS. Tiene dos implementaciones: la real, contra los servicios web de
 * Moodle, y un doble de prueba. Es de solo lectura: la plataforma nunca escribe en Moodle.
 */
export interface MoodleGateway {
  /** URL publica del LMS, con la que se construye el enlace al aula. */
  readonly baseUrl: string;
  /** Operacion del LMS que respalda la busqueda; se usa para el registro de integraciones. */
  readonly lookupOperation: string;
  findCoursesByIdnumber(idnumber: string): Promise<MoodleLookup>;
}

export interface PublicCourseFilter {
  q?: string;
  type?: string;
  modality?: string;
  termIds: string[];
}

export interface LinkedCourse {
  id: string;
  link: LmsLink & { externalId: string };
}

export interface CourseRepository {
  /** Valida terminos, iniciativas y recursos asociados; lanza un error de dominio si alguno no sirve. */
  insert(id: string, data: CourseData, link: LmsLink, createdBy: string, tx: Tx): Promise<void>;
  update(id: string, data: CourseData, link: LmsLink, actorId: string, tx: Tx): Promise<void>;
  /** Solo toca las columnas del enlace: nunca titulo, resumen ni fechas. */
  updateLink(id: string, link: LmsLink, tx?: Tx): Promise<void>;
  findById(id: string): Promise<CourseDetail | null>;
  listByOwner(userId: string): Promise<CourseSummary[]>;
  listLinked(): Promise<LinkedCourse[]>;
  searchPublished(filter: PublicCourseFilter, page: PageRequest): Promise<Page<CourseDetail>>;
}
