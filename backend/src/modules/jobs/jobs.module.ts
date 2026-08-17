import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobDependency } from './entities/job-dependency.entity';
import { JobExecution } from './entities/job-execution.entity';
import { JobStepResult } from './entities/job-step-result.entity';
import { Job } from './entities/job.entity';
import { JobDispatcherService } from './services/job-dispatcher.service';
import { JobHandlerRegistry } from './job-handler';
import { JobsService } from './services/jobs.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job, JobExecution, JobDependency, JobStepResult]),
  ],
  providers: [JobsService, JobHandlerRegistry, JobDispatcherService],
  exports: [
    TypeOrmModule,
    JobsService,
    JobHandlerRegistry,
    JobDispatcherService,
  ],
})
export class JobsModule {}
