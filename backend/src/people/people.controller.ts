import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentTenant, CurrentUser, Roles, TenantScoped } from '../common/decorators';
import type { AuthUser, TenantContext } from '../common/request-context';
import { CreateNamedDto, SetSpecialtiesDto, SetTeamMembersDto, UpdateNamedDto } from './people.dto';
import { PeopleService } from './people.service';

const MANAGERS = [Role.OWNER, Role.ADMIN];

@Controller()
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @TenantScoped()
  @Get('specialties')
  listSpecialties(@CurrentTenant() t: TenantContext) {
    return this.people.listSpecialties(t);
  }

  @Roles(...MANAGERS)
  @Post('specialties')
  createSpecialty(@CurrentTenant() t: TenantContext, @Body() dto: CreateNamedDto) {
    return this.people.createSpecialty(t, dto);
  }

  @Roles(...MANAGERS)
  @Patch('specialties/:id')
  updateSpecialty(
    @CurrentTenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNamedDto,
  ) {
    return this.people.updateSpecialty(t, id, dto);
  }

  @Roles(...MANAGERS)
  @Put('members/:id/specialties')
  setMemberSpecialties(
    @CurrentTenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetSpecialtiesDto,
  ) {
    return this.people.setMemberSpecialties(t, id, dto.specialtyIds);
  }

  @TenantScoped()
  @Get('teams')
  listTeams(@CurrentTenant() t: TenantContext) {
    return this.people.listTeams(t);
  }

  @Roles(...MANAGERS)
  @Post('teams')
  createTeam(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Body() dto: CreateNamedDto,
  ) {
    return this.people.createTeam(t, u.userId, dto);
  }

  @Roles(...MANAGERS)
  @Patch('teams/:id')
  updateTeam(
    @CurrentTenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNamedDto,
  ) {
    return this.people.updateTeam(t, id, dto);
  }

  @Roles(...MANAGERS)
  @Put('teams/:id/members')
  setTeamMembers(
    @CurrentTenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTeamMembersDto,
  ) {
    return this.people.setTeamMembers(t, id, dto.membershipIds);
  }
}
