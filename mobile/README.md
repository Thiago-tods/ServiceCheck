# ServiceCheck Mobile

Flutter app for field technicians of **ServiceCheck**, a mobile-first, offline-first work-order system. It talks to the NestJS API in [`../backend`](../backend).

**Stack:** Flutter, Dart, Material 3, Riverpod, GoRouter and Drift/SQLite.

## What the app does today

- Sign in, sign out and automatic session renewal.
- Work-order list and detail, agenda, dashboard and in-app notifications.
- Execution of an order: checklist, notes, photos (camera and gallery) and an on-screen signature.
- Offline-first: actions are stored locally as operations and synchronized in order when the connection returns, with pending, rejected and conflicting operations kept visible.
- Approval of finished executions and signature review for Owner/Admin users.
- Portuguese and English, light and dark themes.

Creating orders, registers (clients, services, members), reopening an order and PDF reports are available only through the API, not in the app.

## Documentation

Architecture, setup, running the app, demo data and known limits are in the [main README](../README.md) ([English](../README.en.md)) and in [`../docs`](../docs).
