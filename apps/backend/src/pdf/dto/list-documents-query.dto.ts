import { IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import type { DocumentStatus } from '../interfaces/document-metadata.interface';
import { CATEGORIES } from '../constants/categories';

const STATUSES: DocumentStatus[] = ['queued', 'processing', 'processed', 'failed'];

export class ListDocumentsQueryDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: DocumentStatus;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  ids?: string[];
}
