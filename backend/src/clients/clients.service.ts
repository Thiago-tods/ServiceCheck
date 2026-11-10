import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PageQuery } from '../common/pagination';
import { TenantContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAddressDto,
  CreateClientDto,
  CreateContactDto,
  UpdateAddressDto,
  UpdateClientDto,
  UpdateContactDto,
} from './clients.dto';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(t: TenantContext, actor: string, dto: CreateClientDto) {
    const client = await this.prisma.client.create({ data: { ...dto, companyId: t.companyId } });
    await this.audit.record({
      companyId: t.companyId,
      actorUserId: actor,
      action: 'client.created',
      entityType: 'Client',
      entityId: client.id,
    });
    return client;
  }

  list(t: TenantContext, page: PageQuery) {
    return this.prisma.client.findMany({
      where: {
        companyId: t.companyId,
        ...(page.q ? { name: { contains: page.q, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
      take: page.limit,
      skip: page.offset,
    });
  }

  async get(t: TenantContext, id: string) {
    const client = await this.prisma.client.findFirst({
      where: { id, companyId: t.companyId },
      include: { contacts: true, addresses: true },
    });
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  async update(t: TenantContext, actor: string, id: string, dto: UpdateClientDto) {
    await this.get(t, id);
    const client = await this.prisma.client.update({ where: { id }, data: dto });
    await this.audit.record({
      companyId: t.companyId,
      actorUserId: actor,
      action: 'client.updated',
      entityType: 'Client',
      entityId: id,
      metadata: { ...dto },
    });
    return client;
  }

  async addContact(t: TenantContext, clientId: string, dto: CreateContactDto) {
    await this.get(t, clientId);
    return this.prisma.clientContact.create({ data: { ...dto, clientId, companyId: t.companyId } });
  }

  async updateContact(t: TenantContext, clientId: string, id: string, dto: UpdateContactDto) {
    const found = await this.prisma.clientContact.findFirst({
      where: { id, clientId, companyId: t.companyId },
    });
    if (!found) throw new NotFoundException('Contact not found');
    return this.prisma.clientContact.update({ where: { id }, data: dto });
  }

  async addAddress(t: TenantContext, clientId: string, dto: CreateAddressDto) {
    await this.get(t, clientId);
    return this.prisma.clientAddress.create({ data: { ...dto, clientId, companyId: t.companyId } });
  }

  async updateAddress(t: TenantContext, clientId: string, id: string, dto: UpdateAddressDto) {
    const found = await this.prisma.clientAddress.findFirst({
      where: { id, clientId, companyId: t.companyId },
    });
    if (!found) throw new NotFoundException('Address not found');
    return this.prisma.clientAddress.update({ where: { id }, data: dto });
  }
}
