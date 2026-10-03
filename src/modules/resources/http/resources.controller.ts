import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Response } from 'express';
import { pageRequest } from '../../../shared/persistence';
import { oneOf, termIdsFrom, textFrom } from '../../../shared/query';
import { Permission, SessionUser } from '../../identity/domain/permissions';
import { CurrentUser, Public, RequirePermissions } from '../../identity/http/access';
import { Download, ResourcesService, UploadedFile as Upload } from '../application/resources.service';
import { ResourceData, VISIBILITIES, Visibility } from '../domain/resource';

class ResourceInput {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  description: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  license: string;

  @IsIn(VISIBILITIES)
  visibility: Visibility;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsUUID('all', { each: true })
  termIds?: string[];
}

function toData(input: ResourceInput): ResourceData {
  return {
    title: input.title.trim(),
    description: input.description.trim(),
    license: input.license.trim(),
    visibility: input.visibility,
    termIds: input.termIds ?? [],
  };
}

/** Entrega el archivo como descarga: nunca se interpreta en el navegador como pagina. */
function send(response: Response, download: Download): StreamableFile {
  const ascii = download.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  response.set({
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  return new StreamableFile(download.bytes, {
    type: download.mimeType,
    length: download.bytes.length,
    disposition: `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(download.filename)}`,
  });
}

@Controller('resources')
export class ResourcesController {
  constructor(private readonly service: ResourcesService) {}

  @Post()
  @RequirePermissions(Permission.ResourceManage)
  create(@CurrentUser() actor: SessionUser, @Body() input: ResourceInput) {
    return this.service.create(actor, toData(input));
  }

  @Get('mine')
  @RequirePermissions(Permission.ResourceManage)
  mine(@CurrentUser() actor: SessionUser) {
    return this.service.mine(actor);
  }

  /** Para asociar recursos a una iniciativa o a un curso: los propios y los publicados. */
  @Get('linkable')
  linkable(@CurrentUser() actor: SessionUser) {
    return this.service.linkable(actor);
  }

  @Put(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.ResourceManage)
  update(@CurrentUser() actor: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: ResourceInput) {
    return this.service.update(actor, id, toData(input));
  }

  /** multipart/form-data con el archivo en el campo "file". El tamano maximo lo fija RESOURCE_MAX_MB. */
  @Post(':id/versions')
  @RequirePermissions(Permission.ResourceManage)
  @UseInterceptors(FileInterceptor('file'))
  upload(@CurrentUser() actor: SessionUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Upload) {
    return this.service.addVersion(actor, id, file);
  }

  @Get(':id/versions/:versionId/download')
  async downloadVersion(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return send(response, await this.service.downloadVersion(actor, id, versionId));
  }

  @Get(':id')
  get(@CurrentUser() actor: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getForUser(actor, id);
  }
}

@Public()
@Controller('public/resources')
export class PublicResourcesController {
  constructor(private readonly service: ResourcesService) {}

  @Get()
  search(@Query() query: Record<string, unknown>) {
    return this.service.searchPublished(
      { q: textFrom(query.q), visibility: oneOf(query.visibility, VISIBILITIES), termIds: termIdsFrom(query) },
      pageRequest(query.page, query.pageSize),
    );
  }

  /** Publica, pero un recurso RESTRICTED exige sesion: la decision la toma el caso de uso. */
  @Get(':id/download')
  async download(
    @CurrentUser() user: SessionUser | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return send(response, await this.service.downloadPublished(user, id));
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getPublished(id);
  }
}
