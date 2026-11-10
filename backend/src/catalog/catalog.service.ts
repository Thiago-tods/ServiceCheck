import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { conflictOr } from '../common/errors';
import { TenantContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto, PublishChecklistDto, UpdateServiceDto } from './catalog.dto';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(t: TenantContext, actor: string, dto: CreateServiceDto) {
    const service = await this.prisma.service
      .create({ data: { ...dto, companyId: t.companyId } })
      .catch((e: unknown) => conflictOr(e, 'Service already exists'));
    await this.audit.record({
      companyId: t.companyId,
      actorUserId: actor,
      action: 'service.created',
      entityType: 'Service',
      entityId: service.id,
    });
    return service;
  }

  list(t: TenantContext) {
    return this.prisma.service.findMany({
      where: { companyId: t.companyId },
      orderBy: { name: 'asc' },
    });
  }

  async get(t: TenantContext, id: string) {
    const service = await this.prisma.service.findFirst({
      where: { id, companyId: t.companyId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          include: { items: { orderBy: { position: 'asc' } } },
        },
      },
    });
    if (!service) throw new NotFoundException('Service not found');
    const { versions, ...rest } = service;
    return { ...rest, currentChecklist: versions[0] ?? null };
  }

  async update(t: TenantContext, id: string, dto: UpdateServiceDto) {
    await this.get(t, id);
    return this.prisma.service
      .update({ where: { id }, data: dto })
      .catch((e: unknown) => conflictOr(e, 'Service already exists'));
  }

  /** Publishes a new immutable version; the previous ones stay untouched for historical orders. */
  async publishChecklist(
    t: TenantContext,
    actor: string,
    serviceId: string,
    dto: PublishChecklistDto,
  ) {
    await this.get(t, serviceId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const last = await tx.serviceChecklistVersion.aggregate({
          where: { serviceId },
          _max: { version: true },
        });
        const version = await tx.serviceChecklistVersion.create({
          data: {
            companyId: t.companyId,
            serviceId,
            version: (last._max.version ?? 0) + 1,
            createdBy: actor,
            items: {
              create: dto.items.map((item, position) => ({
                position,
                label: item.label,
                kind: item.kind ?? 'CHECK',
                required: item.required ?? false,
              })),
            },
          },
          include: { items: { orderBy: { position: 'asc' } } },
        });
        await this.audit.record(
          {
            companyId: t.companyId,
            actorUserId: actor,
            action: 'checklist.published',
            entityType: 'ServiceChecklistVersion',
            entityId: version.id,
            metadata: { serviceId, version: version.version },
          },
          tx,
        );
        return version;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Concurrent checklist publication, retry');
      }
      throw e;
    }
  }

  async listVersions(t: TenantContext, serviceId: string) {
    await this.get(t, serviceId);
    return this.prisma.serviceChecklistVersion.findMany({
      where: { serviceId, companyId: t.companyId },
      orderBy: { version: 'desc' },
      include: { items: { orderBy: { position: 'asc' } } },
    });
  }
}
