import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

/** Argon2id = 2 — see @node-rs/argon2's `Algorithm` const enum (not importable under isolatedModules). */
const ARGON2ID = 2;
import type { Env } from '../config/configuration';

/**
 * Central cryptography service.
 *  - Field/document encryption: AES-256-GCM (authenticated). Ciphertext is
 *    stored as `v1.<iv>.<tag>.<data>` (all base64) so keys can be rotated by
 *    versioning the prefix later.
 *  - Password hashing: Argon2id.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    this.key = Buffer.from(config.get('DATA_ENCRYPTION_KEY', { infer: true }) as string, 'base64');
    if (this.key.length !== 32) {
      throw new Error('DATA_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const [version, ivB64, tagB64, dataB64] = payload.split('.');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
      throw new Error('Malformed ciphertext');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Encrypt a number for storage (valuations, costs). */
  encryptNumber(value: number | null | undefined): string | null {
    return value == null ? null : this.encrypt(String(value));
  }

  decryptNumber(payload: string | null | undefined): number | null {
    if (!payload) return null;
    const v = Number(this.decrypt(payload));
    return Number.isFinite(v) ? v : null;
  }

  hashPassword(password: string): Promise<string> {
    return argonHash(password, {
      algorithm: ARGON2ID,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argonVerify(hash, password);
    } catch {
      return false;
    }
  }

  /** Constant-time comparison helper. */
  safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
