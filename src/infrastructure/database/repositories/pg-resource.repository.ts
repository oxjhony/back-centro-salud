import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  NewVersion,
  PublicResourceFilter,
  ResourceRepository,
  StoredVersion,
} from '../../../modules/resources/application/ports';
import { ResourceData, ResourceDetail, ResourceSummary } from '../../../modules/resources/domain/resource';
import { RelatedContent } from '../../../shared/content';
import { Page, PageRequest, Tx } from '../../../shared/persistence';
import { PgRepository } from '../database.module';
import { hasAllTerms, matchesText, offset, relatedOf, termsOf, toPage } from './sql';

const VERSION_JSON = `json_build_object(
  'id', v.id, 'versionNumber', v.version_number, 'originalFilename', v.original_filename,
  'mimeType', v.mime_type, 'sizeBytes', v.size_bytes, 'checksum', v.checksum,
  'uploadedBy', uv.display_name, 'createdAt', v.created_at)`;

const SUMMARY_COLUMNS = `
  r.id, r.title, r.description, r.license, r.visibility,
  r.editorial_status AS state,
  ${termsOf('resource_terms', 'resource_id', 'r')} AS terms,
  owner.display_name AS "ownerName",
  (SELECT ${VERSION_JSON}
     FROM resource_versions v JOIN users uv ON uv.id = v.uploaded_by
    WHERE v.resource_id = r.id
    ORDER BY v.version_number DESC LIMIT 1) AS "latestVersion",
  r.published_at AS "publishedAt",
  r.updated_at   AS "updatedAt"`;

const DETAIL_COLUMNS = `${SUMMARY_COLUMNS},
  r.created_by AS "createdBy",
  r.created_at AS "createdAt",
  coalesce((SELECT json_agg(${VERSION_JSON} ORDER BY v.version_number DESC)
              FROM resource_versions v JOIN users uv ON uv.id = v.uploaded_by
             WHERE v.resource_id = r.id), '[]'::json) AS versions,
  ${relatedOf('initiative_resources', 'resource_id', 'r.id', 'initiatives', 'initiative_id')} AS initiatives,
  ${relatedOf('course_resources', 'resource_id', 'r.id', 'courses', 'course_id')} AS courses`;

const FROM = `FROM resources r JOIN users owner ON owner.id = r.created_by`;

type Row = ResourceSummary & { latestVersion: (ResourceSummary['latestVersion'] & { sizeBytes: number | string }) | null };

/** bigint llega como texto desde el driver: el tamano se entrega como numero. */
function withNumbers<T extends Row>(row: T): T {
  const fix = (v: { sizeBytes: number | string } | null) => (v ? { ...v, sizeBytes: Number(v.sizeBytes) } : v);
  const detail = row as T & { versions?: { sizeBytes: number | string }[] };
  return {
    ...row,
    latestVersion: fix(row.latestVersion),
    ...(detail.versions ? { versions: detail.versions.map(fix) } : {}),
  } as T;
}

@Injectable()
export class PgResourceRepository extends PgRepository implements ResourceRepository {
  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  async insert(data: ResourceData, ownerId: string, tx: Tx): Promise<string> {
    const { id } = await this.one<{ id: string }>(
      `INSERT INTO resources (title, description, license, visibility, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [data.title, data.description, data.license, data.visibility, ownerId],
      tx,
    );
    await this.replaceTerms('resource_terms', 'resource_id', id, data.termIds, tx);
    return id;
  }

  async update(id: string, data: ResourceData, tx: Tx): Promise<void> {
    await this.query(
      `UPDATE resources SET title = $2, description = $3, license = $4, visibility = $5, updated_at = now() WHERE id = $1`,
      [id, data.title, data.description, data.license, data.visibility],
      tx,
    );
    await this.replaceTerms('resource_terms', 'resource_id', id, data.termIds, tx);
  }

  async findById(id: string): Promise<ResourceDetail | null> {
    const row = await this.one<ResourceDetail>(`SELECT ${DETAIL_COLUMNS} ${FROM} WHERE r.id = $1`, [id]);
    return row ? withNumbers(row) : null;
  }

  async listByOwner(userId: string): Promise<ResourceSummary[]> {
    const rows = await this.query<ResourceSummary>(
      `SELECT ${SUMMARY_COLUMNS} ${FROM} WHERE r.created_by = $1 ORDER BY r.updated_at DESC, r.id`,
      [userId],
    );
    return rows.map(withNumbers);
  }

  linkable(userId: string): Promise<RelatedContent[]> {
    return this.query<RelatedContent>(
      `SELECT r.id, r.title, r.editorial_status AS state
         FROM resources r
        WHERE r.editorial_status = 'PUBLISHED' OR r.created_by = $1
        ORDER BY r.title, r.id`,
      [userId],
    );
  }

  async searchPublished(filter: PublicResourceFilter, page: PageRequest): Promise<Page<ResourceSummary>> {
    const rows = await this.query<ResourceSummary & { total: string }>(
      `SELECT ${SUMMARY_COLUMNS}, count(*) OVER () AS total
         ${FROM}
        WHERE r.editorial_status = 'PUBLISHED'
          AND ${matchesText('r', '$1')}
          AND ($2::text IS NULL OR r.visibility = $2)
          AND ${hasAllTerms('resource_terms', 'resource_id', 'r', '$3')}
        ORDER BY r.published_at DESC, r.id
        LIMIT $4 OFFSET $5`,
      [filter.q ?? null, filter.visibility ?? null, filter.termIds, page.pageSize, offset(page)],
    );
    const result = toPage(rows, page);
    return { ...result, items: result.items.map(withNumbers) };
  }

  async addVersion(resourceId: string, version: NewVersion, tx: Tx): Promise<number> {
    // FOR UPDATE: dos cargas simultaneas del mismo recurso se ordenan y no repiten el numero.
    await this.query(`SELECT id FROM resources WHERE id = $1 FOR UPDATE`, [resourceId], tx);
    const { versionNumber } = await this.one<{ versionNumber: number }>(
      `INSERT INTO resource_versions
         (id, resource_id, version_number, storage_key, original_filename, mime_type, size_bytes, checksum, uploaded_by)
       VALUES ($1, $2,
               (SELECT coalesce(max(version_number), 0) + 1 FROM resource_versions WHERE resource_id = $2),
               $3, $4, $5, $6, $7, $8)
       RETURNING version_number AS "versionNumber"`,
      [
        version.id,
        resourceId,
        version.storageKey,
        version.originalFilename,
        version.mimeType,
        version.sizeBytes,
        version.checksum,
        version.uploadedBy,
      ],
      tx,
    );
    await this.query(`UPDATE resources SET updated_at = now() WHERE id = $1`, [resourceId], tx);
    return versionNumber;
  }

  findVersion(resourceId: string, versionId: string): Promise<StoredVersion | null> {
    return this.one<StoredVersion>(
      `SELECT storage_key AS "storageKey", original_filename AS "originalFilename", mime_type AS "mimeType"
         FROM resource_versions WHERE resource_id = $1 AND id = $2`,
      [resourceId, versionId],
    );
  }
}
