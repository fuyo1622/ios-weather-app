// A small PNG decoder for the tests (8-bit RGB, RGBA or palette, not interlaced): enough to read radar tiles
// the way the full view's canvas does, as RGBA bytes.
import zlib from "node:zlib";

export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0, palette = null, alpha = null;
  const data = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString("latin1", pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === "IHDR") [width, height, depth, type, interlace] = [body.readUInt32BE(0), body.readUInt32BE(4), body[8], body[9], body[12]];
    else if (kind === "PLTE") palette = body;
    else if (kind === "tRNS") alpha = body;
    else if (kind === "IDAT") data.push(body);
    else if (kind === "IEND") break;
    pos += 12 + len;
  }
  const channels = { 2: 3, 3: 1, 6: 4 }[type];
  if (depth !== 8 || !channels || interlace) throw new Error(`unsupported PNG (depth ${depth}, type ${type}, interlace ${interlace})`);
  const raw = zlib.inflateSync(Buffer.concat(data)), stride = width * channels, px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0, b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y ? px[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predict = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      px[y * stride + x] = (line[x] + predict) & 255;
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (type === 3) {
      const k = px[i];
      rgba.set([palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], alpha && k < alpha.length ? alpha[k] : 255], i * 4);
    } else {
      rgba.set([px[i * channels], px[i * channels + 1], px[i * channels + 2], channels === 4 ? px[i * 4 + 3] : 255], i * 4);
    }
  }
  return { width, height, rgba };
}
