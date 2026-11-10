import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalStorage } from './local-storage';
import { S3Storage } from './s3-storage';
import { STORAGE, StorageDriver } from './storage';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageDriver => {
        if (config.get<string>('STORAGE_DRIVER') === 's3') {
          return new S3Storage({
            bucket: config.getOrThrow<string>('S3_BUCKET'),
            region: config.get<string>('S3_REGION'),
            endpoint: config.get<string>('S3_ENDPOINT') || undefined,
            forcePathStyle: config.get<boolean>('S3_FORCE_PATH_STYLE'),
            accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY_ID'),
            secretAccessKey: config.getOrThrow<string>('S3_SECRET_ACCESS_KEY'),
          });
        }
        return new LocalStorage(config.getOrThrow<string>('STORAGE_LOCAL_DIR'));
      },
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
