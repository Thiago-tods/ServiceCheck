import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({ imports: [OrdersModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
