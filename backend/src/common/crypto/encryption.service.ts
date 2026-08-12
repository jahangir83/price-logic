import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;

/**
 * Encrypts/decrypts sensitive values (e.g. Shopify access tokens) at rest.
 * Never call this from a controller — only from services that own the
 * secret's lifecycle, so plaintext never leaks into request/response logs.
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  private key!: Buffer;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const encoded = this.configService.get<string>('encryptionKey');
    if (!encoded) {
      throw new Error('ENCRYPTION_KEY is not configured');
    }

    const key = Buffer.from(encoded, 'base64');
    if (key.length !== KEY_LENGTH_BYTES) {
      throw new Error(
        `ENCRYPTION_KEY must decode to ${KEY_LENGTH_BYTES} bytes (got ${key.length}) — generate one with node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }
    this.key = key;
  }

  /** Returns `iv:authTag:ciphertext`, all base64. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string): string {
    const [ivB64, authTagB64, ciphertextB64] = payload.split(':');
    if (!ivB64 || !authTagB64 || !ciphertextB64) {
      throw new Error('Malformed encrypted payload');
    }

    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
