import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentTenant, CurrentUser, Roles, TenantScoped } from '../common/decorators';
import type { AuthUser, TenantContext } from '../common/request-context';
import { AssignmentsService } from './assignments.service';
import { ExecutionsService } from './executions.service';
import {
  AgendaQuery,
  AssignDto,
  CreateOrderDto,
  HistoryQuery,
  NoteDto,
  OrderListQuery,
  ReasonDto,
  ReopenDto,
  SignatureReviewDto,
} from './orders.dto';
import { OrdersService } from './orders.service';

const STAFF = [Role.OWNER, Role.ADMIN, Role.RECEPTIONIST];
const ADMINS = [Role.OWNER, Role.ADMIN];

@Controller()
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly assignments: AssignmentsService,
    private readonly executions: ExecutionsService,
  ) {}

  @Roles(...STAFF)
  @Post('work-orders')
  create(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Body() dto: CreateOrderDto,
  ) {
    return this.orders.create(t, u.userId, dto);
  }

  @TenantScoped()
  @Get('work-orders')
  list(@CurrentTenant() t: TenantContext, @Query() q: OrderListQuery) {
    return this.orders.list(t, q);
  }

  @TenantScoped()
  @Get('work-orders/:id')
  get(@CurrentTenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(t, id);
  }

  @Roles(...STAFF)
  @Get('work-orders/:id/history')
  history(
    @CurrentTenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: HistoryQuery,
  ) {
    return this.orders.history(t, id, q.limit);
  }

  @Roles(...STAFF)
  @Post('work-orders/:id/cancel')
  cancel(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.orders.cancel(t, u.userId, id, dto.reason);
  }

  @Roles(...STAFF)
  @Post('work-orders/:id/assignments')
  assign(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignDto,
  ) {
    return this.assignments.assign(t, u.userId, id, dto);
  }

  @Roles(...STAFF)
  @Post('work-orders/:id/assignments/:assignmentId/release')
  release(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.assignments.release(t, u.userId, id, assignmentId, dto.reason);
  }

  @TenantScoped()
  @Get('agenda')
  agenda(@CurrentTenant() t: TenantContext, @Query() q: AgendaQuery) {
    return this.assignments.agenda(t, q);
  }

  /** Any assigned member may start; the service proves it is one of the active assignees. */
  @TenantScoped()
  @Post('work-orders/:id/start')
  start(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.executions.start(t, u.userId, id);
  }

  @TenantScoped()
  @Post('work-orders/:id/signature-review')
  review(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignatureReviewDto,
  ) {
    return this.orders.reviewSignature(t, u.userId, id, dto);
  }

  @Roles(...ADMINS)
  @Post('work-orders/:id/approve')
  approve(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NoteDto,
  ) {
    return this.orders.approve(t, u.userId, id, dto.note);
  }

  @Roles(...ADMINS)
  @Post('work-orders/:id/reopen')
  reopen(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReopenDto,
  ) {
    return this.orders.reopen(t, u.userId, id, dto.reason);
  }
}
