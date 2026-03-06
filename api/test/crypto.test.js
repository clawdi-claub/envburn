import { describe, it, expect } from 'vitest';
import { generateKey, encrypt, decrypt } from '../src/crypto.js';

describe('NaCl encryption', () => {
  it('should generate a random key', () => {
    const key1 = generateKey();
    const key2 = generateKey();
    expect(key1).not.toBe(key2);
    expect(key1.length).toBeGreaterThan(0);
  });

  it('should encrypt and decrypt correctly', () => {
    const plaintext = 'DATABASE_URL=postgres://user:pass@localhost/db';
    const key = generateKey();
    
    const { encrypted, nonce } = encrypt(plaintext, key);
    expect(encrypted).not.toBe(plaintext);
    
    const decrypted = decrypt(encrypted, nonce, key);
    expect(decrypted).toBe(plaintext);
  });

  it('should fail decryption with wrong key', () => {
    const plaintext = 'SECRET_KEY=abc123';
    const key1 = generateKey();
    const key2 = generateKey();
    
    const { encrypted, nonce } = encrypt(plaintext, key1);
    
    expect(() => {
      decrypt(encrypted, nonce, key2);
    }).toThrow('Decryption failed');
  });

  it('should handle large payloads', () => {
    const largeContent = 'A' * 50000;
    const key = generateKey();
    const { encrypted, nonce } = encrypt(largeContent, key);
    const decrypted = decrypt(encrypted, nonce, key);
    expect(decrypted).toBe(largeContent);
  });
});
