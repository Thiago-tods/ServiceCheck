import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({ imports: [OrdersModule], controllers: [SyncController], providers: [SyncService] })
export class SyncModule {}
