import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  controllers: [CompaniesController, MembersController],
  providers: [CompaniesService, MembersService],
})
export class TenancyModule {}
