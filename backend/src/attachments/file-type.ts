const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) =>
    b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  'application/pdf': (b) => b.subarray(0, 5).toString('ascii') === '%PDF-',
};

export const ALLOWED_TYPES = Object.keys(SIGNATURES);

/** The declared content type must match the real file bytes (not just the extension or header). */
export function matchesDeclaredType(contentType: string, bytes: Buffer): boolean {
  return SIGNATURES[contentType]?.(bytes) ?? false;
}

/** Keeps only a safe base name: no paths, control characters or quotes. */
export function sanitizeFilename(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'file';
  const clean = base
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .trim()
    .slice(0, 120);
  return clean.length > 0 && clean !== '.' && clean !== '..' ? clean : 'file';
}
