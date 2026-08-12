import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Import } from './entities/import.entity';
import { ImportRecord } from './entities/import-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Import, ImportRecord])],
  exports: [TypeOrmModule],
})
export class ImportsModule {}
