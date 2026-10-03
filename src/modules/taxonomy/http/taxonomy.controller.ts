import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { APP_CONFIG, AppConfig } from '../../../shared/config';
import { COURSE_MODALITIES, COURSE_TYPES } from '../../courses/domain/course';
import { EDITORIAL_STATUSES } from '../../editorial/domain/state-machine';
import { Permission, SessionUser } from '../../identity/domain/permissions';
import { CurrentUser, Public, RequirePermissions } from '../../identity/http/access';
import { INITIATIVE_TYPES } from '../../initiatives/domain/initiative';
import { ALLOWED_EXTENSIONS } from '../../resources/domain/file-format';
import { VISIBILITIES } from '../../resources/domain/resource';
import { TaxonomyService } from '../application/taxonomy.service';
import { TAXONOMY_TYPES, TaxonomyType, TermData } from '../domain/taxonomy';

class TermInput {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

class NewTermInput extends TermInput {
  @IsIn(TAXONOMY_TYPES)
  type: TaxonomyType;
}

function toData(input: TermInput): TermData {
  return { name: input.name.trim().replace(/\s+/g, ' '), parentId: input.parentId || null, active: input.active ?? true };
}

/**
 * Catalogos con los que se clasifica y se filtra (H-08): los terminos activos de la taxonomia
 * y las enumeraciones cerradas del modelo de datos.
 */
@Public()
@Controller('catalogs')
export class CatalogsController {
  constructor(
    private readonly taxonomy: TaxonomyService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  async all() {
    return {
      terms: await this.taxonomy.active(),
      taxonomyTypes: TAXONOMY_TYPES,
      editorialStatuses: EDITORIAL_STATUSES,
      initiativeTypes: INITIATIVE_TYPES,
      courseTypes: COURSE_TYPES,
      courseModalities: COURSE_MODALITIES,
      visibilities: VISIBILITIES,
      resourceFormats: ALLOWED_EXTENSIONS,
      maxUploadBytes: this.config.storage.maxUploadBytes,
    };
  }
}

@Controller('admin/taxonomy')
@RequirePermissions(Permission.TaxonomyManage)
export class TaxonomyAdminController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get()
  list(@Query('type') type?: string) {
    return this.taxonomy.list(TAXONOMY_TYPES.includes(type as TaxonomyType) ? (type as TaxonomyType) : undefined);
  }

  @Post()
  create(@CurrentUser() actor: SessionUser, @Body() input: NewTermInput) {
    return this.taxonomy.create(actor, input.type, toData(input));
  }

  @Put(':id')
  update(@CurrentUser() actor: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: TermInput) {
    return this.taxonomy.update(actor, id, toData(input));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() actor: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.taxonomy.remove(actor, id);
  }
}
