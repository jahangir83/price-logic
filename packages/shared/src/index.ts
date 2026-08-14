/**
 * `@pricelogic/shared` — the contract between the NestJS API and the admin UI.
 *
 * Three things live here and nothing else:
 *
 * 1. **Domain models and enums** — the shape of every table, without any
 *    persistence concern. Backend entities `implements` these, which makes a
 *    column added on one side and not the other a compile error.
 * 2. **API DTOs** — request and response bodies.
 * 3. **Money and pricing** — exact decimal arithmetic and the single price
 *    calculator both sides run, so a preview cannot disagree with what is
 *    written to Shopify.
 *
 * TypeORM entities deliberately stay in the backend: shipping `@Entity`
 * decorators from here would pull `typeorm` into the browser bundle.
 */
export * from './domain/index.js';
export * from './dto/index.js';
export * from './money/index.js';
export * from './pricing/index.js';
export * from './serialization.js';
