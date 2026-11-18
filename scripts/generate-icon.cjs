const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

// Render the vector source at its native resolution; no image dependencies needed.
const size = 1024;
const green = '#245C44';
const orange = '#CF7947';
const assets = path.resolve(__dirname, '../assets');

function compass(monochrome = false) {
  return `<g fill="none" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round">
    <circle cx="512" cy="512" r="238"/>
    <path d="M512 274v28M750 512h-28M512 750v-28M274 512h28"/>
  </g>
  <g transform="rotate(36 512 512)">
    <path d="M512 334 572 512 512 490 452 512Z" fill="${monochrome ? '#FFFFFF' : orange}"/>
    <path d="M512 690 452 512 512 534 572 512Z" fill="#FFFFFF"/>
  </g>`;
}

function svg({ background = false, monochrome = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${background ? `<rect width="1024" height="1024" fill="${green}"/><g transform="translate(512 512) scale(1.28) translate(-512 -512)">` : ''}
  ${compass(monochrome)}
  ${background ? '</g>' : ''}
</svg>`;
}

async function main() {
  await fs.mkdir(assets, { recursive: true });
  const appIcon = svg({ background: true });
  await fs.writeFile(path.join(assets, 'roam-icon.svg'), `${appIcon}\n`);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const variants = [
      ['roam-icon.png', appIcon],
      ['roam-adaptive-foreground.png', svg()],
      ['roam-monochrome.png', svg({ monochrome: true })],
    ];
    for (const [filename, source] of variants) {
      await page.setContent(`<html><body style="margin:0;width:1024px;height:1024px;background:transparent">${source}</body></html>`);
      const target = path.join(assets, filename);
      await page.screenshot({ path: target, omitBackground: true });
      const png = await fs.readFile(target);
      if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) {
        throw new Error(`Invalid PNG output: ${filename}`);
      }
      console.log(`${filename}: ${size} x ${size}, ${png.length} bytes`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
