import { zlibSync, unzlibSync } from "fflate";
/*!
fflate - MIT License
Copyright (c) 2026 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

// Protocol 15 JSON envelope, distinct from anonymous position-frame magics.
const MAGIC = 0x43475a46; // CGZF (protocol 15)
const MAX_CHARS = 128_000, MAX_BYTES = MAX_CHARS * 4;
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });

export function compressedNetworkJson(data: ArrayBuffer): boolean {
  return data.byteLength >= 4 && new DataView(data).getUint32(0, true) === MAGIC;
}

export function encodeNetworkJson(json: string): string | ArrayBuffer {
  if (json.length > MAX_CHARS) throw new Error("Network JSON exceeds the message limit");
  if (json.length < 512) return json;
  const bytes = encoder.encode(json), packed = zlibSync(bytes, { level: 1 });
  if (packed.length + 8 >= bytes.length * 0.9) return json;
  const frame = new Uint8Array(packed.length + 8), view = new DataView(frame.buffer);
  view.setUint32(0, MAGIC, true); view.setUint32(4, bytes.length, true); frame.set(packed, 8);
  return frame.buffer;
}

export function sendNetworkJson(channel: RTCDataChannel, json: string): void {
  const packet = encodeNetworkJson(json);
  if (typeof packet === "string") channel.send(packet); else channel.send(packet);
}

function adler32(bytes: Uint8Array): number {
  let a = 1, b = 0;
  for (let start = 0; start < bytes.length; start += 5552) {
    const end = Math.min(start + 5552, bytes.length);
    for (let i = start; i < end; i++) { a += bytes[i]; b += a; }
    a %= 65521; b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export function decodeNetworkJson(data: ArrayBuffer): string | null {
  if (!compressedNetworkJson(data) || data.byteLength < 14 || data.byteLength > MAX_BYTES + 8) return null;
  const view = new DataView(data), size = view.getUint32(4, true);
  if (size < 1 || size > MAX_BYTES) return null;
  try {
    // fflate's fixed output buffer cannot grow. One extra byte detects overflow
    // even when a forged header understates the expanded size.
    const bytes = unzlibSync(new Uint8Array(data, 8), { out: new Uint8Array(size + 1) });
    if (bytes.length !== size || adler32(bytes) !== view.getUint32(data.byteLength - 4)) return null;
    const json = decoder.decode(bytes);
    return json.length <= MAX_CHARS ? json : null;
  } catch { return null; }
}
