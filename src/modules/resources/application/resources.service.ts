import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../../../shared/config';
import { RelatedContent } from '../../../shared/content';
import { DomainError } from '../../../shared/errors';
import { Page, PageRequest, UNIT_OF_WORK, UnitOfWork } from '../../../shared/persistence';
import { EditorialService } from '../../editorial/application/editorial.service';
import { EditorialInfo, PublishableContent } from '../../editorial/application/ports';
import { EDITABLE_STATES, EditorialStatus } from '../../editorial/domain/state-machine';
import { hasPermission, Permission, SessionUser } from '../../identity/domain/permissions';
import { AUDIT_LOG, AuditLog } from '../../operations/ports';
import { decodeUploadName, detectFormat, safeFilename } from '../domain/file-format';
import {
  PublicResource,
  PublicResourceSummary,
  ResourceData,
  ResourceDetail,
  ResourceSummary,
  toPublicResource,
  toPublicSummary,
} from '../domain/resource';
import { FILE_STORAGE, FileStorage, PublicResourceFilter, RESOURCE_REPOSITORY, ResourceRepository } from './ports';

/** Archivo recibido en la peticion, ya leido en memoria (el tamano lo limita el lector multipart). */
export interface UploadedFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

export interface Download {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

/** Repositorio de conocimiento (RF-05): metadatos, versiones de archivo y descarga segun visibilidad. */
@Injectable()
export class ResourcesService implements PublishableContent, OnModuleInit {
  readonly entityType = 'resources' as const;
  readonly authorPath = '/mis-recursos';

  constructor(
    @Inject(RESOURCE_REPOSITORY) private readonly repository: ResourceRepository,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly editorial: EditorialService,
  ) {}

  onModuleInit() {
    this.editorial.register(this);
  }

  async create(actor: SessionUser, data: ResourceData): Promise<{ id: string }> {
    const id = await this.unitOfWork.run(async (tx) => {
      const newId = await this.repository.insert(data, actor.id, tx);
      await this.audit.record({ actorId: actor.id, action: 'resource.created', objectType: 'resources', objectId: newId }, tx);
      return newId;
    });
    return { id };
  }

  async update(actor: SessionUser, id: string, data: ResourceData): Promise<void> {
    await this.editableOrFail(actor, id);
    await this.unitOfWork.run(async (tx) => {
      await this.repository.update(id, data, tx);
      await this.audit.record({ actorId: actor.id, action: 'resource.updated', objectType: 'resources', objectId: id }, tx);
    });
  }

  /**
   * Cada carga es una version nueva: las anteriores se conservan para la trazabilidad. Se valida
   * formato y tamano antes de guardar nada (RF-05).
   */
  async addVersion(actor: SessionUser, id: string, file: UploadedFile | undefined): Promise<ResourceDetail> {
    await this.editableOrFail(actor, id);
    if (!file) {
      throw DomainError.invalid('archivo_requerido', 'Adjunta el archivo en el campo "file".');
    }
    if (file.size > this.config.storage.maxUploadBytes) {
      throw DomainError.invalid('archivo_muy_grande', 'El archivo supera el tamaño máximo permitido.');
    }
    const filename = safeFilename(decodeUploadName(file.originalname));
    const { mimeType } = detectFormat(filename, file.buffer);

    const versionId = randomUUID();
    const storageKey = `${id}/${versionId}`;
    // Primero el archivo y luego la fila: si la base falla, se borra el archivo; nunca queda
    // una version registrada sin sus bytes.
    await this.storage.put(storageKey, file.buffer);
    try {
      await this.unitOfWork.run(async (tx) => {
        const versionNumber = await this.repository.addVersion(
          id,
          {
            id: versionId,
            storageKey,
            originalFilename: filename,
            mimeType,
            sizeBytes: file.buffer.length,
            checksum: createHash('sha256').update(file.buffer).digest('hex'),
            uploadedBy: actor.id,
          },
          tx,
        );
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'resource.version_added',
            objectType: 'resources',
            objectId: id,
            minimalDetail: { versionNumber, mimeType, sizeBytes: file.buffer.length },
          },
          tx,
        );
      });
    } catch (error) {
      await this.storage.remove(storageKey).catch(() => undefined);
      throw error;
    }
    return this.repository.findById(id);
  }

  async getForUser(actor: SessionUser, id: string): Promise<ResourceDetail> {
    const detail = await this.repository.findById(id);
    if (!detail || (detail.createdBy !== actor.id && !hasPermission(actor, Permission.ContentReview))) {
      throw notFound();
    }
    return detail;
  }

  mine(actor: SessionUser): Promise<ResourceSummary[]> {
    return this.repository.listByOwner(actor.id);
  }

  linkable(actor: SessionUser): Promise<RelatedContent[]> {
    return this.repository.linkable(actor.id);
  }

  async searchPublished(filter: PublicResourceFilter, page: PageRequest): Promise<Page<PublicResourceSummary>> {
    const result = await this.repository.searchPublished(filter, page);
    return { ...result, items: result.items.map(toPublicSummary) };
  }

  async getPublished(id: string): Promise<PublicResource> {
    return toPublicResource(await this.publishedOrFail(id));
  }

  /** Descarga publica: solo lo publicado, y lo restringido solo con sesion (RF-05). */
  async downloadPublished(user: SessionUser | null, id: string): Promise<Download> {
    const detail = await this.publishedOrFail(id);
    if (detail.visibility === 'RESTRICTED' && !user) {
      throw DomainError.unauthenticated('sesion_requerida', 'Este recurso es de acceso restringido: inicia sesión para descargarlo.');
    }
    if (!detail.latestVersion) throw notFound();
    return this.read(id, detail.latestVersion.id);
  }

  /** Cualquier version, para el autor y para quien revisa. */
  async downloadVersion(actor: SessionUser, id: string, versionId: string): Promise<Download> {
    await this.getForUser(actor, id);
    return this.read(id, versionId);
  }

  async editorialInfo(id: string): Promise<EditorialInfo | null> {
    const detail = await this.repository.findById(id);
    return detail ? { state: detail.state, title: detail.title, authorIds: [detail.createdBy] } : null;
  }

  /** Composicion 1..*: un recurso sin archivo no se envia a revision. */
  async assertCanEnter(id: string, targetState: string): Promise<void> {
    if (targetState !== EditorialStatus.Submitted) return;
    const detail = await this.repository.findById(id);
    if (detail && detail.versions.length === 0) {
      throw DomainError.conflict('recurso_sin_archivo', 'Carga al menos un archivo antes de enviar el recurso a revisión.');
    }
  }

  private async read(id: string, versionId: string): Promise<Download> {
    const version = await this.repository.findVersion(id, versionId);
    if (!version) throw notFound();
    return { filename: version.originalFilename, mimeType: version.mimeType, bytes: await this.storage.get(version.storageKey) };
  }

  private async publishedOrFail(id: string): Promise<ResourceDetail> {
    const detail = await this.repository.findById(id);
    if (!detail || detail.state !== EditorialStatus.Published) throw notFound();
    return detail;
  }

  private async editableOrFail(actor: SessionUser, id: string): Promise<ResourceDetail> {
    const detail = await this.repository.findById(id);
    if (!detail || detail.createdBy !== actor.id) throw notFound();
    if (!EDITABLE_STATES.includes(detail.state)) {
      throw DomainError.conflict('no_editable', 'Solo se edita un contenido en borrador o devuelto.');
    }
    return detail;
  }
}

function notFound() {
  return DomainError.notFound('recurso_no_encontrado', 'El recurso no existe.');
}
