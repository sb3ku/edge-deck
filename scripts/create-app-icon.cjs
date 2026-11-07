// Rebuild the desktop icon from the dashboard's existing vector mark.
// Uses installed Microsoft Edge; no downloads, fonts, or extra image libraries.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const sizes = [16, 24, 32, 48, 64, 128, 256];
const directory = path.join(__dirname, '..', 'src', 'assets', 'app');
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function findEdge() {
  const candidates = [
    process.env.EDGE_EXECUTABLE_PATH,
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
  for (const file of candidates) {
    try { await fs.access(file); return file; } catch { /* Check the next installed location. */ }
  }
  throw new Error('Microsoft Edge was not found. Set EDGE_EXECUTABLE_PATH to an installed browser executable.');
}

function verifyPng(data, size) {
  assert.ok(data.subarray(0, 8).equals(pngSignature), 'Frame is a PNG');
  assert.equal(data.toString('ascii', 12, 16), 'IHDR');
  assert.equal(data.readUInt32BE(16), size, 'PNG width');
  assert.equal(data.readUInt32BE(20), size, 'PNG height');
  assert.equal(data[24], 8, 'PNG channel depth');
  assert.equal(data[25], 6, 'PNG has RGBA channels');
}

function buildIco(frames) {
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2); // ICONDIR type: icon.
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, data }, index) => {
    verifyPng(data, size);
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...frames.map(frame => frame.data)]);
}

function verifyIco(data) {
  assert.equal(data.readUInt16LE(0), 0, 'ICONDIR reserved field');
  assert.equal(data.readUInt16LE(2), 1, 'ICONDIR icon type');
  assert.equal(data.readUInt16LE(4), sizes.length, 'All requested sizes exist');
  let offset = 6 + sizes.length * 16;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    assert.equal(data[entry] || 256, size);
    assert.equal(data[entry + 1] || 256, size);
    assert.equal(data[entry + 2], 0);
    assert.equal(data[entry + 3], 0);
    assert.equal(data.readUInt16LE(entry + 4), 1);
    assert.equal(data.readUInt16LE(entry + 6), 32);
    const length = data.readUInt32LE(entry + 8);
    assert.equal(data.readUInt32LE(entry + 12), offset, 'Frame offsets are contiguous');
    verifyPng(data.subarray(offset, offset + length), size);
    offset += length;
  });
  assert.equal(offset, data.length, 'No truncated or extra frame data');
}

async function main() {
  const svg = await fs.readFile(path.join(directory, 'edge-deck.svg'), 'utf8');
  const browser = await chromium.launch({ executablePath: await findEdge(), headless: true, chromiumSandbox: true });
  const frames = [];
  try {
    const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
    for (const size of sizes) {
      const encoded = await page.evaluate(async ({ source, size }) => {
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      }, { source: svg, size });
      const data = Buffer.from(encoded, 'base64');
      verifyPng(data, size);
      frames.push({ size, data });
    }
  } finally {
    await browser.close();
  }
  const ico = buildIco(frames);
  verifyIco(ico);
  await fs.writeFile(path.join(directory, 'edge-deck.ico'), ico);
  await fs.writeFile(path.join(directory, 'edge-deck-256.png'), frames.at(-1).data);
  verifyIco(await fs.readFile(path.join(directory, 'edge-deck.ico')));
  console.log(JSON.stringify({ icon: path.join(directory, 'edge-deck.ico'), sizes, bytes: ico.length }));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
