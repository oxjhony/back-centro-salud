import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Permission, SessionUser } from '../../identity/domain/permissions';
import { CurrentUser, RequirePermissions } from '../../identity/http/access';
import { EditorialService } from '../application/editorial.service';

class TransitionInput {
  @IsString()
  @MaxLength(20)
  to: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

@Controller('editorial')
export class EditorialController {
  constructor(private readonly editorial: EditorialService) {}

  @Get('queue')
  @RequirePermissions(Permission.ContentReview)
  queue() {
    return this.editorial.queue();
  }

  /**
   * No declara un permiso fijo: el que se exige depende de la transicion y se lee de
   * `editorial_transitions`. La validacion ocurre en el dominio, no aqui.
   */
  @Post(':entityType/:id/transitions')
  @HttpCode(200)
  transition(
    @CurrentUser() actor: SessionUser,
    @Param('entityType') entityType: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: TransitionInput,
  ) {
    return this.editorial.transition(actor, entityType, id, input.to, input.comment);
  }

  @Get(':entityType/:id/transitions')
  available(
    @CurrentUser() actor: SessionUser,
    @Param('entityType') entityType: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.editorial.availableFor(actor, entityType, id);
  }

  @Get(':entityType/:id/history')
  history(
    @CurrentUser() actor: SessionUser,
    @Param('entityType') entityType: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.editorial.history(actor, entityType, id);
  }
}
