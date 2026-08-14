import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobDependency } from './entities/job-dependency.entity';
import { JobExecution } from './entities/job-execution.entity';
import { Job } from './entities/job.entity';
import { JobDispatcherService } from './job-dispatcher.service';
import { JobHandlerRegistry } from './job-handler';
import { JobsService } from './jobs.service';

@Module({
  imports: [TypeOrmModule.forFeature([Job, JobExecution, JobDependency])],
  providers: [JobsService, JobHandlerRegistry, JobDispatcherService],
  exports: [
    TypeOrmModule,
    JobsService,
    JobHandlerRegistry,
    JobDispatcherService,
  ],
})
export class JobsModule {}
