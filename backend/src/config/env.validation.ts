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

/** Command shown in errors and docs: 48 random bytes, base64url (64 characters, 384 bits). */
export const JWT_SECRET_GENERATOR =
  "node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"";

/**
 * Policy for JWT_ACCESS_SECRET (enforced in every environment but an explicit NODE_ENV=development,
 * see enforceJwtSecretPolicy). It checks format, length and forbidden patterns; it
 * does not try to estimate entropy, and a long value is never accepted just for being long.
 *
 *   - hex, at least 64 characters (4 bits each = 256 bits), or
 *   - base64 / base64url, at least 43 characters (6 bits each = 258 bits), using at least three
 *     of the four character classes (lower, upper, digit, `-_+/`);
 *   - no known placeholder or common weak word, no string made of one repeated unit, no run of
 *     8 equal or consecutive characters, and enough distinct characters.
 *
 * Secrets made by the documented generator, or by `openssl rand -hex 32` and similar, pass.
 * Outer whitespace is ignored when judging the secret, but the value in use is never changed.
 */
export const MIN_HEX_CHARS = 64;
export const MIN_BASE64_CHARS = 43;

export type JwtSecretProblem =
  | 'placeholder'
  | 'weak-word'
  | 'format'
  | 'too-short'
  | 'low-diversity'
  | 'few-character-classes'
  | 'repetitive'
  | 'sequential';

const PLACEHOLDER_PATTERNS = [
  /change[-_ ]?(me|it)/i,
  /replace[-_ ]?me/i,
  /place[-_ ]?holder/i,
  /your[-_ ]?(jwt[-_ ]?)?secret/i,
  /example/i,
  /generate[-_ ]?(a[-_ ]?|with)/i,
];

// Long enough that a random 43+ character secret contains one with negligible probability.
const WEAK_WORDS = [
  'password',
  'passwd',
  'secret',
  'qwerty',
  'letmein',
  'welcome',
  'admin',
  'default',
];

const HEX = /^[0-9a-f]+$/i;
const BASE64_ISH = /^[A-Za-z0-9+/_-]+={0,2}$/;
const MIN_RUN = 8;

function characterClasses(s: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[-_+/]/].filter((re) => re.test(s)).length;
}

/** True when the whole string is one unit repeated at least twice ("abab...", "k9x2k9x2..."), the last repeat possibly partial. */
function hasShortPeriod(s: string): boolean {
  for (let p = 1; p <= Math.floor(s.length / 2); p++) {
    let periodic = true;
    for (let i = 0; i + p < s.length; i++) {
      if (s[i] !== s[i + p]) {
        periodic = false;
        break;
      }
    }
    if (periodic) return true;
  }
  return false;
}

/** A run of MIN_RUN equal characters, or of consecutive character codes going up or down. */
function hasRunOrSequence(s: string): 'repetitive' | 'sequential' | null {
  let same = 1;
  let up = 1;
  let down = 1;
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    same = d === 0 ? same + 1 : 1;
    up = d === 1 ? up + 1 : 1;
    down = d === -1 ? down + 1 : 1;
    if (same >= MIN_RUN) return 'repetitive';
    if (up >= MIN_RUN || down >= MIN_RUN) return 'sequential';
  }
  return null;
}

/**
 * Returns why a secret is not acceptable for production, or null when it is. The result is a
 * short code: the secret itself is never returned, logged or put in a message.
 */
export function checkJwtSecret(raw: string): JwtSecretProblem | null {
  const s = raw.trim();
  if (PLACEHOLDER_PATTERNS.some((p) => p.test(s))) return 'placeholder';
  const lower = s.toLowerCase();
  if (WEAK_WORDS.some((w) => lower.includes(w))) return 'weak-word';

  const hex = HEX.test(s);
  if (hex) {
    if (s.length < MIN_HEX_CHARS) return 'too-short';
  } else if (BASE64_ISH.test(s)) {
    if (s.replace(/=+$/, '').length < MIN_BASE64_CHARS) return 'too-short';
    if (characterClasses(s) < 3) return 'few-character-classes';
  } else {
    return 'format';
  }

  if (new Set(s).size < (hex ? 12 : 16)) return 'low-diversity';
  if (hasShortPeriod(s)) return 'repetitive';
  return hasRunOrSequence(s);
}

/** NODE_ENV is compared case-insensitively and without outer spaces. Empty counts as not set. */
export function canonicalNodeEnv(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase();
  return value === '' ? undefined : value;
}

/**
 * The secret policy applies everywhere except one place: an explicit NODE_ENV=development, where a
 * weak secret only produces a warning so local setups keep working (.env.example sets it). That
 * means production, test, a missing or empty NODE_ENV all enforce it, so a forgotten variable or a
 * value copied from CI can never let a placeholder through. Test code supplies valid secrets.
 */
function enforceJwtSecretPolicy(env: EnvironmentVariables, nodeEnvWasSet: boolean): void {
  const problem = checkJwtSecret(env.JWT_ACCESS_SECRET);
  if (problem === null) return;

  if (nodeEnvWasSet && env.NODE_ENV === NodeEnv.Development) {
    process.emitWarning(
      `JWT_ACCESS_SECRET does not meet the secret policy (${problem}). That is accepted for ` +
        'local development only; every other NODE_ENV rejects it.',
      'ServiceCheckEnvWarning',
    );
    return;
  }

  // Never include the value: logs and error trackers would keep it.
  throw new Error(
    `Invalid environment: JWT_ACCESS_SECRET was rejected (${problem}). ` +
      `Outside local development it must be a random secret: hex with at least ${MIN_HEX_CHARS} ` +
      `characters or base64/base64url with at least ${MIN_BASE64_CHARS} (256 bits or more). ` +
      `Generate one with: ${JWT_SECRET_GENERATOR}` +
      (nodeEnvWasSet
        ? ''
        : ' NODE_ENV is not set, so the strict policy applies: set NODE_ENV=development for local work.'),
  );
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const nodeEnv = canonicalNodeEnv(config.NODE_ENV);
  const { NODE_ENV: _ignored, ...rest } = config;
  void _ignored;
  const validated = plainToInstance(
    EnvironmentVariables,
    nodeEnv === undefined ? rest : { ...rest, NODE_ENV: nodeEnv },
    { enableImplicitConversion: true },
  );
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment: ${errors.map((e) => e.toString()).join('; ')}`);
  }
  enforceJwtSecretPolicy(validated, nodeEnv !== undefined);
  return validated;
}
