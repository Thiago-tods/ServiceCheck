import { Module } from '@nestjs/common';
import { AssignmentsService } from './assignments.service';
import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [OrdersController, ExecutionsController],
  providers: [OrdersService, AssignmentsService, ExecutionsService],
  exports: [OrdersService],
})
export class OrdersModule {}
