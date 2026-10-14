/**
 * Minimal STORE-mode ZIP writer (no compression, no external deps).
 *
 * Produces a valid zip with local file headers, a central directory and the
 * end-of-central-directory record. CRC-32 comes from node:zlib (Node >= 20.12).
 */
import { crc32 } from "node:zlib";

function u16(value, buffer, offset) {
  buffer.writeUInt16LE(value & 0xffff, offset);
}

function u32(value, buffer, offset) {
  buffer.writeUInt32LE(value >>> 0, offset);
}

export function zipStore(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    u32(0x04034b50, local, 0); // local file header signature
    u16(20, local, 4); // version needed
    u16(0, local, 6); // flags
    u16(0, local, 8); // method: store
    u16(0, local, 10); // mod time
    u16(0, local, 12); // mod date
    u32(crc, local, 14);
    u32(data.length, local, 18);
    u32(data.length, local, 22);
    u16(nameBuf.length, local, 26);
    u16(0, local, 28); // extra length

    localParts.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    u32(0x02014b50, central, 0); // central directory signature
    u16(20, central, 4); // version made by
    u16(20, central, 6); // version needed
    u16(0, central, 8); // flags
    u16(0, central, 10); // method
    u16(0, central, 12); // mod time
    u16(0, central, 14); // mod date
    u32(crc, central, 16);
    u32(data.length, central, 20);
    u32(data.length, central, 24);
    u16(nameBuf.length, central, 28);
    u16(0, central, 30); // extra length
    u16(0, central, 32); // comment length
    u16(0, central, 34); // disk start
    u16(0, central, 36); // internal attrs
    u32(0, central, 38); // external attrs
    u32(offset, central, 42); // local header offset

    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const centralOffset = offset;

  const eocd = Buffer.alloc(22);
  u32(0x06054b50, eocd, 0); // EOCD signature
  u16(0, eocd, 4); // disk number
  u16(0, eocd, 6); // disk with central dir
  u16(entries.length, eocd, 8);
  u16(entries.length, eocd, 10);
  u32(centralSize, eocd, 12);
  u32(centralOffset, eocd, 16);
  u16(0, eocd, 20); // comment length

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}
