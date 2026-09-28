import { Module } from '@nestjs/common';
import { ExerciseLibraryController } from './exercise-library.controller';
import { ExerciseLibraryService } from './exercise-library.service';
import { CloudinaryService } from '../common/cloudinary.service';

@Module({
  controllers: [ExerciseLibraryController],
  providers: [ExerciseLibraryService, CloudinaryService],
})
export class ExerciseLibraryModule {}
