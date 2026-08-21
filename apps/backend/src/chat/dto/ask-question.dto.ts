import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CATEGORIES } from '../../pdf/constants/categories';

export class AskQuestionDto {
  @IsUUID()
  conversationId: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  documentIds?: string[];

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: string;

  @IsString()
  @IsNotEmpty({ message: 'question must not be empty' })
  @MaxLength(2000, { message: 'question must be 2000 characters or fewer' })
  question: string;
}
