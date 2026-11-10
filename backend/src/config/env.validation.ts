import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export enum StorageDriverName {
  Local = 'local',
  S3 = 's3',
}

// Read the raw value: implicit conversion would turn the string 'false' into true.
const toBool = Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
  const raw = obj[key];
  return typeof raw === 'string' ? raw.toLowerCase() === 'true' : raw;
});

export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @MinLength(1)
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET!: string;

  @IsInt()
  @Min(60)
  JWT_ACCESS_TTL_SECONDS: number = 900;

  @IsInt()
  @Min(1)
  REFRESH_TTL_DAYS: number = 30;

  @IsEnum(StorageDriverName)
  STORAGE_DRIVER: StorageDriverName = StorageDriverName.Local;

  @IsString()
  STORAGE_LOCAL_DIR: string = './storage';

  @ValidateIf((o: EnvironmentVariables) => o.STORAGE_DRIVER === StorageDriverName.S3)
  @IsString()
  @MinLength(1)
  S3_BUCKET?: string;

  @ValidateIf((o: EnvironmentVariables) => o.STORAGE_DRIVER === StorageDriverName.S3)
  @IsString()
  @MinLength(1)
  S3_ACCESS_KEY_ID?: string;

  @ValidateIf((o: EnvironmentVariables) => o.STORAGE_DRIVER === StorageDriverName.S3)
  @IsString()
  @MinLength(1)
  S3_SECRET_ACCESS_KEY?: string;

  @IsOptional()
  @IsString()
  S3_REGION?: string;

  /** Custom endpoint for S3-compatible services (MinIO, R2, Backblaze...). */
  @IsOptional()
  @IsString()
  S3_ENDPOINT?: string;

  @IsOptional()
  @toBool
  @IsBoolean()
  S3_FORCE_PATH_STYLE?: boolean;

  @IsOptional()
  @toBool
  @IsBoolean()
  RATE_LIMIT_ENABLED: boolean = true;

  /** Background worker polling. Tests disable it and drive the queue explicitly. */
  @IsOptional()
  @toBool
  @IsBoolean()
  JOBS_WORKER_ENABLED: boolean = true;

  @IsOptional()
  @IsString()
  SENTRY_DSN?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment: ${errors.map((e) => e.toString()).join('; ')}`);
  }
  return validated;
}
