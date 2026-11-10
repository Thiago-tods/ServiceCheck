import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentTenant, CurrentUser, Roles } from '../common/decorators';
import { PageQuery } from '../common/pagination';
import type { AuthUser, TenantContext } from '../common/request-context';
import {
  CreateAddressDto,
  CreateClientDto,
  CreateContactDto,
  UpdateAddressDto,
  UpdateClientDto,
  UpdateContactDto,
} from './clients.dto';
import { ClientsService } from './clients.service';

const STAFF = [Role.OWNER, Role.ADMIN, Role.RECEPTIONIST];

/** Clients are office data: Professionals see client details only through their work orders. */
@Roles(...STAFF)
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Post()
  create(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Body() dto: CreateClientDto,
  ) {
    return this.clients.create(t, u.userId, dto);
  }

  @Get()
  list(@CurrentTenant() t: TenantContext, @Query() page: PageQuery) {
    return this.clients.list(t, page);
  }

  @Get(':id')
  get(@CurrentTenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.clients.get(t, id);
  }

  @Patch(':id')
  update(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clients.update(t, u.userId, id, dto);
  }

  @Post(':id/contacts')
  addContact(
    @CurrentTenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateContactDto,
  ) {
    return this.clients.addContact(t, id, dto);
  }

  @Patch(':id/contacts/:contactId')
  updateContact(
    @CurrentTenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.clients.updateContact(t, id, contactId, dto);
  }

  @Post(':id/addresses')
  addAddress(
    @CurrentTenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAddressDto,
  ) {
    return this.clients.addAddress(t, id, dto);
  }

  @Patch(':id/addresses/:addressId')
  updateAddress(
    @CurrentTenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.clients.updateAddress(t, id, addressId, dto);
  }
}
