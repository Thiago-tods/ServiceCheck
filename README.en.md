# ServiceCheck

> Field work. Control at every step.

[Versão em português](README.md)

A **mobile-first** work-order system for maintenance technicians, electricians, installers and field service teams. The app is **offline-first**: technicians run the job without signal and changes sync on their own once the connection returns.

Open source portfolio project. Not commercial; no monetization.

## What it does

- Multi-tenant with strict isolation; one user can belong to several companies (Owner, Admin, Receptionist, Professional).
- Clients, contacts, addresses, specialties, teams and services with **versioned, immutable checklists**.
- Work orders with assignment, **assignment history**, agenda and **availability-conflict blocking enforced in the database**.
- Execution with several technicians and one lead, checklist, notes, photos and an **on-screen signature**.
- Missing or refused signatures go to **review**; **approval is independent** from the people who executed; reopening needs a justification and creates a new execution.
- **Offline outbox** with stable `operationId`s: idempotent operations, preserved conflicts, sync state always visible.
- Asynchronous **PDF** report, dashboard, in-app notifications, immutable audit trail.
- UI in **Portuguese and English**, light/dark theme, IBM Plex Sans/Mono.

## Stack

| Layer | Technologies |
|---|---|
| Mobile | Flutter, Dart, Material 3, Riverpod, GoRouter, Drift/SQLite |
| Backend | NestJS, TypeScript, PostgreSQL, Prisma, REST `/api/v1`, JWT with rotating refresh tokens |
| Infra | GitHub Actions, S3-compatible storage, PostgreSQL-backed job queue (no Redis), optional Sentry |
| Tests | Jest (unit and integration against **real PostgreSQL**), Flutter Test |

## How offline works (summary)

1. Every technician action becomes an operation with a UUID in the local database (`OutboxOps`).
2. The screen shows the last server snapshot **plus** pending operations, tagged "Pending".
3. The sync engine sends them in order (`/sync/push`); retries are safe. Then it fetches changes (`/sync/pull`).
4. An operation stops being "pending" only when the server confirms it. Conflicts and rejections are kept and visible.

Details: [docs/adr/0006-offline-sync.md](docs/adr/0006-offline-sync.md) (Portuguese).

## Getting started

Full guide (Windows / PowerShell): [docs/development.md](docs/development.md).

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

## Structure

```
servicecheck/
  backend/   NestJS API (modular monolith)
  mobile/    Flutter app (feature-first)
  docs/      Architecture, API, development and ADRs
  .github/   Backend and app CI
```

## Documentation

- [Architecture](docs/architecture.md) · [API](docs/api.md) · [Development](docs/development.md)
- Architecture decisions: [docs/adr](docs/adr)

Documentation is written in Portuguese.

## Project status and known limits

Verified by automated tests: backend (unit and integration against real PostgreSQL, including concurrency), app (sync logic, HTTP client, main screens) and debug APK compilation.

**Not** yet verified or out of scope:

- Running on a device/emulator, and iOS (no iOS build on this machine).
- S3 driver and Sentry against real services (tested with fakes / disabled without a DSN).
- Native push, creating and assigning orders from the app (done through the API), signature review by non-admin members in the app.
- Rate limiting behind a reverse proxy requires enabling `trust proxy` (off by default, on purpose).

## License

MIT — see [LICENSE](LICENSE). IBM Plex fonts use the OFL license (`mobile/assets/fonts/OFL-IBM-Plex.txt`).