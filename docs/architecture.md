# Arquitetura

ServiceCheck é um monorepo com duas aplicações:

```
servicecheck/
  backend/   API NestJS (monólito modular) + PostgreSQL (Prisma)
  mobile/    App Flutter offline-first (SQLite via Drift)
  docs/      Este diretório e os ADRs (decisões de arquitetura)
```

## Visão geral

```
 Flutter (offline-first)                                  NestJS /api/v1
┌───────────────────────────┐   POST /sync/push (outbox)  ┌────────────────────────────┐
│ UI (Riverpod, GoRouter)   │ ──────────────────────────▶ │ Guards: JWT → Tenant → Role │
│ OrderView = snapshot      │ ◀────────────────────────── │ Módulos de domínio          │
│   + operações pendentes   │   GET /sync/pull (cursor)   │ AuditLog (append-only)      │
│ Drift/SQLite              │                             │ Jobs (fila no PostgreSQL)   │
│  ├ OrderRecords (servidor)│   multipart /attachments    │ Storage (disco | S3)        │
│  └ OutboxOps (local)      │ ──────────────────────────▶ │ PostgreSQL (fonte oficial)  │
└───────────────────────────┘                             └────────────────────────────┘
```

## Backend

Monólito modular, sem microserviços. Cada pasta de `backend/src` é um módulo:

| Módulo | Responsabilidade |
|---|---|
| `auth` | Cadastro, login, JWT de acesso, refresh token rotativo com detecção de reuso |
| `tenancy` | Empresas, vínculos (Owner/Admin/Receptionist/Professional), guards de tenant e papéis |
| `clients` | Clientes, contatos e endereços |
| `people` | Especialidades e equipes |
| `catalog` | Serviços e checklists versionados e imutáveis |
| `orders` | Ordens, atribuições, agenda, execução, assinatura, aprovação, reabertura |
| `sync` | Push idempotente (outbox) e pull por cursor |
| `attachments` | Fotos/anexos validados, armazenados em disco ou S3 |
| `reports` | PDF assíncrono |
| `jobs` | Fila de tarefas no PostgreSQL (`SKIP LOCKED`), sem Redis |
| `notifications`, `dashboard`, `audit` | Notificações no app, indicadores, trilha de auditoria |

### Princípios aplicados

- **Isolamento por empresa.** `X-Company-Id` + vínculo ativo, verificados no `TenantGuard`. Toda consulta de domínio filtra por `companyId` do contexto. Recursos de outra empresa respondem 404.
- **Autorização só no backend.** O app esconde botões por conveniência; o servidor decide.
- **Integridade no banco.** Constraints que a aplicação sozinha não garantiria sob concorrência: exclusão de intervalos (disponibilidade), índices únicos parciais (um responsável principal), triggers de imutabilidade e de impedimento de exclusão.
- **Estados com compare-and-set.** Cada comando trava a ordem (`FOR UPDATE`) e valida a transição.
- **Histórico preservado.** Atribuições liberadas, execuções reabertas e auditoria nunca são apagadas.
- **Snapshots.** Ordem guarda cópia de cliente/endereço/checklist; edições posteriores não reescrevem o passado.

## Mobile

Feature-first (`lib/features/*`) com `core/` para infraestrutura. Em cada feature: apresentação (páginas e widgets), domínio (modelos e regras puras) e infraestrutura (Drift, Dio) quando aplicável.

- **Fonte de verdade local para leitura**: `OrderRecords` guarda o último JSON do servidor, nunca editado.
- **Alterações locais** ficam apenas em `OutboxOps` (operationId UUID estável).
- **`OrderView.compose`** aplica as operações pendentes sobre o snapshot e **marca** cada valor ainda não confirmado como "Pendente". Operações em conflito/rejeitadas não são aplicadas; aparecem em "Problemas de sincronização".
- **Sincronização** (`SyncEngine`): push em ordem, `APPLIED`/`DUPLICATE` mantidos visíveis até um pull bem-sucedido, recuperação após queda, anexos enviados depois das operações anteriores.

Detalhes do protocolo: [ADR 0006](adr/0006-offline-sync.md).

## Mapa das decisões

| ADR | Tema |
|---|---|
| [0001](adr/0001-monorepo-modular-monolith.md) | Monorepo e monólito modular |
| [0002](adr/0002-backend-stack-choices.md) | NestJS 11, Jest, Prisma 6 |
| [0003](adr/0003-auth-and-tenancy.md) | Autenticação, multiempresa, papéis |
| [0004](adr/0004-catalog-and-versioned-checklists.md) | Catálogo e checklists versionados |
| [0005](adr/0005-work-orders-and-execution.md) | Ordens, agenda e execução |
| [0006](adr/0006-offline-sync.md) | Sincronização offline |
| [0007](adr/0007-files-reports-and-jobs.md) | Anexos, PDF, jobs, rate limit |
| [0008](adr/0008-mobile-app.md) | App Flutter |