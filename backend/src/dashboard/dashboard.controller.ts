import { Controller, Get } from '@nestjs/common';
import { CurrentTenant, TenantScoped } from '../common/decorators';
import type { TenantContext } from '../common/request-context';
import { DashboardService } from './dashboard.service';

@TenantScoped()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  summary(@CurrentTenant() t: TenantContext) {
    return this.dashboard.summary(t);
  }
}
