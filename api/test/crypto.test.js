import { describe, it, expect } from 'vitest';
import { generateKey, encrypt, decrypt } from '../src/crypto.js';

describe('NaCl encryption', () => {
  it('generates unique random keys', () => {
    const keys = new Set(Array.from({ length: 10 }, () => generateKey()));
    expect(keys.size).toBe(10);
  });

  it('encrypts and decrypts correctly', () => {
    const plaintext = 'DATABASE_URL=postgres://user:pass@localhost/db';
    const key = generateKey();
    const { encrypted, nonce } = encrypt(plaintext, key);
    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted, nonce, key)).toBe(plaintext);
  });

  it('fails decryption with wrong key', () => {
    const { encrypted, nonce } = encrypt('secret', generateKey());
    expect(() => decrypt(encrypted, nonce, generateKey())).toThrow('Decryption failed');
  });

  it('fails decryption with tampered ciphertext', () => {
    const key = generateKey();
    const { encrypted, nonce } = encrypt('secret', key);
    const tampered = 'A' + encrypted.slice(1);
    expect(() => decrypt(tampered, nonce, key)).toThrow();
  });

  it('handles empty string', () => {
    const key = generateKey();
    const { encrypted, nonce } = encrypt('', key);
    expect(decrypt(encrypted, nonce, key)).toBe('');
  });

  it('handles unicode content', () => {
    const plaintext = '密码=ñoño 🔐';
    const key = generateKey();
    const { encrypted, nonce } = encrypt(plaintext, key);
    expect(decrypt(encrypted, nonce, key)).toBe(plaintext);
  });

  it('handles large payloads (100KB)', () => {
    const large = 'A'.repeat(100000);
    const key = generateKey();
    const { encrypted, nonce } = encrypt(large, key);
    expect(decrypt(encrypted, nonce, key)).toBe(large);
  });
});
