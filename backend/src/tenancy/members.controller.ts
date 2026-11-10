import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentTenant, CurrentUser, Roles } from '../common/decorators';
import type { AuthUser, TenantContext } from '../common/request-context';
import { AddMemberDto, UpdateMemberDto } from './dto';
import { MembersService } from './members.service';

@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Roles(Role.OWNER, Role.ADMIN, Role.RECEPTIONIST)
  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.members.list(tenant);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Post()
  add(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Body() dto: AddMemberDto,
  ) {
    return this.members.add(tenant, user.userId, dto);
  }

  /** Members are deactivated (active=false), never deleted: history must stay intact. */
  @Roles(Role.OWNER, Role.ADMIN)
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.members.update(tenant, user.userId, id, dto);
  }
}
