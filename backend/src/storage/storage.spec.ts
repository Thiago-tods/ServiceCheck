import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { LocalStorage } from './local-storage';
import { S3Storage } from './s3-storage';
import { assertSafeKey } from './storage';

describe('assertSafeKey', () => {
  it.each(['a/b/c.pdf', 'attachments/1/2/abc-def', 'x'])('accepts %s', (k) => {
    expect(() => assertSafeKey(k)).not.toThrow();
  });
  it.each(['../etc/passwd', 'a/../b', '/abs', 'a//b', 'a b', '', 'a\\b'])('rejects %j', (k) => {
    expect(() => assertSafeKey(k)).toThrow();
  });
});

describe('LocalStorage', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sc-storage-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips bytes and creates nested folders', async () => {
    const s = new LocalStorage(dir);
    await s.put('a/b/file.bin', Buffer.from([1, 2, 3]));
    expect([...(await s.get('a/b/file.bin'))]).toEqual([1, 2, 3]);
  });

  it('refuses traversal keys', async () => {
    const s = new LocalStorage(dir);
    await expect(s.put('../escape', Buffer.from('x'))).rejects.toThrow(/Unsafe/);
    await expect(s.get('a/../../escape')).rejects.toThrow(/Unsafe/);
  });
});

describe('S3Storage', () => {
  const opts = { bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' };

  it('sends a PutObject with bucket, key and content type', async () => {
    const send = jest.fn().mockResolvedValue({});
    await new S3Storage(opts, { send }).put('k/1', Buffer.from('hi'), 'image/png');
    const [[cmd]] = send.mock.calls as [[{ input: Record<string, unknown> }]];
    expect(cmd.input).toMatchObject({ Bucket: 'b', Key: 'k/1', ContentType: 'image/png' });
  });

  it('reads an object body back into a Buffer', async () => {
    const send = jest.fn().mockResolvedValue({
      Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([9, 8])) },
    });
    expect([...(await new S3Storage(opts, { send }).get('k/1'))]).toEqual([9, 8]);
  });

  it('refuses unsafe keys before calling the network', async () => {
    const send = jest.fn();
    await expect(new S3Storage(opts, { send }).get('../x')).rejects.toThrow(/Unsafe/);
    expect(send).not.toHaveBeenCalled();
  });
});
