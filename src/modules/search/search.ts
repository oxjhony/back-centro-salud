import { Controller, Get, Inject, Query } from '@nestjs/common';
import { Page, PageRequest, pageRequest } from '../../shared/persistence';
import { oneOf, termIdsFrom, textFrom } from '../../shared/query';
import { Public } from '../identity/http/access';
import { TermRef } from '../taxonomy/domain/taxonomy';

export const SEARCH_INDEX = Symbol('SEARCH_INDEX');

export const SEARCHABLE_TYPES = ['initiatives', 'resources', 'courses'] as const;
export type SearchableType = (typeof SEARCHABLE_TYPES)[number];

export interface SearchHit {
  type: SearchableType;
  id: string;
  title: string;
  excerpt: string;
  terms: TermRef[];
  publishedAt: string;
}

export interface SearchFilter {
  q?: string;
  type?: SearchableType;
  termIds: string[];
}

/** La busqueda es una operacion sobre lo publicado (RF-10): no tiene tabla propia. */
export interface SearchIndex {
  search(filter: SearchFilter, page: PageRequest): Promise<Page<SearchHit>>;
}

/** Busqueda unica del portal: iniciativas, recursos y cursos, ordenados por pertinencia. */
@Public()
@Controller('public/search')
export class SearchController {
  constructor(@Inject(SEARCH_INDEX) private readonly index: SearchIndex) {}

  @Get()
  search(@Query() query: Record<string, unknown>) {
    return this.index.search(
      { q: textFrom(query.q), type: oneOf(query.type, SEARCHABLE_TYPES), termIds: termIdsFrom(query) },
      pageRequest(query.page, query.pageSize),
    );
  }
}
