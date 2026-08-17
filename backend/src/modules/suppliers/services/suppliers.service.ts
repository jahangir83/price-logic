import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DEFAULT_PAGE_SIZE,
  SupplierStatus,
  type PaginatedResponse,
} from '@pricelogic/shared';
import { ILike, Repository } from 'typeorm';
import { CsvImport } from '../../imports/entities/csv-import.entity';
import { Supplier } from '../entities/supplier.entity';

export interface CreateSupplierInput {
  name: string;
  code?: string | null;
}

export interface UpdateSupplierInput {
  name?: string;
  code?: string | null;
  status?: SupplierStatus;
}

/**
 * Who sent the sheet. Identity only — no costs, no integrations.
 *
 * Deletion is always soft. `csv_imports` references a supplier, and "where did
 * this price come from?" has to stay answerable long after the merchant has
 * tidied a supplier out of their list.
 */
@Injectable()
export class SuppliersService {
  private readonly logger = new Logger(SuppliersService.name);

  constructor(
    @InjectRepository(Supplier)
    private readonly suppliers: Repository<Supplier>,
    @InjectRepository(CsvImport)
    private readonly imports: Repository<CsvImport>,
  ) {}

  async create(shopId: string, input: CreateSupplierInput): Promise<Supplier> {
    const supplier = this.suppliers.create({
      shopId,
      name: input.name.trim(),
      code: input.code?.trim() || null,
      status: SupplierStatus.ACTIVE,
    });
    return this.suppliers.save(supplier);
  }

  async findOne(shopId: string, id: string): Promise<Supplier> {
    const supplier = await this.suppliers.findOne({ where: { shopId, id } });
    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }
    return supplier;
  }

  async list(
    shopId: string,
    query: {
      status?: SupplierStatus;
      search?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<PaginatedResponse<Supplier>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Record<string, unknown> = { shopId };
    if (query.status) where.status = query.status;
    if (query.search) where.name = ILike(`%${query.search}%`);

    const [items, totalItems] = await this.suppliers.findAndCount({
      where,
      order: { name: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items,
      page,
      pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
    };
  }

  async update(
    shopId: string,
    id: string,
    input: UpdateSupplierInput,
  ): Promise<Supplier> {
    const supplier = await this.findOne(shopId, id);
    if (input.name !== undefined) supplier.name = input.name.trim();
    if (input.code !== undefined) supplier.code = input.code?.trim() || null;
    if (input.status !== undefined) supplier.status = input.status;
    return this.suppliers.save(supplier);
  }

  /**
   * Soft delete only.
   *
   * A supplier with imports still in progress is refused outright — removing
   * it mid-parse would leave rows pointing at a supplier the merchant thinks
   * they deleted.
   */
  async remove(shopId: string, id: string): Promise<void> {
    const supplier = await this.findOne(shopId, id);

    const inFlight = await this.imports.count({
      where: [
        { shopId, supplierId: id, status: 'UPLOADED' as never },
        { shopId, supplierId: id, status: 'PARSING' as never },
        { shopId, supplierId: id, status: 'READY' as never },
      ],
    });
    if (inFlight > 0) {
      throw new ConflictException(
        'This supplier has sheets still being reviewed. Finish or discard them first.',
      );
    }

    await this.suppliers.softDelete({ id: supplier.id, shopId });
    this.logger.log(`Soft-deleted supplier ${id} for shop ${shopId}`);
  }
}
