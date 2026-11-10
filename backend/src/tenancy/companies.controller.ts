import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/request-context';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCompanyDto) {
    return this.companies.create(user.userId, dto.name);
  }

  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.companies.listForUser(user.userId);
  }
}
