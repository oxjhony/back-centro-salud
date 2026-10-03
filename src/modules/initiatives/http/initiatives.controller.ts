import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { pageRequest } from '../../../shared/persistence';
import { oneOf, termIdsFrom, textFrom } from '../../../shared/query';
import { Permission, SessionUser } from '../../identity/domain/permissions';
import { CurrentUser, Public, RequirePermissions } from '../../identity/http/access';
import { InitiativesService } from '../application/initiatives.service';
import { INITIATIVE_TYPES, InitiativeData } from '../domain/initiative';

class InitiativeInput {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  summary: string;

  @IsIn(INITIATIVE_TYPES)
  type: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @MaxLength(10)
  startDate?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  @MaxLength(10)
  endDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  results?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsUUID('all', { each: true })
  termIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsUUID('all', { each: true })
  resourceIds?: string[];
}

function toData(input: InitiativeInput): InitiativeData {
  return {
    title: input.title.trim(),
    summary: input.summary.trim(),
    type: input.type,
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    results: input.results?.trim() || null,
    termIds: input.termIds ?? [],
    resourceIds: input.resourceIds ?? [],
  };
}

@Controller('initiatives')
export class InitiativesController {
  constructor(private readonly service: InitiativesService) {}

  @Post()
  @RequirePermissions(Permission.InitiativeManage)
  create(@CurrentUser() actor: SessionUser, @Body() input: InitiativeInput) {
    return this.service.create(actor, toData(input));
  }

  @Get('mine')
  @RequirePermissions(Permission.InitiativeManage)
  mine(@CurrentUser() actor: SessionUser) {
    return this.service.mine(actor);
  }

  @Put(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.InitiativeManage)
  update(@CurrentUser() actor: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: InitiativeInput) {
    return this.service.update(actor, id, toData(input));
  }

  @Get(':id')
  get(@CurrentUser() actor: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getForUser(actor, id);
  }
}

@Public()
@Controller('public/initiatives')
export class PublicInitiativesController {
  constructor(private readonly service: InitiativesService) {}

  @Get()
  search(@Query() query: Record<string, unknown>) {
    return this.service.searchPublished(
      { q: textFrom(query.q), type: oneOf(query.type, INITIATIVE_TYPES), termIds: termIdsFrom(query) },
      pageRequest(query.page, query.pageSize),
    );
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getPublished(id);
  }
}
