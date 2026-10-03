import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { pageRequest } from '../../../shared/persistence';
import { oneOf, termIdsFrom, textFrom } from '../../../shared/query';
import { Permission, SessionUser } from '../../identity/domain/permissions';
import { CurrentUser, Public, RequirePermissions } from '../../identity/http/access';
import { CoursesService } from '../application/courses.service';
import { LmsLinkService } from '../application/lms-link.service';
import { COURSE_MODALITIES, COURSE_TYPES, CourseData } from '../domain/course';

class CourseInput {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  summary: string;

  @IsIn(COURSE_TYPES)
  type: string;

  @IsIn(COURSE_MODALITIES)
  modality: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  duration?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  @MaxLength(10)
  startDate?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  @MaxLength(10)
  endDate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  requirements?: string | null;

  /** idnumber del curso en Moodle (Course.moodleExternalId). Vacio = ficha sin enlace directo. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  moodleExternalId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  accessInstructions?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsUUID('all', { each: true })
  termIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsUUID('all', { each: true })
  initiativeIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsUUID('all', { each: true })
  resourceIds?: string[];
}

function toData(input: CourseInput): CourseData {
  return {
    title: input.title.trim(),
    summary: input.summary.trim(),
    type: input.type,
    modality: input.modality,
    duration: input.duration?.trim() || null,
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    capacity: input.capacity ?? null,
    requirements: input.requirements?.trim() || null,
    accessInstructions: input.accessInstructions?.trim() || null,
    termIds: input.termIds ?? [],
    initiativeIds: input.initiativeIds ?? [],
    resourceIds: input.resourceIds ?? [],
  };
}

@Controller('courses')
export class CoursesController {
  constructor(private readonly service: CoursesService) {}

  @Post()
  @RequirePermissions(Permission.CourseManage)
  create(@CurrentUser() actor: SessionUser, @Body() input: CourseInput) {
    return this.service.create(actor, toData(input), input.moodleExternalId);
  }

  @Get('mine')
  @RequirePermissions(Permission.CourseManage)
  mine(@CurrentUser() actor: SessionUser) {
    return this.service.mine(actor);
  }

  @Put(':id')
  @RequirePermissions(Permission.CourseManage)
  update(@CurrentUser() actor: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: CourseInput) {
    return this.service.update(actor, id, toData(input), input.moodleExternalId);
  }

  @Post(':id/verify-link')
  @HttpCode(200)
  @RequirePermissions(Permission.CourseManage)
  verifyLink(@CurrentUser() actor: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.verifyLink(actor, id);
  }

  @Get(':id')
  get(@CurrentUser() actor: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getForUser(actor, id);
  }
}

@Public()
@Controller('public/courses')
export class PublicCoursesController {
  constructor(private readonly service: CoursesService) {}

  @Get()
  search(@Query() query: Record<string, unknown>) {
    return this.service.searchPublished(
      {
        q: textFrom(query.q),
        type: oneOf(query.type, COURSE_TYPES),
        modality: oneOf(query.modality, COURSE_MODALITIES),
        termIds: termIdsFrom(query),
      },
      pageRequest(query.page, query.pageSize),
    );
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getPublished(id);
  }
}

@Controller('admin/moodle')
@RequirePermissions(Permission.IntegrationOperate)
export class MoodleAdminController {
  constructor(private readonly links: LmsLinkService) {}

  @Post('reconcile')
  @HttpCode(200)
  reconcile(@CurrentUser() actor: SessionUser) {
    return this.links.reconcile(actor);
  }
}
