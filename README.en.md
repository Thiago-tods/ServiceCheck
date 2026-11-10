# ServiceCheck

> Field work. Control at every step.

[Versão em português](README.md)

ServiceCheck is a mobile-first work order management system for maintenance technicians, electricians, installers and field service teams.

Open source portfolio project. Not commercial; no monetization.

## Status

Phase 1 — backend skeleton (NestJS, Prisma, health check). No business features yet.

### Backend

```powershell
cd backend
npm install
Copy-Item .env.example .env   # adjust DATABASE_URL
npx prisma generate
npm run start:dev
```

Health: `GET /api/v1/health` and `GET /api/v1/health/ready`.

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
