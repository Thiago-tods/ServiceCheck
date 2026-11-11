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

> The backend covers more than the app: registers, order creation and PDF reports, for example, exist only in the API. See [what the app has and what exists only in the API](#what-the-app-has-and-what-exists-only-in-the-api).

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

Full guide (Windows / PowerShell), including demo data and building the APK: [docs/development.md](docs/development.md).

```powershell
cd backend
npm install
Copy-Item .env.example .env
# edit backend/.env: DATABASE_URL and JWT_ACCESS_SECRET (see below)
npx prisma migrate deploy
npm run start:dev
```

Before starting, edit `backend/.env`: `DATABASE_URL` and a random JWT secret (the example value works for development only; with `NODE_ENV=production`, or with `NODE_ENV` unset, the API refuses to start). Details, the local database and **demo data** (`npm run seed:demo`) are in [docs/development.md](docs/development.md) (Portuguese).

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

## What the app has and what exists only in the API

The backend is more complete than the app. Today the app covers the technician's work and the simplest office decisions; everything else can only be done by calling the API.

| Feature | API | App |
|---|---|---|
| Login, logout, session renewal | yes | yes |
| Order list and detail, agenda, dashboard, notifications | yes | yes |
| Start execution, checklist, notes, photos (camera and gallery), signature, finish; all offline with sync | yes | yes |
| Approve an execution and review a signature (Owner/Admin) | yes | yes, Owner/Admin only |
| Reopen an order with a justification | yes | **no** (the app only shows the notice of an already reopened order) |
| Create, assign and cancel orders | yes | **no** |
| Registers: clients, contacts, addresses, specialties, teams, services, checklists and members | yes | **no** |
| PDF report (asynchronous generation and download) | yes | **no** (no screen to request or view reports) |
| User sign-up (`/auth/register`) | yes | **no** (no sign-up screen; use the API or `npm run seed:demo`) |
| Native push notifications | no | no |

## Project status and known limits

**Tests run and passing** (current code, in the working tree):

- Backend: 110 unit tests (Jest, including the environment validation and the JWT secret policy), 153 tests of the demo-data script (`node:test`) and 71 integration tests against real PostgreSQL (test database), including concurrency. Prettier, ESLint and the build finished without errors.
- Flutter: 51 tests and `flutter analyze` with no issues.

**Clean-copy validation.** In a copy of the `backend` folder (without `node_modules`, `dist` or `.env`), `npm ci`, Prisma client generation, Prettier, ESLint, the build and the tests above (110 unit, 153 seed and 71 integration) passed. It was a folder copy, **not a real clone** of the repository.

**Manual validation on the Android emulator** (Pixel_10, Android 37) against a local backend, through the app UI: login, logout (the session ends and the refresh-token family is revoked), automatic renewal of an expired access token, return to login when the refresh token is invalid, offline execution, sync on reconnection, handling of an operation rejected by the server, camera (online and offline), on-screen signature, finishing with validations, and approval by the Owner.

A few cases were verified by **calling the API directly, not through the UI**: approval denied to a participant of the execution and to a Professional, refresh-token reuse and expiry, and the server-side finish validation.

**Not yet validated:**

- Installation from a real clone of the repository (backend and Flutter app, following this documentation).
- Building the debug APK with the current code (not repeated at this stage; the app was not tested in a clean copy either).
- A physical device and iOS (the app has never been built for iOS).
- The S3 driver and Sentry against real services (tested with fakes only; Sentry stays off without a DSN).
- **GitHub Actions:** the workflows exist in `.github/workflows` but have not been run on GitHub yet.

**Limitations:**

- See the table above for what has no screen in the app.
- Rate limiting behind a reverse proxy requires enabling `trust proxy` (off by default, on purpose).
- **Personal data:** the system stores client data (name, address, photos, signature). There is **no** account or data deletion, retention policy, export or privacy policy yet. Do not use it with real third-party data before implementing them.
- The release APK is signed with the debug key and is not ready for distribution; the debug APK is for development only.

## License

MIT — see [LICENSE](LICENSE). IBM Plex fonts use the OFL license (`mobile/assets/fonts/OFL-IBM-Plex.txt`).