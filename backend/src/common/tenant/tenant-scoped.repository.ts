import {
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
  DeepPartial,
} from 'typeorm';

/**
 * Tenant isolation pattern (security #4-5): wrap any repository for a
 * shop-owned table in TenantScopedRepository and use ONLY these methods,
 * never the raw repository. Every read/write is forced to carry
 * `shopId = <the caller's authenticated shop>`, so a query can never return
 * or mutate another shop's rows — including by accident (e.g. a forgotten
 * `WHERE id = ?` with no shop filter).
 *
 * Usage:
 *   const scoped = new TenantScopedRepository(this.repo, currentShop.id);
 *   await scoped.findOneOrFail({ id: campaignId });
 */
export class TenantScopedRepository<
  T extends ObjectLiteral & { shopId: string },
> {
  constructor(
    private readonly repository: Repository<T>,
    private readonly shopId: string,
  ) {}

  private scoped(where: FindOptionsWhere<T> = {}) {
    return { ...where, shopId: this.shopId } as FindOptionsWhere<T>;
  }

  find(where?: FindOptionsWhere<T>): Promise<T[]> {
    return this.repository.find({ where: this.scoped(where) });
  }

  findOne(where: FindOptionsWhere<T>): Promise<T | null> {
    return this.repository.findOne({ where: this.scoped(where) });
  }

  async findOneOrFail(where: FindOptionsWhere<T>): Promise<T> {
    const entity = await this.findOne(where);
    if (!entity) {
      throw new Error('Entity not found for this shop');
    }
    return entity;
  }

  create(entityLike: DeepPartial<T>): T {
    return this.repository.create({
      ...entityLike,
      shopId: this.shopId,
    } as DeepPartial<T>);
  }

  save(entity: DeepPartial<T>): Promise<T> {
    return this.repository.save({ ...entity, shopId: this.shopId } as T);
  }

  async delete(where: FindOptionsWhere<T>): Promise<void> {
    await this.repository.delete(this.scoped(where));
  }
}
