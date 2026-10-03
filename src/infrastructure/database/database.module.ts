import { Global, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { APP_CONFIG, AppConfig } from '../../shared/config';
import { DomainError } from '../../shared/errors';
import { Tx, UNIT_OF_WORK, UnitOfWork } from '../../shared/persistence';

@Injectable()
export class PgUnitOfWork implements UnitOfWork {
  constructor(private readonly dataSource: DataSource) {}

  run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.dataSource.transaction((manager) => work(manager as unknown as Tx));
  }
}

/**
 * Base de los adaptadores de persistencia: ejecuta dentro de la transaccion si se le pasa una.
 * Los nombres de tabla y columna que reciben los ayudantes son constantes del adaptador, nunca
 * datos de la peticion.
 */
export abstract class PgRepository {
  constructor(protected readonly dataSource: DataSource) {}

  protected query<T = any>(sql: string, params: unknown[] = [], tx?: Tx): Promise<T[]> {
    const runner = (tx as unknown as EntityManager) ?? this.dataSource;
    return runner.query(sql, params);
  }

  protected async one<T = any>(sql: string, params: unknown[] = [], tx?: Tx): Promise<T | null> {
    const rows = await this.query<T>(sql, params, tx);
    return rows[0] ?? null;
  }

  /** Reemplaza las filas de una tabla de asociacion muchos a muchos. */
  protected async replaceLinks(
    table: string,
    ownerColumn: string,
    ownerId: string,
    targetColumn: string,
    targetIds: string[],
    tx: Tx,
  ): Promise<void> {
    await this.query(`DELETE FROM ${table} WHERE ${ownerColumn} = $1`, [ownerId], tx);
    const ids = [...new Set(targetIds)];
    if (ids.length > 0) {
      await this.query(
        `INSERT INTO ${table} (${ownerColumn}, ${targetColumn}) SELECT $1, unnest($2::uuid[])`,
        [ownerId, ids],
        tx,
      );
    }
  }

  /**
   * Reemplaza la clasificacion de un contenido. Un termino nuevo debe existir y estar activo;
   * los que el contenido ya tenia se conservan aunque se hayan desactivado despues (RF-15).
   */
  protected async replaceTerms(table: string, ownerColumn: string, ownerId: string, termIds: string[], tx: Tx): Promise<void> {
    const ids = [...new Set(termIds)];
    const usable = await this.count(
      `SELECT count(*)::int AS n FROM taxonomy_terms t
        WHERE t.id = ANY($1::uuid[])
          AND (t.active OR EXISTS (SELECT 1 FROM ${table} x WHERE x.${ownerColumn} = $2 AND x.term_id = t.id))`,
      [ids, ownerId],
      tx,
    );
    if (usable !== ids.length) {
      throw DomainError.invalid('catalogo_invalido', 'Algún término de la taxonomía no existe o está inactivo.');
    }
    await this.replaceLinks(table, ownerColumn, ownerId, 'term_id', ids, tx);
  }

  protected async count(sql: string, params: unknown[], tx?: Tx): Promise<number> {
    const row = await this.one<{ n: number }>(sql, params, tx);
    return Number(row?.n ?? 0);
  }
}

/** Codigos de error de PostgreSQL que los adaptadores traducen a errores de dominio. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';

export function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: string; driverError?: { code?: string } };
  return e?.driverError?.code ?? e?.code;
}

@Injectable()
class DataSourceLifecycle implements OnApplicationShutdown {
  constructor(private readonly dataSource: DataSource) {}

  async onApplicationShutdown() {
    if (this.dataSource.isInitialized) await this.dataSource.destroy();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      inject: [APP_CONFIG],
      // synchronize nunca: el esquema solo cambia por migraciones.
      useFactory: (config: AppConfig) =>
        new DataSource({ type: 'postgres', url: config.databaseUrl, synchronize: false }).initialize(),
    },
    { provide: UNIT_OF_WORK, useClass: PgUnitOfWork },
    DataSourceLifecycle,
  ],
  exports: [DataSource, UNIT_OF_WORK],
})
export class DatabaseModule {}
