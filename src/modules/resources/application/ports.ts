import { RelatedContent } from '../../../shared/content';
import { Page, PageRequest, Tx } from '../../../shared/persistence';
import { ResourceData, ResourceDetail, ResourceSummary, Visibility } from '../domain/resource';

export const RESOURCE_REPOSITORY = Symbol('RESOURCE_REPOSITORY');
export const FILE_STORAGE = Symbol('FILE_STORAGE');

/**
 * Donde viven los bytes de cada version. En desarrollo, una carpeta local; en produccion se
 * conecta otro adaptador (almacenamiento de objetos) sin tocar los casos de uso.
 */
export interface FileStorage {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export interface NewVersion {
  id: string;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  uploadedBy: string;
}

export interface StoredVersion {
  storageKey: string;
  originalFilename: string;
  mimeType: string;
}

export interface PublicResourceFilter {
  q?: string;
  visibility?: Visibility;
  termIds: string[];
}

export interface ResourceRepository {
  insert(data: ResourceData, ownerId: string, tx: Tx): Promise<string>;
  update(id: string, data: ResourceData, tx: Tx): Promise<void>;
  findById(id: string): Promise<ResourceDetail | null>;
  listByOwner(userId: string): Promise<ResourceSummary[]>;
  /** Recursos que la persona puede asociar a sus contenidos: los suyos y los publicados. */
  linkable(userId: string): Promise<RelatedContent[]>;
  searchPublished(filter: PublicResourceFilter, page: PageRequest): Promise<Page<ResourceSummary>>;
  /** Asigna el siguiente numero de version, bloqueando el recurso para que dos cargas no lo repitan. */
  addVersion(resourceId: string, version: NewVersion, tx: Tx): Promise<number>;
  findVersion(resourceId: string, versionId: string): Promise<StoredVersion | null>;
}
