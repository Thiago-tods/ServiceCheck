import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export enum SyncOperationType {
  EXECUTION_START = 'EXECUTION_START',
  ITEM_UPDATE = 'ITEM_UPDATE',
  NOTE_ADD = 'NOTE_ADD',
  SIGNATURE_SET = 'SIGNATURE_SET',
  EXECUTION_FINISH = 'EXECUTION_FINISH',
}

export class SyncOperationDto {
  /** Stable UUID generated once on the device; the idempotency key. */
  @IsUUID('4') operationId!: string;
  @IsEnum(SyncOperationType) type!: SyncOperationType;
  @IsObject() payload!: Record<string, unknown>;
  /** When the user performed it on the device (informational; the server orders by array position). */
  @IsOptional() @IsDateString() clientTimestamp?: string;
}

export class SyncPushDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SyncOperationDto)
  operations!: SyncOperationDto[];
}

export class SyncPullQuery {
  @IsOptional() @IsDateString() since?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 100;
}
