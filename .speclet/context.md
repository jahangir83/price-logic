
# Project Context

> Keep this file minimal. It is injected into every speclet prompt.

## Stack
- Language: TypeScript
- Framework: NestJS (backend API), React + Vite (frontend admin UI, embedded via Shopify App Bridge + Polaris)
- Database: PostgreSQL, accessed via TypeORM
- Deployment: Docker container on a VPS/cloud VM

## Conventions
- Backend and frontend live in separate apps/packages (NestJS API, Vite/React admin UI) — not a full-stack framework like Remix.
- Money/price values use exact decimal types end-to-end (DB, TypeORM entities, API payloads) — never floats.
- Every merchant-owned entity carries a tenant boundary (shop/store ID) enforced at the query layer.

## Constraints
- Not modeled after any specific sibling project — stack choices here are independent (NestJS/TypeORM/Vite), even though a similar-domain reference app (FlashX) was reviewed earlier for context only.
