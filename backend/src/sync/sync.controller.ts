import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { CurrentTenant, CurrentUser, TenantScoped } from '../common/decorators';
import type { AuthUser, TenantContext } from '../common/request-context';
import { SyncPullQuery, SyncPushDto } from './sync.dto';
import { SyncService } from './sync.service';

@TenantScoped()
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @HttpCode(200)
  @Post('push')
  push(@CurrentTenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: SyncPushDto) {
    return this.sync.push(t, u.userId, dto.operations);
  }

  @Get('pull')
  pull(@CurrentTenant() t: TenantContext, @Query() q: SyncPullQuery) {
    return this.sync.pull(t, q);
  }

  @Get('conflicts')
  conflicts(@CurrentTenant() t: TenantContext) {
    return this.sync.conflicts(t);
  }
}
