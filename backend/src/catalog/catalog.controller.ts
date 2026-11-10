import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentTenant, CurrentUser, Roles, TenantScoped } from '../common/decorators';
import type { AuthUser, TenantContext } from '../common/request-context';
import { CreateServiceDto, PublishChecklistDto, UpdateServiceDto } from './catalog.dto';
import { CatalogService } from './catalog.service';

const MANAGERS = [Role.OWNER, Role.ADMIN];

@Controller('services')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @TenantScoped()
  @Get()
  list(@CurrentTenant() t: TenantContext) {
    return this.catalog.list(t);
  }

  @TenantScoped()
  @Get(':id')
  get(@CurrentTenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.get(t, id);
  }

  @Roles(...MANAGERS)
  @Post()
  create(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Body() dto: CreateServiceDto,
  ) {
    return this.catalog.create(t, u.userId, dto);
  }

  @Roles(...MANAGERS)
  @Patch(':id')
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.catalog.update(t, id, dto);
  }

  @TenantScoped()
  @Get(':id/checklist-versions')
  versions(@CurrentTenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.listVersions(t, id);
  }

  @Roles(...MANAGERS)
  @Post(':id/checklist-versions')
  publish(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishChecklistDto,
  ) {
    return this.catalog.publishChecklist(t, u.userId, id, dto);
  }
}
