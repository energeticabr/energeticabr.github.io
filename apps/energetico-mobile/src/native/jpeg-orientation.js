/** Read only the bounded TIFF/IFD0 orientation tag; never decode/recompress a scan. */
export function jpegOrientation(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) return 1;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = view.getUint16(offset), end = offset + length;
    if (length < 2 || end > bytes.length) return 1;
    if (marker === 0xe1 && length >= 16 && view.getUint32(offset + 2) === 0x45786966 && view.getUint16(offset + 6) === 0) {
      const tiff = offset + 8, endian = view.getUint16(tiff);
      const little = endian === 0x4949;
      if ((little || endian === 0x4d4d) && view.getUint16(tiff + 2, little) === 42) {
        const directory = tiff + view.getUint32(tiff + 4, little);
        if (directory >= tiff + 8 && directory + 2 <= end) {
          const count = view.getUint16(directory, little);
          for (let index = 0, entry = directory + 2; index < count && entry + 12 <= end; index++, entry += 12) {
            if (view.getUint16(entry, little) !== 0x0112 || view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) continue;
            const orientation = view.getUint16(entry + 8, little);
            if (orientation >= 1 && orientation <= 8) return orientation;
          }
        }
      }
    }
    offset = end;
  }
  return 1;
}
