# ServiceCheck

> Trabalho em campo. Controle em cada etapa.

[English version](README.en.md)

ServiceCheck é um sistema mobile-first de gerenciamento de ordens de serviço para técnicos de manutenção, eletricistas, instaladores e equipes de serviços externos.

Projeto open source de portfólio. Não é comercial e não possui monetização.

## Status

Fase 0 — estrutura inicial do monorepo. Nenhuma funcionalidade implementada ainda.

## Stack

- **Mobile:** Flutter, Dart, Material 3, Riverpod, GoRouter, Drift/SQLite
- **Backend:** NestJS, TypeScript, PostgreSQL, Prisma, REST `/api/v1`
- **Infra:** GitHub Actions, armazenamento compatível com S3

## Estrutura

```
servicecheck/
  mobile/    App Flutter (offline-first)
  backend/   API NestJS (monólito modular)
  docs/      Documentação e decisões arquiteturais (docs/adr)
  .github/   Workflows de CI
```

## Licença

MIT — veja [LICENSE](LICENSE).
