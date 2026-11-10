import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsService } from '../jobs/jobs.service';
import { TenantContext } from '../common/request-context';
import { OrderEventsService } from '../orders/order-events.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE } from '../storage/storage';
import type { StorageDriver } from '../storage/storage';
import { buildReportPdf, Locale, ReportData } from './report-pdf';

const MAX_PHOTOS = 6;

@Injectable()
export class ReportsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly orders: OrdersService,
    private readonly events: OrderEventsService,
    private readonly config: ConfigService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  onModuleInit(): void {
    this.jobs.register('REPORT_PDF', {
      run: (payload) => this.generate(payload.reportId as string),
      onFailed: async (payload, error) => {
        await this.prisma.report.update({
          where: { id: payload.reportId as string },
          data: { status: 'FAILED', error: error.slice(0, 500), completedAt: new Date() },
        });
      },
    });
  }

  /** Reports are built asynchronously by the job worker; the caller polls the report status. */
  async request(t: TenantContext, actor: string, orderId: string) {
    await this.orders.assertVisible(t, orderId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor },
      select: { locale: true },
    });
    return this.prisma.transactional(async (tx) => {
      const finished = await tx.execution.count({
        where: { workOrderId: orderId, status: 'FINISHED' },
      });
      if (finished === 0)
        throw new ConflictException('The order has no finished execution to report');
      const report = await tx.report.create({
        data: { companyId: t.companyId, workOrderId: orderId, requestedBy: t.membershipId },
      });
      await this.jobs.enqueue(tx, 'REPORT_PDF', { reportId: report.id, locale: user.locale });
      await this.events.record(
        t,
        actor,
        orderId,
        'order.report_requested',
        { reportId: report.id },
        tx,
      );
      return { id: report.id, status: report.status };
    });
  }

  private async findVisible(t: TenantContext, id: string) {
    const report = await this.prisma.report.findFirst({ where: { id, companyId: t.companyId } });
    if (!report) throw new NotFoundException('Report not found');
    await this.orders.assertVisible(t, report.workOrderId);
    return report;
  }

  async status(t: TenantContext, id: string) {
    const r = await this.findVisible(t, id);
    return {
      id: r.id,
      status: r.status,
      error: r.error,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    };
  }

  async download(t: TenantContext, id: string) {
    const report = await this.findVisible(t, id);
    if (report.status !== 'DONE' || !report.storageKey) {
      throw new ConflictException(`Report is ${report.status}`);
    }
    return { body: await this.storage.get(report.storageKey), number: report.workOrderId };
  }

  /** Runs inside the job worker. Idempotent: regenerating overwrites the same storage key. */
  async generate(reportId: string): Promise<void> {
    const report = await this.prisma.report.findUniqueOrThrow({ where: { id: reportId } });
    const order = await this.prisma.workOrder.findUniqueOrThrow({
      where: { id: report.workOrderId },
      include: {
        executions: {
          orderBy: { sequence: 'asc' },
          include: {
            participants: {
              include: { membership: { include: { user: { select: { name: true } } } } },
            },
            items: { orderBy: { position: 'asc' } },
            notes: { orderBy: { createdAt: 'asc' } },
            signature: true,
            attachments: {
              where: { contentType: { in: ['image/png', 'image/jpeg'] } },
              orderBy: { createdAt: 'asc' },
              take: MAX_PHOTOS,
            },
          },
        },
      },
    });
    const memberIds = [
      ...new Set(order.executions.flatMap((e) => e.notes.map((n) => n.membershipId))),
    ];
    const authors = await this.prisma.membership.findMany({
      where: { id: { in: memberIds } },
      include: { user: { select: { name: true } } },
    });
    const authorName = (id: string) => authors.find((a) => a.id === id)?.user.name ?? '—';
    const requester = await this.prisma.membership.findUnique({
      where: { id: report.requestedBy },
      include: { user: { select: { locale: true } } },
    });
    const locale: Locale = requester?.user.locale === 'en' ? 'en' : 'pt_BR';

    const client = order.clientSnapshot as unknown as ReportData['client'];
    const service = order.serviceSnapshot as unknown as {
      name: string;
      checklistVersion: number | null;
    };

    const executions = await Promise.all(
      order.executions
        .filter((e) => e.status !== 'PENDING')
        .map(async (e) => ({
          sequence: e.sequence,
          startedAt: e.startedAt,
          finishedAt: e.finishedAt,
          reopenReason: e.reopenReason,
          participants: e.participants.map((p) => ({
            name: p.membership.user.name,
            primary: p.isPrimary,
          })),
          items: e.items.map((i) => ({
            label: i.label,
            kind: i.kind,
            required: i.required,
            done: i.done,
            value: i.value,
          })),
          notes: e.notes.map((n) => ({
            author: authorName(n.membershipId),
            text: n.text,
            at: n.createdAt,
          })),
          signature: e.signature
            ? {
                status: e.signature.status,
                signerName: e.signature.signerName,
                reason: e.signature.reason,
                capturedAt: e.signature.capturedAt,
                image: e.signature.image ? Buffer.from(e.signature.image) : null,
              }
            : undefined,
          photos: await Promise.all(
            e.attachments.map(async (a) => ({
              filename: a.filename,
              buffer: await this.storage.get(a.storageKey),
            })),
          ),
        })),
    );

    const pdf = await buildReportPdf(
      {
        orderId: order.id,
        number: order.number,
        title: order.title,
        description: order.description,
        status: order.status,
        createdAt: order.createdAt,
        client,
        service,
        executions,
        generatedAt: new Date(),
      },
      locale,
      { compress: this.config.get<string>('NODE_ENV') !== 'test' },
    );
    const key = `reports/${report.companyId}/${report.id}.pdf`;
    await this.storage.put(key, pdf, 'application/pdf');
    await this.prisma.report.update({
      where: { id: reportId },
      data: { status: 'DONE', storageKey: key, error: null, completedAt: new Date() },
    });
  }
}
