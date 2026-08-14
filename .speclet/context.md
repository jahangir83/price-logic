
# Project Context

> Keep this file minimal. It is injected into every speclet prompt.

## Stack
- Language: TypeScript
- Framework: NestJS (backend API), React + Vite (frontend admin UI, embedded via Shopify App Bridge + Polaris)
- Database: PostgreSQL, accessed via TypeORM
- Deployment: Docker container on a VPS/cloud VM

## Conventions
- Backend and frontend live in separate apps/packages (NestJS API, Vite/React admin UI) — not a full-stack framework like Remix.
- `packages/shared` (`@pricelogic/shared`) holds the contract between them: domain models, enums, API DTOs, and the money/pricing math. A local `file:` dependency, not published to npm. Domain shape goes there **first**; entities `implements` it so drift is a compile error. TypeORM entities stay in the backend — their decorators would pull `typeorm` into the browser bundle.
- Money/price values use exact decimal types end-to-end (DB, TypeORM entities, API payloads) — never floats. Arithmetic goes through the shared money module (`bigint` minor units), never native operators.
- The price calculator (`calculatePrice`) is shared, so the merchant's preview and the server's execution cannot disagree. The server still recalculates and never trusts a client-supplied price.
- Every merchant-owned entity carries a tenant boundary (shop/store ID) enforced at the query layer.

## Constraints
- Not modeled after any specific sibling project — stack choices here are independent (NestJS/TypeORM/Vite), even though a similar-domain reference app (FlashX) was reviewed earlier for context only.
