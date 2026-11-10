# ServiceCheck

> Field work. Control at every step.

[Versão em português](README.md)

ServiceCheck is a mobile-first work order management system for maintenance technicians, electricians, installers and field service teams.

Open source portfolio project. Not commercial; no monetization.

## Status

Phase 0 — initial monorepo structure. No features implemented yet.

## Stack

- **Mobile:** Flutter, Dart, Material 3, Riverpod, GoRouter, Drift/SQLite
- **Backend:** NestJS, TypeScript, PostgreSQL, Prisma, REST `/api/v1`
- **Infra:** GitHub Actions, S3-compatible storage

## Structure

```
servicecheck/
  mobile/    Flutter app (offline-first)
  backend/   NestJS API (modular monolith)
  docs/      Documentation and architecture decisions (docs/adr)
  .github/   CI workflows
```

## License

MIT — see [LICENSE](LICENSE).
