# ADR 0002 — Escolhas da stack do backend

- Status: aceito
- Data: 2026-11-10

## Decisões

- **NestJS 11 com Jest.** O gerador do NestJS 12 usa Vitest e oxlint. A stack obrigatória do projeto define Jest, então foi usado o CLI 11, que gera Jest, ESLint e CommonJS. Migrar para a v12 exige reavaliar o runner de testes e deve ser uma decisão própria.
- **Prisma 6.** Mantém `url = env("DATABASE_URL")` no `schema.prisma` e `prisma-client-js`, sem configuração extra. Atualizar para uma versão maior exige estudar a mudança de configuração e de geração do client.
- **Prefixo `/api/v1`** definido em `src/app.setup.ts`, usado por `main.ts` e pelos testes e2e, para que ambos rodem com a mesma configuração.
- **Validação de ambiente** na inicialização (`src/config/env.validation.ts`): a aplicação não sobe com variáveis inválidas.
- **Health:** `/health` (liveness, sem banco) e `/health/ready` (readiness, consulta o banco).
- **Fim de linha LF** em todo o repositório (`.gitattributes` e Prettier).

## Consequências

- O `schema.prisma` ainda não tem modelos. Eles entram com suas migrações nas fases seguintes.
- Os testes e2e de health usam um Prisma simulado. A integração com PostgreSQL real é validada na CI e entra nos testes das fases com modelos.