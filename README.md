# ServiceCheck

> Trabalho em campo. Controle em cada etapa.

[English version](README.en.md)

Sistema **mobile-first** de ordens de serviço para técnicos de manutenção, eletricistas, instaladores e equipes externas. O aplicativo funciona **offline-first**: o técnico executa a ordem sem sinal e as alterações sincronizam sozinhas quando a conexão volta.

Projeto open source de portfólio. Não é comercial e não possui monetização.

## O que ele faz

- Multiempresa com isolamento rigoroso; um usuário pode pertencer a várias empresas (Owner, Admin, Receptionist, Professional).
- Clientes, contatos, endereços, especialidades, equipes e serviços com **checklists versionados e imutáveis**.
- Ordens com atribuição, **histórico de atribuições**, agenda e **bloqueio de conflito de disponibilidade** garantido no banco.
- Execução com vários técnicos e um responsável principal, checklist, observações, fotos e **assinatura na tela**.
- Assinatura ausente ou recusada vai para **revisão**; a **aprovação é independente** de quem executou; reabertura exige justificativa e cria nova execução.
- **Outbox offline** com `operationId` estável: operações idempotentes, conflitos preservados, estados de sincronização sempre visíveis.
- Relatório **PDF** assíncrono, dashboard, notificações no app, auditoria imutável.
- Interface em **português e inglês**, tema claro/escuro, IBM Plex Sans/Mono.

## Stack

| Camada | Tecnologias |
|---|---|
| Mobile | Flutter, Dart, Material 3, Riverpod, GoRouter, Drift/SQLite |
| Backend | NestJS, TypeScript, PostgreSQL, Prisma, REST `/api/v1`, JWT com refresh rotativo |
| Infra | GitHub Actions, armazenamento compatível com S3, fila de jobs no PostgreSQL (sem Redis), Sentry opcional |
| Testes | Jest (unitário e integração com **PostgreSQL real**), Flutter Test |

## Como o offline funciona (resumo)

1. Toda ação do técnico vira uma operação com UUID no banco local (`OutboxOps`).
2. A tela mostra o último snapshot do servidor **mais** as operações pendentes, marcadas como "Pendente".
3. O motor de sincronização envia em ordem (`/sync/push`); reenvios são seguros. Depois busca mudanças (`/sync/pull`).
4. Uma operação só deixa de ser "pendente" quando o servidor confirma. Conflitos e rejeições ficam guardados e visíveis.

Detalhes em [docs/adr/0006-offline-sync.md](docs/adr/0006-offline-sync.md).

## Começando

Guia completo (Windows / PowerShell): [docs/development.md](docs/development.md).

```powershell
cd backend
npm install
Copy-Item .env.example .env
npx prisma migrate deploy
npm run start:dev
```

```powershell
cd mobile
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

## Estrutura

```
servicecheck/
  backend/   API NestJS (monólito modular)
  mobile/    App Flutter (feature-first)
  docs/      Arquitetura, API, desenvolvimento e ADRs
  .github/   CI do backend e do app
```

## Documentação

- [Arquitetura](docs/architecture.md) · [API](docs/api.md) · [Desenvolvimento](docs/development.md)
- Decisões de arquitetura: [docs/adr](docs/adr)

## Estado do projeto e limites conhecidos

Validado por testes automatizados: backend (unitários e integração contra PostgreSQL real, incluindo concorrência), app (lógica de sincronização, cliente HTTP, telas principais) e compilação do APK debug.

Ainda **não** validado ou fora do escopo:

- Execução em aparelho/emulador e iOS (sem build iOS nesta máquina).
- Driver S3 e Sentry contra serviços reais (testados apenas com simulações / desligados sem DSN).
- Push nativo, criação e atribuição de ordens pelo app (feitas via API), revisão de assinatura por membro não-Admin no app.
- Rate limiting atrás de proxy reverso exige habilitar `trust proxy` (desligado por padrão, de propósito).

## Licença

MIT — veja [LICENSE](LICENSE). As fontes IBM Plex seguem a licença OFL (`mobile/assets/fonts/OFL-IBM-Plex.txt`).