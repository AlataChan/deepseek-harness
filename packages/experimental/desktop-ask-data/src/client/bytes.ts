/**
 * Overlay-local spreadsheet bytes encoded as canonical base64 before the Remote.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-data/client/bytes
 */

/**
 * Encode decoded file bytes as standard base64 (with padding).
 * @param bytes - decoded file bytes.
 * @returns canonical base64.
 */
export function encodeAskDataBytes(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/**
 * Read one File as Uint8Array.
 * @param file - browser file from `<input type="file">`.
 * @returns decoded bytes.
 */
export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}
