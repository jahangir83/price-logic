import type { SupplierStatus } from '../domain/supplier.js';

export interface CreateSupplierRequest {
  name: string;
  code?: string | null;
}

export interface UpdateSupplierRequest {
  name?: string;
  code?: string | null;
  status?: SupplierStatus;
}

export interface ListSuppliersQuery {
  status?: SupplierStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}
