# API REST `/api/v1`

Autenticação: `Authorization: Bearer <accessToken>`. Rotas por empresa exigem também `X-Company-Id: <uuid>`.
Erros seguem o formato padrão do NestJS (`statusCode`, `message`, `error`). Listagens aceitam `limit` (1–200), `offset` e `q`.

Papéis: **O**wner, **A**dmin, **R**eceptionist, **P**rofessional.

## Autenticação (público, limitado a 10 req/min por IP)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/auth/register` | Cria usuário |
| POST | `/auth/login` | Devolve `accessToken` e `refreshToken` |
| POST | `/auth/refresh` | Rotaciona o refresh token (reuso revoga a família) |
| POST | `/auth/logout` | Revoga a família do refresh token |
| GET | `/auth/me` | Usuário e vínculos (inclui `membershipId`) |

## Empresas e membros

| Método | Rota | Papéis |
|---|---|---|
| POST/GET | `/companies` | qualquer usuário |
| GET | `/members` | O A R |
| POST | `/members` | O A (Admin só gerencia R e P) |
| PATCH | `/members/:id` | O A (desativa; nunca remove; mantém ≥ 1 Owner) |
| PUT | `/members/:id/specialties` | O A |

## Cadastros

| Método | Rota | Papéis |
|---|---|---|
| POST/GET/PATCH | `/clients`, `/clients/:id` | O A R |
| POST/PATCH | `/clients/:id/contacts`, `/clients/:id/addresses` | O A R |
| GET / POST,PATCH | `/specialties` | todos / O A |
| GET / POST,PATCH | `/teams`, `PUT /teams/:id/members` | todos / O A |
| GET / POST,PATCH | `/services` | todos / O A |
| GET / POST | `/services/:id/checklist-versions` | todos / O A (versão nova, imutável) |

## Ordens de serviço

| Método | Rota | Papéis |
|---|---|---|
| POST | `/work-orders` | O A R |
| GET | `/work-orders`, `/work-orders/:id` | todos (P vê só as suas) |
| GET | `/work-orders/:id/history` | O A R |
| POST | `/work-orders/:id/cancel` | O A R |
| POST | `/work-orders/:id/assignments` | O A R (409 em conflito de agenda) |
| POST | `/work-orders/:id/assignments/:aid/release` | O A R |
| GET | `/agenda?from&to&membershipId` | todos (P vê só a sua) |
| POST | `/work-orders/:id/start` | técnico atribuído |
| POST | `/work-orders/:id/signature-review` | O A ou `canReviewSignatures` |
| POST | `/work-orders/:id/approve` | O A, que não participou da execução |
| POST | `/work-orders/:id/reopen` | O A (justificativa ≥ 10 caracteres) |

## Execução (somente participantes ativos)

| Método | Rota |
|---|---|
| PATCH | `/executions/:id/items/:itemId` |
| POST | `/executions/:id/notes` |
| PUT | `/executions/:id/primary` |
| PUT | `/executions/:id/signature` |
| POST | `/executions/:id/finish` (só o responsável principal) |
| POST | `/executions/:id/attachments` (multipart `file`, `id?`, `checklistItemId?` ou `checklistItemPosition?`) |
| GET | `/attachments/:id` |

## Sincronização

| Método | Rota | Descrição |
|---|---|---|
| POST | `/sync/push` | Até 100 operações `{operationId, type, payload}`; resultado por operação |
| GET | `/sync/pull?since&limit` | Ordens visíveis alteradas desde o cursor |
| GET | `/sync/conflicts` | Operações em conflito/rejeitadas do usuário |

Tipos de operação: `EXECUTION_START`, `ITEM_UPDATE`, `NOTE_ADD`, `SIGNATURE_SET`, `EXECUTION_FINISH`.
Resultados: `APPLIED`, `DUPLICATE`, `CONFLICT`, `REJECTED`, `ERROR` (retentável).

## Outros

| Método | Rota |
|---|---|
| POST | `/work-orders/:id/reports` (202; PDF assíncrono) |
| GET | `/reports/:id`, `/reports/:id/download` |
| GET | `/dashboard` |
| GET/POST | `/notifications`, `/notifications/:id/read`, `/notifications/read-all` |
| GET | `/health`, `/health/ready` |