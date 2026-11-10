import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { assertSafeKey, StorageDriver } from './storage';

export interface S3Options {
  bucket: string;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Works with AWS S3 and S3-compatible services (MinIO, Cloudflare R2, Backblaze B2...). */
export class S3Storage implements StorageDriver {
  constructor(
    private readonly options: S3Options,
    private readonly client: Pick<S3Client, 'send'> = new S3Client({
      region: options.region ?? 'us-east-1',
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    }),
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
    );
    if (!res.Body) throw new Error(`Empty object: ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }
}
