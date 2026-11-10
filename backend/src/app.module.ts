import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { ClientsModule } from './clients/clients.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { OrdersModule } from './orders/orders.module';
import { PeopleModule } from './people/people.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { SyncModule } from './sync/sync.module';
import { PrismaModule } from './prisma/prisma.module';
import { RolesGuard } from './tenancy/roles.guard';
import { TenancyModule } from './tenancy/tenancy.module';
import { TenantGuard } from './tenancy/tenant.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
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
    HealthModule,
  ],
  providers: [
    // Order matters: authenticate -> resolve tenant -> check role.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
