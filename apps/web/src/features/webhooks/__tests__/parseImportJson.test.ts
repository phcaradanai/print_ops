import { describe, expect, it } from 'vitest';
import { parseWebhookImportJson } from '../parseImportJson';

const json = '{"version":1,"endpoints":[{"endpointCode":"lab","name":"Lab"}]}';

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('parseWebhookImportJson', () => {
  it('parses UTF-8 JSON with or without a BOM', () => {
    const utf8 = new TextEncoder().encode(json);
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]);

    expect(parseWebhookImportJson(asBuffer(utf8))).toMatchObject({ version: 1 });
    expect(parseWebhookImportJson(asBuffer(withBom))).toMatchObject({ version: 1 });
  });

  it('ignores replacement characters left by a previously corrupted BOM', () => {
    const damagedBom = new TextEncoder().encode(`\ufffd\ufffd \u0000${json}`);

    expect(parseWebhookImportJson(asBuffer(damagedBom))).toEqual(JSON.parse(json));
  });

  it('does not hide arbitrary non-encoding text before JSON', () => {
    const invalid = new TextEncoder().encode(`not-json ${json}`);

    expect(() => parseWebhookImportJson(asBuffer(invalid))).toThrow();
  });

  it('parses Windows UTF-16LE JSON with a BOM', () => {
    const body = new Uint8Array(json.length * 2);
    for (let i = 0; i < json.length; i++) {
      const code = json.charCodeAt(i);
      body[i * 2] = code & 0xff;
      body[i * 2 + 1] = code >> 8;
    }
    const bytes = new Uint8Array([0xff, 0xfe, ...body]);

    expect(parseWebhookImportJson(asBuffer(bytes))).toEqual(JSON.parse(json));
  });

  it('tolerates an incomplete trailing byte in a UTF-16LE file', () => {
    const body = new Uint8Array(json.length * 2);
    for (let i = 0; i < json.length; i++) {
      const code = json.charCodeAt(i);
      body[i * 2] = code & 0xff;
      body[i * 2 + 1] = code >> 8;
    }
    const bytes = new Uint8Array([0xff, 0xfe, ...body, 0x00]);

    expect(parseWebhookImportJson(asBuffer(bytes))).toEqual(JSON.parse(json));
  });

  it('parses UTF-16BE JSON with a BOM', () => {
    const body = new Uint8Array(json.length * 2);
    for (let i = 0; i < json.length; i++) {
      const code = json.charCodeAt(i);
      body[i * 2] = code >> 8;
      body[i * 2 + 1] = code & 0xff;
    }
    const bytes = new Uint8Array([0xfe, 0xff, ...body]);

    expect(parseWebhookImportJson(asBuffer(bytes))).toEqual(JSON.parse(json));
  });

  it('parses UTF-32LE JSON with a BOM', () => {
    const body = new Uint8Array(json.length * 4);
    for (let i = 0; i < json.length; i++) {
      const code = json.charCodeAt(i);
      body[i * 4] = code & 0xff;
      body[i * 4 + 1] = (code >> 8) & 0xff;
    }
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x00, ...body]);

    expect(parseWebhookImportJson(asBuffer(bytes))).toEqual(JSON.parse(json));
  });
});
