import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CsvImport } from './entities/csv-import.entity';
import { CsvRow } from './entities/csv-row.entity';

/**
 * Supplier sheet staging. Approving an import creates a campaign, which then
 * owns the outcome — nothing downstream references these tables.
 */
@Module({
  imports: [TypeOrmModule.forFeature([CsvImport, CsvRow])],
  exports: [TypeOrmModule],
})
export class ImportsModule {}
