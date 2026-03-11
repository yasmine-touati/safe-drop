export async function encryptFile(file) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buffer = await file.arrayBuffer();
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buffer);
  const exportedKey = await crypto.subtle.exportKey('raw', key);
  return {
    blob: new Blob([encrypted]),
    iv: btoa(String.fromCharCode(...iv)),
    keyBase64: btoa(String.fromCharCode(...new Uint8Array(exportedKey))),
  };
}

export async function decryptFile(encryptedBuffer, keyBase64, ivBase64) {
  const keyBytes = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encryptedBuffer);
}