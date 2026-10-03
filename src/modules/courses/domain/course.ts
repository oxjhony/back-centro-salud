import { PublicRef, publicRefs, RelatedContent } from '../../../shared/content';
import { TermRef } from '../../taxonomy/domain/taxonomy';
import { CourseAccess, LmsLink, publicAccess } from './lms-link';

/** Enumeraciones CourseType y CourseModality del modelo de datos. */
export const COURSE_TYPES = ['COURSE', 'MICROCOURSE', 'DIPLOMA'] as const;
export const COURSE_MODALITIES = ['VIRTUAL', 'IN_PERSON', 'HYBRID', 'SELF_PACED'] as const;

export interface CourseData {
  title: string;
  summary: string;
  type: string;
  modality: string;
  duration: string | null;
  startDate: string | null;
  endDate: string | null;
  capacity: number | null;
  requirements: string | null;
  accessInstructions: string | null;
  termIds: string[];
  initiativeIds: string[];
  resourceIds: string[];
}

export interface CourseSummary {
  id: string;
  title: string;
  summary: string;
  type: string;
  modality: string;
  duration: string | null;
  startDate: string | null;
  endDate: string | null;
  state: string;
  terms: TermRef[];
  link: LmsLink;
  publishedAt: string | null;
  updatedAt: string;
}

/** Ficha completa, para el gestor academico y para quienes revisan. */
export interface CourseDetail extends CourseSummary {
  capacity: number | null;
  requirements: string | null;
  accessInstructions: string | null;
  createdBy: string;
  initiatives: RelatedContent[];
  resources: RelatedContent[];
  createdAt: string;
}

/** Ficha publica: sin el estado interno del enlace ni identificadores de usuario. */
export interface PublicCourse {
  id: string;
  title: string;
  summary: string;
  type: string;
  modality: string;
  duration: string | null;
  startDate: string | null;
  endDate: string | null;
  capacity: number | null;
  requirements: string | null;
  terms: TermRef[];
  access: CourseAccess;
  initiatives: PublicRef[];
  resources: PublicRef[];
  publishedAt: string | null;
}

export function toPublicCourse(detail: CourseDetail): PublicCourse {
  return {
    id: detail.id,
    title: detail.title,
    summary: detail.summary,
    type: detail.type,
    modality: detail.modality,
    duration: detail.duration,
    startDate: detail.startDate,
    endDate: detail.endDate,
    capacity: detail.capacity,
    requirements: detail.requirements,
    terms: detail.terms,
    access: publicAccess(detail.link, detail.accessInstructions),
    initiatives: publicRefs(detail.initiatives),
    resources: publicRefs(detail.resources),
    publishedAt: detail.publishedAt,
  };
}
