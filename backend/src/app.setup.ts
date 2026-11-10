import { INestApplication, ValidationPipe } from '@nestjs/common';

export const API_PREFIX = 'api/v1';

/** Shared by main.ts and e2e tests so both run with identical settings. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
}
