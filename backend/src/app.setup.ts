import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

export const API_PREFIX = 'api/v1';

/**
 * Shared by main.ts and e2e tests so both run with identical settings.
 *
 * `trust proxy` is deliberately NOT enabled: no trusted reverse proxy is part of the
 * documented architecture, and trusting X-Forwarded-For without one would let any client
 * spoof its IP and bypass the rate limit. Enable it only with a known proxy (docs/development.md).
 */
export function configureApp(app: INestApplication): void {
  // JSON API: Helmet's defaults are safe (nosniff, no frame embedding, HSTS, no referrer, ...).
  app.use(helmet());
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
}
