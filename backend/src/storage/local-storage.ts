import { promises as fs } from 'fs';
import * as path from 'path';
import { assertSafeKey, StorageDriver } from './storage';

export class LocalStorage implements StorageDriver {
  private readonly root: string;

  constructor(dir: string) {
    this.root = path.resolve(dir);
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Key escapes the storage root');
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const file = this.resolve(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }
}
