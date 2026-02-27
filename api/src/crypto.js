import nacl from 'tweetnacl';
import tnaclUtil from 'tweetnacl-util';
const { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } = tnaclUtil;

export function generateKey() {
  const key = nacl.randomBytes(nacl.secretbox.keyLength);
  return encodeBase64(key);
}

export function encrypt(plaintext, keyBase64) {
  const key = decodeBase64(keyBase64);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const messageUint8 = decodeUTF8(plaintext);
  const encrypted = nacl.secretbox(messageUint8, nonce, key);
  return { encrypted: encodeBase64(encrypted), nonce: encodeBase64(nonce) };
}

export function decrypt(encryptedBase64, nonceBase64, keyBase64) {
  const key = decodeBase64(keyBase64);
  const nonce = decodeBase64(nonceBase64);
  const encrypted = decodeBase64(encryptedBase64);
  const decrypted = nacl.secretbox.open(encrypted, nonce, key);
  if (!decrypted) throw new Error('Decryption failed');
  return encodeUTF8(decrypted);
}
