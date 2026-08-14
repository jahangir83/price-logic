import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobDependency } from './entities/job-dependency.entity';
import { JobExecution } from './entities/job-execution.entity';
import { Job } from './entities/job.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Job, JobExecution, JobDependency])],
  exports: [TypeOrmModule],
})
export class JobsModule {}
