import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsString } from 'class-validator';
import { UsersAdminService } from '../application/users-admin.service';
import { Permission, SessionUser, USER_STATUSES, UserStatus } from '../domain/permissions';
import { CurrentUser, RequirePermissions } from './access';

class AssignRolesInput {
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  roles: string[];
}

class StatusInput {
  @IsIn(USER_STATUSES)
  status: UserStatus;
}

@Controller('admin')
@RequirePermissions(Permission.UserManage)
export class UsersAdminController {
  constructor(private readonly service: UsersAdminService) {}

  @Get('users')
  users() {
    return this.service.list();
  }

  @Get('roles')
  roles() {
    return this.service.roles();
  }

  @Put('users/:id/roles')
  @HttpCode(204)
  assignRoles(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() input: AssignRolesInput,
  ) {
    return this.service.assignRoles(actor, userId, input.roles);
  }

  @Put('users/:id/status')
  @HttpCode(204)
  setStatus(@CurrentUser() actor: SessionUser, @Param('id', ParseUUIDPipe) userId: string, @Body() input: StatusInput) {
    return this.service.setStatus(actor, userId, input.status);
  }
}
