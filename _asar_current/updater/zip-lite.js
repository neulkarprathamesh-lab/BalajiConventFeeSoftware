/**
 * zip-lite.js — minimal, dependency-free ZIP reader for .bcupdate (client)
 * packages.
 *
 * This app ships with ZERO npm dependencies (see package.json) and must stay
 * that way (no `npm install` step exists on a Client PC). Node has no
 * built-in ZIP reader, so this hand-parses just enough of the ZIP format to
 * extract named entries - reading the Central Directory (authoritative
 * entry list/offsets) rather than scanning Local File Headers, per the ZIP
 * spec's own guidance.
 *
 * ONLY supports STORED (uncompressed, method 0) entries. This is a
 * DELIBERATE constraint, not a shortcut: the .bcupdate builder
 * (scripts/build_client_bcupdate.py) always writes entries with
 * ZIP_STORED, so this never needs a DEFLATE decompressor. A compressed
 * entry is rejected with a clear error rather than silently mis-read.
 */
const EOCD_SIG = 0x06054b50;
const CDR_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

function findEOCD(buf) {
  // EOCD is the last record in the file; its fixed part is 22 bytes plus an
  // optional comment (max 65535 bytes) - scan backward for the signature.
  const maxBack = Math.min(buf.length, 22 + 65535);
  for (let i = buf.length - 22; i >= buf.length - maxBack && i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error('Not a valid ZIP file (End Of Central Directory not found).');
}

function readCentralDirectory(buf) {
  const eocdOffset = findEOCD(buf);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  if (cdOffset + cdSize > buf.length) {
    throw new Error('ZIP central directory is truncated/corrupted.');
  }
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(p) !== CDR_SIG) {
      throw new Error(`ZIP central directory entry ${i} has a bad signature (corrupted archive).`);
    }
    const compressionMethod = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntryData(buf, entry) {
  if (entry.compressionMethod !== 0) {
    throw new Error(`Entry '${entry.name}' uses an unsupported compression method (${entry.compressionMethod}) - only STORED entries are supported.`);
  }
  const lp = entry.localHeaderOffset;
  if (buf.readUInt32LE(lp) !== LFH_SIG) {
    throw new Error(`Local file header for '${entry.name}' has a bad signature (corrupted archive).`);
  }
  const nameLen = buf.readUInt16LE(lp + 26);
  const extraLen = buf.readUInt16LE(lp + 28);
  const dataStart = lp + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buf.length) {
    throw new Error(`Entry '${entry.name}' data extends past end of file (corrupted archive).`);
  }
  return buf.subarray(dataStart, dataEnd);
}

/**
 * Extract specific named entries from a ZIP buffer.
 * @param {Buffer} buf whole ZIP file contents
 * @param {string[]} names entry names to extract (exact match)
 * @returns {Record<string, Buffer>} map of name -> data (only for names found)
 */
function extractEntries(buf, names) {
  const entries = readCentralDirectory(buf);
  const wanted = new Set(names);
  const out = {};
  for (const entry of entries) {
    if (wanted.has(entry.name)) {
      out[entry.name] = readEntryData(buf, entry);
    }
  }
  return out;
}

function listEntryNames(buf) {
  return readCentralDirectory(buf).map((e) => e.name);
}

module.exports = { extractEntries, listEntryNames };
