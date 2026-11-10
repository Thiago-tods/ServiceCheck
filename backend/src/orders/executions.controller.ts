import { Body, Controller, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { CurrentTenant, CurrentUser, TenantScoped } from '../common/decorators';
import type { AuthUser, TenantContext } from '../common/request-context';
import { ExecutionsService } from './executions.service';
import { AddNoteDto, CaptureSignatureDto, SetPrimaryDto, UpdateItemDto } from './orders.dto';

/** Every route here is limited to active participants of the execution (checked in the service). */
@TenantScoped()
@Controller('executions')
export class ExecutionsController {
  constructor(private readonly executions: ExecutionsService) {}

  @Patch(':id/items/:itemId')
  updateItem(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.executions.updateItem(t, u.userId, id, itemId, dto);
  }

  @Post(':id/notes')
  addNote(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddNoteDto,
  ) {
    return this.executions.addNote(t, u.userId, id, dto.text);
  }

  @Put(':id/primary')
  setPrimary(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPrimaryDto,
  ) {
    return this.executions.setPrimary(t, u.userId, id, dto.membershipId);
  }

  @Put(':id/signature')
  signature(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CaptureSignatureDto,
  ) {
    return this.executions.captureSignature(t, u.userId, id, dto);
  }

  @Post(':id/finish')
  finish(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.executions.finish(t, u.userId, id);
  }
}
