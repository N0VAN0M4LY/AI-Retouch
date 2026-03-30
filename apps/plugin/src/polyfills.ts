/**
 * UXP runtime polyfills — must be imported before any library that uses
 * TextEncoder / TextDecoder (e.g. fast-png → pako / fflate).
 */

if (typeof globalThis.TextEncoder === 'undefined') {
  (globalThis as any).TextEncoder = class TextEncoder {
    encoding = 'utf-8';
    encode(str: string): Uint8Array {
      const buf = new Uint8Array(str.length * 3);
      let pos = 0;
      for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c < 0x80) {
          buf[pos++] = c;
        } else if (c < 0x800) {
          buf[pos++] = 0xc0 | (c >> 6);
          buf[pos++] = 0x80 | (c & 0x3f);
        } else if (c >= 0xd800 && c <= 0xdbff) {
          const hi = c;
          const lo = str.charCodeAt(++i);
          c = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00);
          buf[pos++] = 0xf0 | (c >> 18);
          buf[pos++] = 0x80 | ((c >> 12) & 0x3f);
          buf[pos++] = 0x80 | ((c >> 6) & 0x3f);
          buf[pos++] = 0x80 | (c & 0x3f);
        } else {
          buf[pos++] = 0xe0 | (c >> 12);
          buf[pos++] = 0x80 | ((c >> 6) & 0x3f);
          buf[pos++] = 0x80 | (c & 0x3f);
        }
      }
      return buf.slice(0, pos);
    }
    encodeInto(str: string, dest: Uint8Array) {
      const encoded = this.encode(str);
      const len = Math.min(encoded.length, dest.length);
      dest.set(encoded.subarray(0, len));
      return { read: str.length, written: len };
    }
  };
}

if (typeof globalThis.TextDecoder === 'undefined') {
  (globalThis as any).TextDecoder = class TextDecoder {
    encoding = 'utf-8';
    decode(buf?: ArrayBuffer | Uint8Array): string {
      if (!buf) return '';
      const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      let str = '';
      for (let i = 0; i < bytes.length;) {
        const b = bytes[i];
        let cp: number;
        if (b < 0x80) { cp = b; i++; }
        else if ((b & 0xe0) === 0xc0) { cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f); i += 2; }
        else if ((b & 0xf0) === 0xe0) { cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f); i += 3; }
        else { cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f); i += 4; }
        if (cp < 0x10000) { str += String.fromCharCode(cp); }
        else { cp -= 0x10000; str += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)); }
      }
      return str;
    }
  };
}
