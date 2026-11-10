import { configureApp } from './app.setup';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { initSentry } from './observability/sentry';

async function bootstrap(): Promise<void> {
  initSentry(process.env.SENTRY_DSN, process.env.NODE_ENV ?? 'development');
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  const port = app.get(ConfigService).get<number>('PORT', 3000);
  await app.listen(port);
}

void bootstrap();
