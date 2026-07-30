type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'utf-32le' | 'utf-32be';

function detectEncoding(bytes: Uint8Array): { encoding: Encoding; offset: number } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', offset: 3 };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0x00 && bytes[3] === 0x00) {
    return { encoding: 'utf-32le', offset: 4 };
  }
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xfe && bytes[3] === 0xff) {
    return { encoding: 'utf-32be', offset: 4 };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf-16le', offset: 2 };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'utf-16be', offset: 2 };
  }

  // Some Windows-generated JSON files omit the UTF-16 BOM. JSON punctuation
  // is ASCII, so alternating NUL bytes provide a safe encoding signal.
  if (bytes.length >= 4 && bytes[0] !== 0 && bytes[1] === 0 && bytes[3] === 0) {
    return { encoding: 'utf-16le', offset: 0 };
  }
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] !== 0 && bytes[2] === 0) {
    return { encoding: 'utf-16be', offset: 0 };
  }

  return { encoding: 'utf-8', offset: 0 };
}

function decodeUtf32(bytes: Uint8Array, littleEndian: boolean): string {
  let text = '';
  // Ignore an incomplete trailing code unit. Editors occasionally append a
  // lone NUL byte after otherwise valid JSON.
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    const codePoint = littleEndian
      ? (bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24)) >>> 0
      : (bytes[i + 3]! | (bytes[i + 2]! << 8) | (bytes[i + 1]! << 16) | (bytes[i]! << 24)) >>> 0;
    text += codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '\ufffd';
  }
  return text;
}

function decode(bytes: Uint8Array, encoding: Encoding): string {
  if (encoding === 'utf-32le' || encoding === 'utf-32be') {
    return decodeUtf32(bytes, encoding === 'utf-32le');
  }
  // Non-fatal decoding is intentional: the JSON parser remains the validity
  // gate, while harmless incomplete trailing bytes no longer abort decoding.
  return new TextDecoder(encoding).decode(bytes);
}

function stripLeadingEncodingNoise(text: string): string {
  const jsonStart = text.search(/[\[{]/u);
  if (jsonStart <= 0) return text.replace(/^[\ufeff\u0000\ufffd\s]+/u, '');

  // Only skip characters that can result from a damaged/transcoded BOM.
  // Arbitrary text before JSON remains an error instead of being hidden.
  const prefix = text.slice(0, jsonStart);
  return /^[\ufeff\u0000\ufffd\s]+$/u.test(prefix) ? text.slice(jsonStart) : text;
}

/** Parse webhook import JSON saved as UTF-8 or Windows UTF-16. */
export function parseWebhookImportJson(buffer: ArrayBuffer): unknown {
  const bytes = new Uint8Array(buffer);
  const { encoding, offset } = detectEncoding(bytes);
  const text = stripLeadingEncodingNoise(decode(bytes.subarray(offset), encoding))
    .replace(/[\u0000\ufffd\s]+$/u, '');
  return JSON.parse(text);
}
