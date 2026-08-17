import type { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';
import type { ShopifyAdminService } from '../../shopify/services/shopify-admin.service';
import type { JobsService } from '../../jobs/services/jobs.service';
import type { Campaign } from '../../campaigns/entities/campaign.entity';
import type { CsvImport } from '../entities/csv-import.entity';
import type { CsvRow } from '../entities/csv-row.entity';
import { ImportsService } from './imports.service';

/**
 * Records what the query builder was asked for, so the tests can assert on the
 * SQL shape rather than on a database round trip. The tenant clause is the
 * whole point of most of these — it is the one condition that, if dropped,
 * fails silently in development where there is only ever one shop.
 */
function queryBuilder(items: CsvImport[], total: number) {
  const calls = {
    where: [] as [string, Record<string, unknown>][],
    andWhere: [] as [string, Record<string, unknown>][],
    orderBy: [] as [string, string][],
    skip: 0,
    take: 0,
  };

  const builder = {
    where: (clause: string, params: Record<string, unknown>) => {
      calls.where.push([clause, params]);
      return builder;
    },
    andWhere: (clause: string, params: Record<string, unknown>) => {
      calls.andWhere.push([clause, params]);
      return builder;
    },
    orderBy: (field: string, direction: string) => {
      calls.orderBy.push([field, direction]);
      return builder;
    },
    skip: (value: number) => {
      calls.skip = value;
      return builder;
    },
    take: (value: number) => {
      calls.take = value;
      return builder;
    },
    getManyAndCount: () =>
      Promise.resolve([items, total] as [CsvImport[], number]),
  };

  return { builder, calls };
}

describe('ImportsService.listImports', () => {
  function build(items: CsvImport[] = [], total = 0) {
    const { builder, calls } = queryBuilder(items, total);
    const imports = {
      createQueryBuilder: jest.fn(() => builder),
    } as unknown as Repository<CsvImport>;

    const service = new ImportsService(
      imports,
      {} as Repository<CsvRow>,
      {} as Repository<Campaign>,
      {} as ShopifyAdminService,
      {} as JobsService,
      {} as DataSource,
      { get: () => undefined } as unknown as ConfigService,
    );

    return { service, calls };
  }

  it('scopes every query to the calling shop', async () => {
    const { service, calls } = build();

    await service.listImports('shop-1');

    expect(calls.where).toEqual([
      ['import.shop_id = :shopId', { shopId: 'shop-1' }],
    ]);
  });

  it('returns the newest sheet first', async () => {
    // The merchant is nearly always looking for the one they just uploaded.
    const { service, calls } = build();

    await service.listImports('shop-1');

    expect(calls.orderBy).toEqual([['import.created_at', 'DESC']]);
  });

  it('filters by supplier without dropping the tenant clause', async () => {
    const { service, calls } = build();

    await service.listImports('shop-1', { supplierId: 'supplier-9' });

    expect(calls.where).toHaveLength(1);
    expect(calls.andWhere).toEqual([
      ['import.supplier_id = :supplierId', { supplierId: 'supplier-9' }],
    ]);
  });

  it('does not filter by supplier when none was asked for', async () => {
    const { service, calls } = build();

    await service.listImports('shop-1');

    expect(calls.andWhere).toEqual([]);
  });

  it('pages from one, not from zero', async () => {
    const { service, calls } = build();

    await service.listImports('shop-1', { page: 3, pageSize: 10 });

    expect(calls.skip).toBe(20);
    expect(calls.take).toBe(10);
  });

  it('reports at least one page when there is nothing to show', async () => {
    // "Page 1 of 0" is a bug the merchant can see.
    const { service } = build([], 0);

    const result = await service.listImports('shop-1');

    expect(result.totalPages).toBe(1);
    expect(result.items).toEqual([]);
  });

  it('rounds a partial last page up', async () => {
    const { service } = build([], 21);

    const result = await service.listImports('shop-1', { pageSize: 10 });

    expect(result.totalPages).toBe(3);
  });
});
