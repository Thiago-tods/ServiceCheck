import { configureApp } from './app.setup';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { initSentry } from './observability/sentry';
import { canonicalNodeEnv } from './config/env.validation';

async function bootstrap(): Promise<void> {
  // Libraries (Express among them) compare NODE_ENV case-sensitively: use the same spelling the
  // environment validation accepted.
  const nodeEnv = canonicalNodeEnv(process.env.NODE_ENV);
  if (nodeEnv) process.env.NODE_ENV = nodeEnv;
  initSentry(process.env.SENTRY_DSN, process.env.NODE_ENV ?? 'development');
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  const port = app.get(ConfigService).get<number>('PORT', 3000);
  await app.listen(port);
}

void bootstrap();
