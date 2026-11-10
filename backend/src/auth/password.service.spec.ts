import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await service.hash('correct horse battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    await expect(service.verify('correct horse battery', hash)).resolves.toBe(true);
    await expect(service.verify('wrong', hash)).resolves.toBe(false);
  });

  it('uses a different salt each time', async () => {
    expect(await service.hash('same')).not.toEqual(await service.hash('same'));
  });

  it('rejects malformed stored hashes', async () => {
    await expect(service.verify('x', 'garbage')).resolves.toBe(false);
  });
});
