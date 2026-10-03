import { PublicRef, publicRefs, RelatedContent } from '../../../shared/content';
import { TermRef } from '../../taxonomy/domain/taxonomy';

/** Enumeracion InitiativeType: catalogo cerrado, el tipo no admite valores libres (H-08). */
export const INITIATIVE_TYPES = [
  'PROJECT',
  'PROGRAM',
  'RESEARCH',
  'EXTENSION',
  'TRAINING_PRACTICE',
  'COMMUNITY_EXPERIENCE',
] as const;

export interface InitiativeData {
  title: string;
  summary: string;
  type: string;
  startDate: string | null;
  endDate: string | null;
  results: string | null;
  termIds: string[];
  resourceIds: string[];
}

export interface InitiativeSummary {
  id: string;
  title: string;
  summary: string;
  type: string;
  state: string;
  terms: TermRef[];
  publishedAt: string | null;
  updatedAt: string;
}

export interface InitiativeDetail extends InitiativeSummary {
  startDate: string | null;
  endDate: string | null;
  results: string | null;
  authors: { id: string; displayName: string }[];
  resources: RelatedContent[];
  courses: RelatedContent[];
  createdAt: string;
}

/** Ficha publica: sin identificadores de usuario ni estado interno (H-15). */
export interface PublicInitiative {
  id: string;
  title: string;
  summary: string;
  type: string;
  startDate: string | null;
  endDate: string | null;
  results: string | null;
  terms: TermRef[];
  authors: string[];
  resources: PublicRef[];
  courses: PublicRef[];
  publishedAt: string | null;
}

export function toPublicInitiative(detail: InitiativeDetail): PublicInitiative {
  return {
    id: detail.id,
    title: detail.title,
    summary: detail.summary,
    type: detail.type,
    startDate: detail.startDate,
    endDate: detail.endDate,
    results: detail.results,
    terms: detail.terms,
    authors: detail.authors.map((a) => a.displayName),
    resources: publicRefs(detail.resources),
    courses: publicRefs(detail.courses),
    publishedAt: detail.publishedAt,
  };
}
