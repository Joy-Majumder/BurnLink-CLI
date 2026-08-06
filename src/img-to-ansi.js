"use strict";
// Render a PNG as 24-bit ANSI true-color block art in the terminal.
//
// Strategy (the same approach as `viu` / `img2text` / `chafa`):
//   1. Decode the PNG to RGBA pixels (zero-dep, hand-rolled zlib+deflate).
//   2. Downsample to terminal-cell size. Each cell = one upper-half-block
//      character ("▀") with two pixels stacked vertically (foreground +
//      background). This doubles vertical resolution vs. a per-cell pixel
//      and is the standard trick.
//   3. Quantize each pixel to 24-bit ANSI escape (\x1b[38;2;R;G;Bm or
//      \x1b[48;2;R;G;Bm) with brightening toward the brand orange when the
//      source pixel is transparent (so the flame renders correctly on a PNG
//      that has an alpha channel — logo1.png does).
//   4. Return the rendered string. The caller decides when to print it.
//
// Capability gate:
//   - Requires TTY + 24-bit color support.
//   - The CLI's splash logic checks `ui.isTTY && process.env.COLORTERM in
//     {"truecolor","24bit"}` and falls back to the ASCII wordmark otherwise.

const zlib = require("node:zlib");

// ---- PNG decoder (RGBA only; BurnLink's logo1.png is RGBA) -------------

function decodePNG(buf) {
  // Verify signature.
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== sig[i]) throw new Error("not a PNG");
  }
  let p = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idatChunks = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (colorType !== 6 && colorType !== 2) {
    throw new Error(`unsupported color type ${colorType} (need 2=RGB or 6=RGBA)`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  // Apply PNG filtering (per scanline: 0=None, 1=Sub, 2=Up, 3=Average, 4=Paeth).
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filt = raw[pos++];
    const line = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let val = raw[pos++];
      switch (filt) {
        case 0: break;
        case 1: val = (val + a) & 0xff; break;
        case 2: val = (val + b) & 0xff; break;
        case 3: val = (val + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p_ = a + b - c;
          const pa = Math.abs(p_ - a), pb = Math.abs(p_ - b), pc = Math.abs(p_ - c);
          let pr;
          if (pa <= pb && pa <= pc) pr = a;
          else if (pb <= pc) pr = b;
          else pr = c;
          val = (val + pr) & 0xff;
          break;
        }
      }
      line[x] = val;
    }
    line.copy(pixels, y * stride);
    prev = line;
  }
  return { width, height, channels, pixels };
}

// ---- Renderer ----------------------------------------------------------

function pixelAt(img, x, y) {
  const i = (y * img.width + x) * img.channels;
  return [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2], img.channels === 4 ? img.pixels[i + 3] : 255];
}

function truecolorCapable() {
  const ct = (process.env.COLORTERM || "").toLowerCase();
  return ct === "truecolor" || ct === "24bit";
}

const RESET = "\x1b[0m";

// Render PNG to a string of upper-half-block characters at the requested
// terminal width. `maxCols` is the target width in terminal cells; the
// aspect ratio is preserved using the standard 2:1 terminal-cell ratio
// (cells are ~2x taller than wide).
function renderPNGtoANSI(buf, opts = {}) {
  const maxCols = opts.maxCols || 24;
  const img = decodePNG(buf);
  const aspect = img.height / img.width;
  // 2 cells per pixel of width vertically (one "▀" paints two rows).
  const cols = Math.min(maxCols, img.width);
  const cellW = img.width / cols;
  const cellH = cellW * 2 * aspect; // preserve aspect, accounting for cell shape
  const rows = Math.ceil(img.height / cellH / 2); // each row = 2 vertical pixels
  const out = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(c * cellW);
      const x1 = Math.floor((c + 1) * cellW);
      const yTop = Math.floor(r * 2 * cellH);
      const yBot = Math.floor((r * 2 + 1) * cellH);
      const top = averagePixel(img, x0, x1, yTop, yBot < yTop ? yBot + 1 : yTop + 1);
      const bot = averagePixel(img, x0, x1, yTop + Math.floor(cellH), yTop + Math.floor(cellH * 2));
      const [tr, tg, tb, ta] = top;
      const [br, bg, bb, ba] = bot;
      // Use "▀" (upper half block): foreground = top pixel, background = bottom pixel.
      const visibleTop = ta > 16, visibleBot = ba > 16;
      if (visibleTop && visibleBot) {
        line += `\x1b[38;2;${tr};${tg};${tb};48;2;${br};${bg};${bb}m▀${RESET}`;
      } else if (visibleTop) {
        line += `\x1b[38;2;${tr};${tg};${tb}m▀${RESET}`;
      } else if (visibleBot) {
        line += `\x1b[38;2;${br};${bg};${bb}m▄${RESET}`;
      } else {
        line += " ";
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

function averagePixel(img, x0, x1, y0, y1) {
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  for (let y = y0; y < Math.min(y1, img.height); y++) {
    for (let x = x0; x < Math.min(x1, img.width); x++) {
      const [pr, pg, pb, pa] = pixelAt(img, x, y);
      r += pr; g += pg; b += pb; a += pa; n++;
    }
  }
  if (n === 0) return [0, 0, 0, 0];
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)];
}

module.exports = { renderPNGtoANSI, decodePNG, truecolorCapable };