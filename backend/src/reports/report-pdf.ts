import PDFDocument from 'pdfkit';

export type Locale = 'pt_BR' | 'en';

export interface ExecutionData {
  sequence: number;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  reopenReason?: string | null;
  participants: { name: string; primary: boolean }[];
  items: { label: string; kind: string; required: boolean; done: boolean; value?: string | null }[];
  notes: { author: string; text: string; at: Date }[];
  signature?: {
    status: string;
    signerName?: string | null;
    reason?: string | null;
    capturedAt: Date;
    image?: Buffer | null;
  };
  photos: { filename: string; buffer: Buffer }[];
}

export interface ReportData {
  orderId: string;
  number: number;
  title: string;
  description?: string | null;
  status: string;
  createdAt: Date;
  client: {
    name: string;
    document?: string | null;
    contact?: { name: string; phone?: string | null; email?: string | null } | null;
    address: {
      street: string;
      number?: string | null;
      district?: string | null;
      city: string;
      state: string;
      zip?: string | null;
    };
  };
  service: { name: string; checklistVersion: number | null };
  executions: ExecutionData[];
  generatedAt: Date;
}

const LABELS = {
  pt_BR: {
    report: 'Relatório de Ordem de Serviço',
    order: 'Ordem',
    status: 'Situação',
    created: 'Criada em',
    client: 'Cliente',
    document: 'Documento',
    contact: 'Contato',
    address: 'Endereço',
    service: 'Serviço',
    checklistVersion: 'Versão do checklist',
    execution: 'Execução',
    started: 'Início',
    finished: 'Fim',
    reopened: 'Reaberta',
    team: 'Equipe',
    primary: 'responsável',
    checklist: 'Checklist',
    required: 'obrigatório',
    notes: 'Observações técnicas',
    signature: 'Assinatura',
    signer: 'Assinante',
    reason: 'Motivo',
    photos: 'Fotografias',
    none: '—',
    generated: 'Gerado em',
    statuses: { SIGNED: 'Assinada', REFUSED: 'Recusada', ABSENT: 'Ausente' } as Record<
      string,
      string
    >,
    orderStatuses: {
      OPEN: 'Aberta',
      SCHEDULED: 'Agendada',
      IN_PROGRESS: 'Em execução',
      SIGNATURE_REVIEW: 'Revisão de assinatura',
      PENDING_APPROVAL: 'Aguardando aprovação',
      APPROVED: 'Aprovada',
      CANCELLED: 'Cancelada',
    } as Record<string, string>,
  },
  en: {
    report: 'Work Order Report',
    order: 'Order',
    status: 'Status',
    created: 'Created',
    client: 'Client',
    document: 'Document',
    contact: 'Contact',
    address: 'Address',
    service: 'Service',
    checklistVersion: 'Checklist version',
    execution: 'Execution',
    started: 'Started',
    finished: 'Finished',
    reopened: 'Reopened',
    team: 'Team',
    primary: 'lead',
    checklist: 'Checklist',
    required: 'required',
    notes: 'Technical notes',
    signature: 'Signature',
    signer: 'Signed by',
    reason: 'Reason',
    photos: 'Photos',
    none: '—',
    generated: 'Generated',
    statuses: { SIGNED: 'Signed', REFUSED: 'Refused', ABSENT: 'Absent' } as Record<string, string>,
    orderStatuses: {
      OPEN: 'Open',
      SCHEDULED: 'Scheduled',
      IN_PROGRESS: 'In progress',
      SIGNATURE_REVIEW: 'Signature review',
      PENDING_APPROVAL: 'Pending approval',
      APPROVED: 'Approved',
      CANCELLED: 'Cancelled',
    } as Record<string, string>,
  },
};

const ACCENT = '#E8590C';
const TEXT = '#1F2328';
const MUTED = '#6B7280';
const MARGIN = 48;

export function buildReportPdf(
  data: ReportData,
  locale: Locale,
  opts: { compress?: boolean } = {},
): Promise<Buffer> {
  const L = LABELS[locale];
  const tag = locale === 'pt_BR' ? 'pt-BR' : 'en-US';
  const fmt = (d?: Date | null) =>
    d
      ? `${d.toLocaleString(tag, { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' })} UTC`
      : L.none;

  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    compress: opts.compress ?? true,
    info: {
      Title: `OS #${data.number} - ${data.title}`,
      Author: 'ServiceCheck',
      Subject: L.report,
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - MARGIN * 2;
  const ensure = (height: number) => {
    if (doc.y + height > doc.page.height - MARGIN) doc.addPage();
  };
  const heading = (text: string) => {
    ensure(40);
    doc
      .moveDown(0.8)
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(ACCENT)
      .text(text.toUpperCase());
    doc
      .moveTo(MARGIN, doc.y + 2)
      .lineTo(MARGIN + width, doc.y + 2)
      .strokeColor(ACCENT)
      .lineWidth(0.8)
      .stroke();
    doc.moveDown(0.6).fillColor(TEXT);
  };
  const kv = (label: string, value: string) => {
    ensure(16);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text(`${label}: `, { continued: true });
    doc.font('Helvetica').fillColor(TEXT).text(value);
  };

  // Header
  doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(18).text('ServiceCheck', MARGIN, 30);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(L.report);
  doc
    .moveDown(0.8)
    .font('Helvetica-Bold')
    .fontSize(15)
    .fillColor(TEXT)
    .text(`${L.order} #${data.number} — ${data.title}`);
  doc.moveDown(0.3);
  kv(L.status, L.orderStatuses[data.status] ?? data.status);
  kv(L.created, fmt(data.createdAt));
  if (data.description) kv('', data.description);

  heading(L.client);
  kv(L.client, data.client.name);
  if (data.client.document) kv(L.document, data.client.document);
  if (data.client.contact) {
    const c = data.client.contact;
    kv(L.contact, [c.name, c.phone, c.email].filter(Boolean).join(' · '));
  }
  const a = data.client.address;
  kv(
    L.address,
    [[a.street, a.number].filter(Boolean).join(', '), a.district, `${a.city}/${a.state}`, a.zip]
      .filter(Boolean)
      .join(' — '),
  );

  heading(L.service);
  kv(L.service, data.service.name);
  kv(L.checklistVersion, data.service.checklistVersion?.toString() ?? L.none);

  for (const e of data.executions) {
    heading(`${L.execution} ${e.sequence}`);
    kv(L.started, fmt(e.startedAt));
    kv(L.finished, fmt(e.finishedAt));
    if (e.reopenReason) kv(L.reopened, e.reopenReason);
    if (e.participants.length) {
      kv(
        L.team,
        e.participants.map((p) => (p.primary ? `${p.name} (${L.primary})` : p.name)).join(', '),
      );
    }

    if (e.items.length) {
      doc.moveDown(0.4).font('Helvetica-Bold').fontSize(10).fillColor(TEXT).text(L.checklist);
      for (const i of e.items) {
        ensure(14);
        const mark = i.done ? '[x]' : '[ ]';
        doc
          .font('Courier')
          .fontSize(9)
          .fillColor(i.done ? TEXT : MUTED)
          .text(`${mark} `, { continued: true });
        doc
          .font('Helvetica')
          .text(
            `${i.label}${i.required ? ` (${L.required})` : ''}${i.value ? ` — ${i.value}` : ''}`,
          );
      }
    }
    if (e.notes.length) {
      doc.moveDown(0.4).font('Helvetica-Bold').fontSize(10).fillColor(TEXT).text(L.notes);
      for (const n of e.notes) {
        ensure(24);
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(MUTED)
          .text(`${n.author} · ${fmt(n.at)}`);
        doc.fillColor(TEXT).text(n.text);
      }
    }
    if (e.signature) {
      const s = e.signature;
      doc.moveDown(0.4).font('Helvetica-Bold').fontSize(10).fillColor(TEXT).text(L.signature);
      kv(L.status, L.statuses[s.status] ?? s.status);
      if (s.signerName) kv(L.signer, s.signerName);
      if (s.reason) kv(L.reason, s.reason);
      kv('', fmt(s.capturedAt));
      if (s.image) {
        ensure(100);
        try {
          doc.image(s.image, MARGIN, doc.y + 4, { fit: [200, 80] });
          doc.y += 90;
        } catch {
          /* unreadable image: the textual record above remains */
        }
      }
    }
    if (e.photos.length) {
      doc.moveDown(0.4).font('Helvetica-Bold').fontSize(10).fillColor(TEXT).text(L.photos);
      for (const p of e.photos.slice(0, 6)) {
        ensure(170);
        try {
          doc.image(p.buffer, MARGIN, doc.y + 4, { fit: [240, 150] });
          doc.y += 160;
          doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(p.filename);
        } catch {
          doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(p.filename);
        }
      }
    }
  }

  doc.moveDown(1.2).font('Courier').fontSize(8).fillColor(MUTED).text(`${data.orderId}`);
  doc.font('Helvetica').text(`${L.generated}: ${fmt(data.generatedAt)}`);
  doc.end();
  return done;
}
