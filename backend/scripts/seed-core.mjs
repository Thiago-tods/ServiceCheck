/**
 * The demo data, created through the backend API.
 *
 * Every step looks for what it needs by its natural key (e-mail, name, title) and only creates
 * what is missing. So running it again never duplicates anything, and a run that stopped halfway
 * (network error, server error, Ctrl+C) is simply completed by the next one. Nothing is ever
 * deleted or overwritten: the only HTTP methods used are GET and POST.
 */

export class SeedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeedError';
  }
}

// Public, development-only credentials. Never reuse them anywhere real.
export const DEMO = {
  password: 'Demo-Only-Passw0rd!',
  owner: { name: 'Dono Demo', email: 'owner@demo.servicecheck.test' },
  tech: { name: 'Técnico Demo', email: 'tecnico@demo.servicecheck.test' },
  company: 'Demo Serviços Técnicos',
  client: 'Cliente Demonstração',
  address: { label: 'Sede', street: 'Rua Exemplo, 100', city: 'Cidade Exemplo', state: 'SP' },
  service: 'Manutenção elétrica',
  checklist: [
    { label: 'Desligar o disjuntor', required: true },
    { label: 'Foto do quadro', kind: 'PHOTO' },
    { label: 'Observação do técnico', kind: 'TEXT' },
  ],
  orders: [
    { title: 'Demo 1 - Quadro principal', inDays: 1 },
    { title: 'Demo 2 - Iluminação', inDays: 2 },
  ],
};

/** 09:00-10:00 UTC, `days` from `now`. */
export function slot(days, now = new Date()) {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() + days);
  start.setUTCHours(9, 0, 0, 0);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3600_000).toISOString(),
  };
}

// The API's page limit for lists (PageQuery: limit 1..200, default 50). Asking for the maximum
// keeps the number of requests low without ever exceeding what the API accepts.
export const PAGE_SIZE = 200;
// A safety net, not a feature: stops a server that never runs out of pages from looping forever.
export const MAX_PAGES = 200;

/**
 * Reads EVERY record of a paginated list (GET /clients, GET /work-orders), page by page, so a
 * record is never "not found" just because it is on a later page. It either returns the complete
 * list or throws: a failed, malformed or inconsistent page never ends in a partial list, so the
 * seed never creates something on the strength of an incomplete search.
 */
async function listAll(call, path, as, label, { pageSize, maxPages }) {
  const items = [];
  const seen = new Set();
  for (let page = 0; page < maxPages; page++) {
    const res = await call('GET', `${path}?limit=${pageSize}&offset=${page * pageSize}`, as);
    if (res.status !== 200) {
      throw httpFailure(label, res.status);
    }
    const rows = res.body;
    if (!Array.isArray(rows)) {
      throw new SeedError(`${label}: resposta de paginação inválida (esperava uma lista).`);
    }
    if (rows.length > pageSize) {
      throw new SeedError(
        `${label}: paginação inconsistente (a API devolveu mais itens que o pedido).`,
      );
    }
    for (const row of rows) {
      if (row === null || typeof row !== 'object' || typeof row.id !== 'string') {
        throw new SeedError(`${label}: resposta de paginação inválida (item sem id).`);
      }
      if (seen.has(row.id)) {
        throw new SeedError(`${label}: paginação inconsistente (item repetido entre páginas).`);
      }
      seen.add(row.id);
      items.push(row);
    }
    if (rows.length < pageSize) return items; // a short (or empty) page is the last one
  }
  throw new SeedError(
    `${label}: mais de ${maxPages * pageSize} registros; o seed não conseguiu ler todos.`,
  );
}

/**
 * What the user is told about a failed HTTP call: the status and a generic hint, NEVER the body.
 * A server (or whatever answers on that port) can put anything in a body, tokens, cookies, echoed
 * headers or passwords included, so nothing from it is ever copied into a message.
 */
export function describeHttpStatus(status) {
  if (status === 400 || status === 422) return 'a API recusou os dados enviados';
  if (status === 401) return 'não autorizado: credenciais ou sessão recusadas';
  if (status === 403) return 'sem permissão para esta ação';
  if (status === 404) return 'não encontrado';
  if (status === 409) return 'conflito com dados já existentes';
  if (status === 429) return 'limite de requisições atingido';
  if (status >= 500) return 'erro interno do servidor';
  return 'resposta inesperada da API';
}

const httpFailure = (label, status) =>
  new SeedError(`${label}: HTTP ${status} (${describeHttpStatus(status)}).`);

const asList = (body) => (Array.isArray(body) ? body : (body?.items ?? body?.data ?? []));

/**
 * @param call  async (method, path, { token, companyId, body }) => ({ status, body })
 * @returns     { created: string[] } what this run had to create (empty when all was there)
 */
export async function runSeed(
  call,
  { now = new Date(), pageSize = PAGE_SIZE, maxPages = MAX_PAGES } = {},
) {
  const created = [];

  async function ok(label, promise, accepted = [200, 201]) {
    const res = await promise;
    if (!accepted.includes(res.status)) {
      throw httpFailure(label, res.status);
    }
    return res.body;
  }

  async function ensureUser({ name, email }) {
    // 201 when created, 409 when the e-mail already exists: both are fine, then we log in.
    const reg = await call('POST', '/auth/register', {
      body: { name, email, password: DEMO.password },
    });
    if (reg.status === 201) created.push(`usuário ${email}`);
    else if (reg.status !== 409) {
      throw httpFailure(`cadastro de ${email}`, reg.status);
    }
    const login = await ok(
      `login de ${email} (se a conta já existia com outra senha, recrie o banco de desenvolvimento)`,
      call('POST', '/auth/login', { body: { email, password: DEMO.password } }),
    );
    if (typeof login?.accessToken !== 'string' || login.accessToken === '') {
      throw new SeedError(`login de ${email}: a API não devolveu um token válido.`);
    }
    return login.accessToken;
  }

  const health = await call('GET', '/health');
  if (health.status !== 200) throw new SeedError(`/health respondeu HTTP ${health.status}.`);

  const ownerToken = await ensureUser(DEMO.owner);
  await ensureUser(DEMO.tech); // the account must exist before the Owner can add it to the company

  const me = await ok('perfil do Owner', call('GET', '/auth/me', { token: ownerToken }));
  let companyId = (me.memberships ?? []).find((m) => m.companyName === DEMO.company)?.companyId;
  if (!companyId) {
    const company = await ok(
      'empresa',
      call('POST', '/companies', { token: ownerToken, body: { name: DEMO.company } }),
    );
    companyId = company.id ?? company.companyId;
    created.push('empresa');
  }
  const as = { token: ownerToken, companyId };

  const members = asList(await ok('membros', call('GET', '/members', as)));
  let tech = members.find((m) => m.email?.toLowerCase() === DEMO.tech.email);
  if (!tech) {
    tech = await ok(
      'vínculo do técnico',
      call('POST', '/members', { ...as, body: { email: DEMO.tech.email, role: 'PROFESSIONAL' } }),
    );
    created.push('vínculo do técnico');
  }
  const technicianMembershipId = tech.id ?? tech.membershipId;

  let client = (await listAll(call, '/clients', as, 'clientes', { pageSize, maxPages })).find(
    (c) => c.name === DEMO.client,
  );
  if (!client) {
    client = await ok('cliente', call('POST', '/clients', { ...as, body: { name: DEMO.client } }));
    created.push('cliente');
  }
  const clientDetail = await ok('cliente', call('GET', `/clients/${client.id}`, as));
  let address = (clientDetail.addresses ?? []).find((a) => a.label === DEMO.address.label);
  if (!address) {
    address = await ok(
      'endereço',
      call('POST', `/clients/${client.id}/addresses`, { ...as, body: DEMO.address }),
    );
    created.push('endereço');
  }

  let service = asList(await ok('serviços', call('GET', '/services', as))).find(
    (s) => s.name === DEMO.service,
  );
  if (!service) {
    service = await ok(
      'serviço',
      call('POST', '/services', { ...as, body: { name: DEMO.service } }),
    );
    created.push('serviço');
  }
  const serviceDetail = await ok('serviço', call('GET', `/services/${service.id}`, as));
  if (!serviceDetail.currentChecklist) {
    await ok(
      'checklist',
      call('POST', `/services/${service.id}/checklist-versions`, {
        ...as,
        body: { items: DEMO.checklist },
      }),
    );
    created.push('checklist');
  }

  const orders = await listAll(call, '/work-orders', as, 'ordens', { pageSize, maxPages });
  for (const { title, inDays } of DEMO.orders) {
    let order = orders.find((o) => o.title === title);
    if (!order) {
      order = await ok(
        `ordem "${title}"`,
        call('POST', '/work-orders', {
          ...as,
          body: { clientId: client.id, addressId: address.id, serviceId: service.id, title },
        }),
      );
      created.push(`ordem "${title}"`);
    }
    const detail = await ok(`ordem "${title}"`, call('GET', `/work-orders/${order.id}`, as));
    const assigned = (detail.assignments ?? []).some(
      (a) => a.membershipId === technicianMembershipId && !a.releasedAt,
    );
    if (!assigned) {
      await ok(
        `atribuição de "${title}"`,
        call('POST', `/work-orders/${order.id}/assignments`, {
          ...as,
          body: { membershipId: technicianMembershipId, ...slot(inDays, now) },
        }),
      );
      created.push(`atribuição de "${title}"`);
    }
  }

  return { created };
}

/**
 * The final message. It is built only from what the seed itself knows (the demo accounts, the
 * outcome and where the database was confirmed): it never receives the API address, so no address,
 * user name or password that came from the environment can end up in the output.
 */
export function formatSummary({ created, databaseSource }) {
  const headline =
    created.length > 0
      ? `Dados de demonstração criados ou completados (${created.length} itens).`
      : 'Os dados de demonstração já existiam e estão completos; nada foi criado.';
  return `
${headline}

  API:       local (confirmada como esta máquina)
  Banco:     local, confirmado por ${databaseSource}
  Empresa:   ${DEMO.company}

  Contas (SOMENTE desenvolvimento local; a senha é pública):
    Owner:    ${DEMO.owner.email}
    Técnico:  ${DEMO.tech.email}
    Senha:    ${DEMO.password}

  No app, entre com o técnico para ver as ordens atribuídas e executá-las;
  entre com o Owner para aprovar uma execução finalizada.
`;
}
