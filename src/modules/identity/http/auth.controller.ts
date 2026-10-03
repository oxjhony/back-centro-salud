import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Put, Res } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Response } from 'express';
import { APP_CONFIG, AppConfig } from '../../../shared/config';
import { AuthService } from '../application/auth.service';
import { ProfileService } from '../application/profile.service';
import { SessionUser } from '../domain/permissions';
import { CurrentUser, Public, SESSION_COOKIE } from './access';

class LoginInput {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password: string;
}

class ProfileInput {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  displayName: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  affiliation?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  generalTerritory?: string | null;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  interests: string[];

  @IsBoolean()
  notificationOptIn: boolean;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() input: LoginInput, @Res({ passthrough: true }) response: Response) {
    const { user, token } = await this.auth.login(input.email, input.password);
    // httpOnly: el token no es legible desde JavaScript. secure: solo viaja por HTTPS en produccion.
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.production,
      maxAge: this.config.session.ttlSeconds * 1000,
      path: '/',
    });
    return { user };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  /** Publica a proposito: sin sesion responde `user: null` en lugar de un error. */
  @Public()
  @Get('me')
  me(@CurrentUser() user: SessionUser | null) {
    return { user };
  }
}

/** Perfil propio: basta con tener sesion, como el "editar mi perfil" de cualquier usuario de Moodle. */
@Controller('me/profile')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  get(@CurrentUser() user: SessionUser) {
    return this.profiles.get(user);
  }

  @Put()
  update(@CurrentUser() user: SessionUser, @Body() input: ProfileInput) {
    return this.profiles.update(user, {
      displayName: input.displayName.trim(),
      affiliation: input.affiliation?.trim() || null,
      generalTerritory: input.generalTerritory?.trim() || null,
      interests: input.interests,
      notificationOptIn: input.notificationOptIn,
    });
  }

  @Delete('optional-data')
  clearOptional(@CurrentUser() user: SessionUser) {
    return this.profiles.clearOptionalData(user);
  }
}
