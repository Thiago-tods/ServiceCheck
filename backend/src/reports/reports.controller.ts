import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { CurrentTenant, CurrentUser, Roles, TenantScoped } from '../common/decorators';
import type { AuthUser, TenantContext } from '../common/request-context';
import { ReportsService } from './reports.service';

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Roles(Role.OWNER, Role.ADMIN, Role.RECEPTIONIST)
  @HttpCode(202)
  @Post('work-orders/:id/reports')
  request(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reports.request(t, u.userId, id);
  }

  @TenantScoped()
  @Get('reports/:id')
  status(@CurrentTenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.status(t, id);
  }

  @TenantScoped()
  @Get('reports/:id/download')
  async download(
    @CurrentTenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.reports.download(t, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="servicecheck-report-${id}.pdf"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.send(file.body);
  }
}
