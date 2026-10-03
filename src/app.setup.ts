import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { APP_CONFIG, AppConfig } from './shared/config';

/** Configuracion HTTP compartida por el arranque real y por las pruebas de extremo a extremo. */
export function configureApp(app: INestApplication): void {
  const config = app.get<AppConfig>(APP_CONFIG);

  app.use(cookieParser());
  // credentials: el navegador solo envia la cookie de sesion a los origenes declarados.
  app.enableCors({ origin: config.frontendOrigins, credentials: true });
  // whitelist + forbidNonWhitelisted: un campo no declarado en el DTO se rechaza, no se ignora.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
}
