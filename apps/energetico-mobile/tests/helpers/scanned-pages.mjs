import sharp from 'sharp';

// Real, small JPEGs. Only the device's filesystem/camera boundary is substituted.
export async function scannedPages(sessions) {
  const bytes = new Map(), released = [], read = [];
  const results = await Promise.all(sessions.map(async (pages, session) => ({
    id: `scan-session-${session + 1}`,
    items: await Promise.all(pages.map(async ([width, height, background, orientation], index) => {
      const uri = `file:///scan/${session + 1}/${index + 1}.jpg`;
      let image = sharp({ create: { width, height, channels: 3, background } });
      if (orientation) image = image.withMetadata({ orientation });
      const data = await image.jpeg().toBuffer();
      bytes.set(uri, data);
      return { id: `scan-${session + 1}-${index + 1}`, uri, name: `documento-${index + 1}.jpg`, size: data.length, type: 'image/jpeg' };
    })),
  })));
  let next = 0;
  return {
    bytes, results, released, read,
    documentScanner: { scan: async () => results[next++], release: async value => released.push(value) },
    filesystem: { readFile: async ({ path }) => { read.push(path); return { data: bytes.get(path).toString('base64') }; } },
  };
}
