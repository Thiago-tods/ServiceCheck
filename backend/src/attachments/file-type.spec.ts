import { matchesDeclaredType, sanitizeFilename } from './file-type';

describe('matchesDeclaredType', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  it('accepts matching bytes and rejects mismatches', () => {
    expect(matchesDeclaredType('image/png', png)).toBe(true);
    expect(matchesDeclaredType('image/jpeg', png)).toBe(false);
    expect(matchesDeclaredType('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(matchesDeclaredType('application/pdf', Buffer.from('%PDF-1.7'))).toBe(true);
    expect(matchesDeclaredType('text/html', Buffer.from('<script>'))).toBe(false);
  });
});

describe('sanitizeFilename', () => {
  it.each([
    ['../../etc/passwd', 'passwd'],
    ['C:\\temp\\foto.jpg', 'foto.jpg'],
    ['a"b;c.png', 'a_b_c.png'],
    ['..', 'file'],
    ['', 'file'],
    ['fotografia ção.png', 'fotografia ção.png'],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });
});
