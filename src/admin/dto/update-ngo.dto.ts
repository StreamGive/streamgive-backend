import { IsString, IsNotEmpty, Length, IsOptional, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateNgoDto {
  @IsOptional()
  @ValidateIf((o) => o.displayName !== null)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'displayName must be a string or null' })
  @IsNotEmpty({ message: 'displayName cannot be an empty string' })
  @Length(1, 200, { message: 'displayName must be between 1 and 200 characters' })
  displayName?: string | null;
}