import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ArrayMaxSize,
} from 'class-validator';

export class CreateNamedDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
}

export class UpdateNamedDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class SetSpecialtiesDto {
  @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) specialtyIds!: string[];
}

export class SetTeamMembersDto {
  @IsArray() @ArrayMaxSize(200) @IsUUID('4', { each: true }) membershipIds!: string[];
}
