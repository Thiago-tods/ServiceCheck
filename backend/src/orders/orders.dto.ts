import { Transform, Type } from 'class-transformer';
import { ReviewDecision, SignatureStatus, WorkOrderStatus } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQuery } from '../common/pagination';

export class CreateOrderDto {
  @IsUUID() clientId!: string;
  @IsUUID() addressId!: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsUUID() serviceId!: string;
  @IsString() @MinLength(3) @MaxLength(160) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
}

export class OrderListQuery extends PageQuery {
  @IsOptional() @IsEnum(WorkOrderStatus) status?: WorkOrderStatus;
  @IsOptional() @IsUUID() clientId?: string;
}

export class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}

export class ReopenDto {
  @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
}

export class NoteDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class AssignDto {
  @IsUUID() membershipId!: string;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class SignatureReviewDto {
  @IsEnum(ReviewDecision) decision!: ReviewDecision;
  @IsString() @MinLength(3) @MaxLength(1000) note!: string;
}

export class AgendaQuery {
  @IsDateString() from!: string;
  @IsDateString() to!: string;
  @IsOptional() @IsUUID() membershipId?: string;
}

export class UpdateItemDto {
  @IsOptional() @IsBoolean() done?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) value?: string;
}

export class AddNoteDto {
  @IsString() @MinLength(1) @MaxLength(2000) text!: string;
}

export class SetPrimaryDto {
  @IsUUID() membershipId!: string;
}

export class CaptureSignatureDto {
  @IsEnum(SignatureStatus) status!: SignatureStatus;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) signerName?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) reason?: string;
  /** Base64 PNG captured on screen (no data: prefix). */
  @IsOptional() @IsString() @MaxLength(400_000) imagePngBase64?: string;
}

export class HistoryQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 200;
}

export const trimmed = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);
