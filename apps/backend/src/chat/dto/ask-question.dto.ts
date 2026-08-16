import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class AskQuestionDto {
  @IsUUID()
  documentId: string;

  @IsString()
  @IsNotEmpty({ message: 'question must not be empty' })
  @MaxLength(2000, { message: 'question must be 2000 characters or fewer' })
  question: string;
}
