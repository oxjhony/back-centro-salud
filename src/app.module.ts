import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MulterModule } from '@nestjs/platform-express';
import { DatabaseModule } from './infrastructure/database/database.module';
import { PgCourseRepository } from './infrastructure/database/repositories/pg-course.repository';
import { PgEditorialStore } from './infrastructure/database/repositories/pg-editorial.store';
import { PgInitiativeRepository } from './infrastructure/database/repositories/pg-initiative.repository';
import { PgNotificationStore } from './infrastructure/database/repositories/pg-notification.store';
import { PgAuditLog, PgIntegrationLog } from './infrastructure/database/repositories/pg-operation-logs';
import { PgResourceRepository } from './infrastructure/database/repositories/pg-resource.repository';
import { PgSearchIndex } from './infrastructure/database/repositories/pg-search.index';
import { PgTaxonomyRepository } from './infrastructure/database/repositories/pg-taxonomy.repository';
import { PgUserRepository } from './infrastructure/database/repositories/pg-user.repository';
import { DEV_ACCOUNTS } from './infrastructure/identity/dev-accounts';
import { LocalIdentityProvider } from './infrastructure/identity/local-identity.provider';
import { MoodleWsGateway } from './infrastructure/moodle/moodle-ws.gateway';
import { LocalFileStorage } from './infrastructure/storage/local-file.storage';
import { CoursesService } from './modules/courses/application/courses.service';
import { LmsLinkService } from './modules/courses/application/lms-link.service';
import { COURSE_REPOSITORY, MOODLE_GATEWAY } from './modules/courses/application/ports';
import {
  CoursesController,
  MoodleAdminController,
  PublicCoursesController,
} from './modules/courses/http/courses.controller';
import { EditorialService } from './modules/editorial/application/editorial.service';
import { EDITORIAL_STORE } from './modules/editorial/application/ports';
import { EditorialController } from './modules/editorial/http/editorial.controller';
import { AuthService } from './modules/identity/application/auth.service';
import { IDENTITY_PROVIDER, USER_REPOSITORY } from './modules/identity/application/ports';
import { ProfileService } from './modules/identity/application/profile.service';
import { UsersAdminService } from './modules/identity/application/users-admin.service';
import { AccessGuard } from './modules/identity/http/access';
import { AuthController, ProfileController } from './modules/identity/http/auth.controller';
import { UsersAdminController } from './modules/identity/http/users-admin.controller';
import { INITIATIVE_REPOSITORY, InitiativesService } from './modules/initiatives/application/initiatives.service';
import {
  InitiativesController,
  PublicInitiativesController,
} from './modules/initiatives/http/initiatives.controller';
import {
  NOTIFICATION_STORE,
  NotificationsController,
  NotificationsService,
} from './modules/notifications/notifications';
import { HealthController, OperationsAdminController } from './modules/operations/operations.controller';
import { AUDIT_LOG, INTEGRATION_LOG } from './modules/operations/ports';
import { FILE_STORAGE, RESOURCE_REPOSITORY } from './modules/resources/application/ports';
import { ResourcesService } from './modules/resources/application/resources.service';
import { PublicResourcesController, ResourcesController } from './modules/resources/http/resources.controller';
import { SEARCH_INDEX, SearchController } from './modules/search/search';
import { TAXONOMY_REPOSITORY, TaxonomyService } from './modules/taxonomy/application/taxonomy.service';
import { CatalogsController, TaxonomyAdminController } from './modules/taxonomy/http/taxonomy.controller';
import { APP_CONFIG, AppConfig, loadConfig } from './shared/config';
import { DomainErrorFilter } from './shared/errors';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
class ConfigModule {}

/**
 * Monolito modular. Este archivo es el unico lugar donde un puerto se une con su adaptador:
 * cambiar de proveedor de identidad, de LMS, de almacenamiento o de base de datos se resuelve
 * aqui, sin tocar los casos de uso ni el dominio.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.session.secret,
        signOptions: { expiresIn: config.session.ttlSeconds },
      }),
    }),
    // Los archivos se leen en memoria con un tope: lo que lo supera se rechaza con 413 antes de procesarlo.
    MulterModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ limits: { fileSize: config.storage.maxUploadBytes, files: 1 } }),
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    ProfileController,
    NotificationsController,
    UsersAdminController,
    CatalogsController,
    TaxonomyAdminController,
    EditorialController,
    InitiativesController,
    PublicInitiativesController,
    ResourcesController,
    PublicResourcesController,
    CoursesController,
    PublicCoursesController,
    MoodleAdminController,
    SearchController,
    OperationsAdminController,
  ],
  providers: [
    // Casos de uso
    AuthService,
    ProfileService,
    UsersAdminService,
    NotificationsService,
    TaxonomyService,
    EditorialService,
    InitiativesService,
    ResourcesService,
    CoursesService,
    LmsLinkService,

    // Adaptadores de persistencia
    { provide: USER_REPOSITORY, useClass: PgUserRepository },
    { provide: TAXONOMY_REPOSITORY, useClass: PgTaxonomyRepository },
    { provide: EDITORIAL_STORE, useClass: PgEditorialStore },
    { provide: NOTIFICATION_STORE, useClass: PgNotificationStore },
    { provide: INITIATIVE_REPOSITORY, useClass: PgInitiativeRepository },
    { provide: RESOURCE_REPOSITORY, useClass: PgResourceRepository },
    { provide: COURSE_REPOSITORY, useClass: PgCourseRepository },
    { provide: SEARCH_INDEX, useClass: PgSearchIndex },
    { provide: AUDIT_LOG, useClass: PgAuditLog },
    { provide: INTEGRATION_LOG, useClass: PgIntegrationLog },

    // Adaptadores de sistemas externos
    {
      provide: IDENTITY_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new LocalIdentityProvider(DEV_ACCOUNTS, config.identity.localPassword),
    },
    {
      provide: MOODLE_GATEWAY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new MoodleWsGateway(config.moodle.baseUrl, config.moodle.token, config.moodle.timeoutMs),
    },
    {
      provide: FILE_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new LocalFileStorage(config.storage.dir),
    },

    // Transversales: toda ruta pasa por el control de acceso y por el traductor de errores de dominio.
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule {}
