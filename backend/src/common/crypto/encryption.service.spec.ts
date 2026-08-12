import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { EncryptionService } from './encryption.service';

function makeService(encryptionKey?: string): EncryptionService {
  const configService = {
    get: () => encryptionKey,
  } as unknown as ConfigService;
  return new EncryptionService(configService);
}

describe('EncryptionService', () => {
  it('round-trips a plaintext value', () => {
    const key = randomBytes(32).toString('base64');
    const service = makeService(key);
    service.onModuleInit();

    const ciphertext = service.encrypt('shpat_super_secret_token');
    expect(ciphertext).not.toContain('shpat_super_secret_token');
    expect(service.decrypt(ciphertext)).toBe('shpat_super_secret_token');
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const key = randomBytes(32).toString('base64');
    const service = makeService(key);
    service.onModuleInit();

    const first = service.encrypt('same-value');
    const second = service.encrypt('same-value');
    expect(first).not.toBe(second);
  });

  it('throws on init if ENCRYPTION_KEY is missing', () => {
    const service = makeService(undefined);
    expect(() => service.onModuleInit()).toThrow(
      'ENCRYPTION_KEY is not configured',
    );
  });

  it('throws on init if ENCRYPTION_KEY does not decode to 32 bytes', () => {
    const service = makeService(Buffer.from('too-short').toString('base64'));
    expect(() => service.onModuleInit()).toThrow(/32 bytes/);
  });

  it('throws on decrypt if the payload was tampered with', () => {
    const key = randomBytes(32).toString('base64');
    const service = makeService(key);
    service.onModuleInit();

    const ciphertext = service.encrypt('value');
    const [iv, authTag, body] = ciphertext.split(':');
    const tampered = [iv, authTag, body.slice(0, -2) + 'zz'].join(':');

    expect(() => service.decrypt(tampered)).toThrow();
  });
});
