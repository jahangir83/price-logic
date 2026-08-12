import 'reflect-metadata';
import { DataSource } from 'typeorm';

if (process.env.NODE_ENV !== 'production') {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file present (e.g. CI) — rely on real environment variables.
  }
}

/**
 * TypeORM CLI entry point (migration:generate / migration:run / etc).
 * The running Nest app configures TypeORM separately in AppModule via
 * TypeOrmModule.forRootAsync — this file exists only for the CLI, which
 * needs a plain DataSource outside of Nest's DI container.
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [`${__dirname}/../modules/**/entities/*.entity{.ts,.js}`],
  migrations: [`${__dirname}/migrations/*{.ts,.js}`],
  synchronize: false,
});
