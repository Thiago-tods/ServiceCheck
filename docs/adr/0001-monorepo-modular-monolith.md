# ADR 0001 — Monorepo com monólito modular

- Status: aceito
- Data: 2026-11-10

## Contexto

O projeto tem um app mobile e uma API desenvolvidos por uma única pessoa, com contratos compartilhados e necessidade de histórico Git coeso.

## Decisão

Usar um monorepo (`mobile/`, `backend/`, `docs/`, `.github/`). O backend é um monólito modular NestJS, sem microserviços. O mobile segue arquitetura feature-first.

## Consequências

- Mudanças de contrato API/app em um único commit.
- CI único com jobs por pasta.
- Menor complexidade operacional; módulos podem ser extraídos no futuro se houver justificativa técnica.
