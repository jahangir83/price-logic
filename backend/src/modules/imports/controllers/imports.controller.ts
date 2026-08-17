import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CsvRowSort,
  CsvRowStatus,
  type PaginatedResponse,
} from '@pricelogic/shared';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SessionAuthGuard } from '../../../common/auth/session-auth.guard';
import { ShopGuard } from '../../../common/auth/shop.guard';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { Shop } from '../../shops/entities/shop.entity';
import { CsvImport } from '../entities/csv-import.entity';
import { CsvRow } from '../entities/csv-row.entity';
import {
  ImportsService,
  MAX_SHEET_BYTES,
  type UploadedSheet,
} from '../services/imports.service';

interface RequestWithShop {
  shop: Shop;
}

export class UploadSheetDto {
  @IsUUID()
  supplierId!: string;
}

export class ListRowsDto {
  @IsOptional()
  @IsEnum(CsvRowStatus)
  status?: CsvRowStatus;

  @IsOptional()
  @IsEnum(CsvRowSort)
  sort?: CsvRowSort;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  problemsOnly?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(250)
  pageSize?: number;
}

export class ListImportsDto {
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(250)
  pageSize?: number;
}

export class OverrideRowDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  approvedPrice?: string;

  @IsOptional()
  @IsBoolean()
  excluded?: boolean;
}

export class ApproveImportDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;
}

@Controller('imports')
@UseGuards(SessionAuthGuard, ShopGuard)
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /**
   * Returns as soon as the file is stored. Parsing happens in a job, because a
   * 30,000-row sheet takes longer than a proxy will hold a connection open.
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_SHEET_BYTES } }),
  )
  async upload(
    @Req() request: RequestWithShop,
    @UploadedFile() file: UploadedSheet,
    @Body() dto: UploadSheetDto,
  ): Promise<CsvImport> {
    return this.imports.upload(request.shop, dto.supplierId, file);
  }

  /**
   * Declared before `:id` because order decides matching — a `@Get(':id')`
   * above this would swallow the collection route and try to parse the empty
   * string as a UUID.
   */
  @Get()
  async list(
    @Req() request: RequestWithShop,
    @Query() query: ListImportsDto,
  ): Promise<PaginatedResponse<CsvImport>> {
    return this.imports.listImports(request.shop.id, query);
  }

  @Get(':id')
  async findOne(
    @Req() request: RequestWithShop,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CsvImport> {
    return this.imports.findImport(request.shop.id, id);
  }

  @Get(':id/rows')
  async listRows(
    @Req() request: RequestWithShop,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListRowsDto,
  ): Promise<PaginatedResponse<CsvRow>> {
    return this.imports.listRows(request.shop.id, id, query);
  }

  @Patch(':id/rows/:rowId')
  async overrideRow(
    @Req() request: RequestWithShop,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('rowId', ParseUUIDPipe) rowId: string,
    @Body() dto: OverrideRowDto,
  ): Promise<CsvRow> {
    return this.imports.overrideRow(request.shop.id, id, rowId, dto);
  }

  /** Creates the campaign that owns everything downstream. Idempotent. */
  @Post(':id/approve')
  async approve(
    @Req() request: RequestWithShop,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveImportDto,
  ): Promise<Campaign> {
    return this.imports.approve(request.shop, id, dto);
  }
}
