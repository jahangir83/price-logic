import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { PaginatedResponse } from '@pricelogic/shared';
import { SessionAuthGuard } from '../../../common/auth/session-auth.guard';
import { ShopGuard } from '../../../common/auth/shop.guard';
import { Shop } from '../../shops/entities/shop.entity';
import {
  CreateSupplierDto,
  ListSuppliersDto,
  UpdateSupplierDto,
} from '../dto/supplier.dto';
import { Supplier } from '../entities/supplier.entity';
import { SuppliersService } from '../services/suppliers.service';

interface RequestWithShop {
  shop: Shop;
}

@Controller('suppliers')
@UseGuards(SessionAuthGuard, ShopGuard)
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  async list(
    @Req() request: RequestWithShop,
    @Query() query: ListSuppliersDto,
  ): Promise<PaginatedResponse<Supplier>> {
    return this.suppliers.list(request.shop.id, query);
  }

  @Post()
  async create(
    @Req() request: RequestWithShop,
    @Body() dto: CreateSupplierDto,
  ): Promise<Supplier> {
    return this.suppliers.create(request.shop.id, dto);
  }

  @Get(':id')
  async findOne(
    @Req() request: RequestWithShop,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Supplier> {
    return this.suppliers.findOne(request.shop.id, id);
  }

  @Patch(':id')
  async update(
    @Req() request: RequestWithShop,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ): Promise<Supplier> {
    return this.suppliers.update(request.shop.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Req() request: RequestWithShop,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.suppliers.remove(request.shop.id, id);
  }
}
