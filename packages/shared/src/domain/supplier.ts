import type { Serialized } from '../serialization.js';

export enum SupplierStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

/**
 * Who sent the sheet. Identity only — no costs, no integrations.
 *
 * Soft-deleted rather than removed, because `csv_imports` references it and
 * import history must stay readable.
 */
export interface Supplier {
  id: string;
  shopId: string;
  name: string;
  /** Merchant shorthand. Not unique — two suppliers may share a code. */
  code: string | null;
  status: SupplierStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type SupplierDto = Serialized<Supplier>;
