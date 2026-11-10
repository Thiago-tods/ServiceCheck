import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsBooleanString, IsOptional } from 'class-validator';
import { CurrentTenant, TenantScoped } from '../common/decorators';
import { PageQuery } from '../common/pagination';
import type { TenantContext } from '../common/request-context';
import { NotificationsService } from './notifications.service';

class NotificationQuery extends PageQuery {
  @IsOptional() @IsBooleanString() unread?: string;
}

@TenantScoped()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentTenant() t: TenantContext, @Query() q: NotificationQuery) {
    return this.notifications.list(t, q.unread === 'true', q);
  }

  @Post('read-all')
  readAll(@CurrentTenant() t: TenantContext) {
    return this.notifications.markAllRead(t);
  }

  @Post(':id/read')
  read(@CurrentTenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(t, id);
  }
}
