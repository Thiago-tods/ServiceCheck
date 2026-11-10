import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CatalogModule } from './catalog/catalog.module';
import { ClientsModule } from './clients/clients.module';
import { validateEnv } from './config/env.validation';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SentryExceptionFilter } from './observability/sentry.filter';
import { OrdersModule } from './orders/orders.module';
import { PeopleModule } from './people/people.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { StorageModule } from './storage/storage.module';
import { SyncModule } from './sync/sync.module';
import { RolesGuard } from './tenancy/roles.guard';
import { TenancyModule } from './tenancy/tenancy.module';
import { TenantGuard } from './tenancy/tenant.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [{ ttl: 60_000, limit: 600 }],
        skipIf: () => config.get<boolean>('RATE_LIMIT_ENABLED') === false,
      }),
    }),
    PrismaModule,
    StorageModule,
    JobsModule,
    AuditModule,
    AuthModule,
    TenancyModule,
    ClientsModule,
    PeopleModule,
    CatalogModule,
    NotificationsModule,
    OrdersModule,
    SyncModule,
    DashboardModule,
    AttachmentsModule,
    ReportsModule,
    HealthModule,
  ],
  providers: [
    // Order matters: rate limit -> authenticate -> resolve tenant -> check role.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: SentryExceptionFilter },
  ],
})
export class AppModule {}
