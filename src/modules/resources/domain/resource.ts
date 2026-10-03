import { PublicRef, publicRefs, RelatedContent } from '../../../shared/content';
import { TermRef } from '../../taxonomy/domain/taxonomy';

/** Enumeracion Visibility: RESTRICTED se lista en el portal, pero descargarlo exige sesion. */
export const VISIBILITIES = ['PUBLIC', 'RESTRICTED'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export interface ResourceData {
  title: string;
  description: string;
  license: string;
  visibility: Visibility;
  termIds: string[];
}

/** Una fila de ResourceVersion. Las versiones son inmutables: cargar un archivo crea una nueva. */
export interface VersionInfo {
  id: string;
  versionNumber: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  uploadedBy: string;
  createdAt: string;
}

export interface ResourceSummary {
  id: string;
  title: string;
  description: string;
  license: string;
  visibility: Visibility;
  state: string;
  terms: TermRef[];
  ownerName: string;
  latestVersion: VersionInfo | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface ResourceDetail extends ResourceSummary {
  createdBy: string;
  versions: VersionInfo[];
  initiatives: RelatedContent[];
  courses: RelatedContent[];
  createdAt: string;
}

/** Lo que el visitante sabe del archivo: sin quien lo cargo ni donde se guarda. */
export interface PublicFile {
  versionNumber: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface PublicResourceSummary {
  id: string;
  title: string;
  description: string;
  license: string;
  visibility: Visibility;
  terms: TermRef[];
  author: string;
  file: PublicFile | null;
  publishedAt: string | null;
}

export interface PublicResource extends PublicResourceSummary {
  initiatives: PublicRef[];
  courses: PublicRef[];
}

export function toPublicSummary(resource: ResourceSummary): PublicResourceSummary {
  const latest = resource.latestVersion;
  return {
    id: resource.id,
    title: resource.title,
    description: resource.description,
    license: resource.license,
    visibility: resource.visibility,
    terms: resource.terms,
    author: resource.ownerName,
    file: latest
      ? {
          versionNumber: latest.versionNumber,
          originalFilename: latest.originalFilename,
          mimeType: latest.mimeType,
          sizeBytes: latest.sizeBytes,
          uploadedAt: latest.createdAt,
        }
      : null,
    publishedAt: resource.publishedAt,
  };
}

export function toPublicResource(detail: ResourceDetail): PublicResource {
  return { ...toPublicSummary(detail), initiatives: publicRefs(detail.initiatives), courses: publicRefs(detail.courses) };
}
