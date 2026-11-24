// World News in One Day: 24 November 2026
// Original newspaper front page renderer. Node 22, stdlib only, no network.
// Own rasterizer, 5x7 bitmap font and PNG encoder, written from scratch.
// Output: /output/entry.png, 1024x1024, deterministic, <= 1 MiB.
import * as fs from "node:fs";
import * as zlib from "node:zlib";
import * as path from "node:path";

const W = 1024;
const H = 1024;

// ---- palette ----
const PAPER: [number, number, number] = [246, 242, 231];
const INK: [number, number, number] = [18, 18, 18];
const WHITE: [number, number, number] = [255, 255, 255];
const RED: [number, number, number] = [158, 24, 24];
const NAVY: [number, number, number] = [22, 42, 78];
const SKY: [number, number, number] = [148, 178, 205];
const GOLD: [number, number, number] = [176, 132, 32];
const GREY: [number, number, number] = [96, 96, 90];
const LIGHT: [number, number, number] = [232, 226, 210];

// ---- canvas ----
const px = new Uint8Array(W * H * 3);
function fill(c: [number, number, number]): void {
  for (let i = 0; i < W * H; i++) {
    px[i * 3] = c[0];
    px[i * 3 + 1] = c[1];
    px[i * 3 + 2] = c[2];
  }
}
function setPixel(x: number, y: number, c: [number, number, number]): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}
function rect(x: number, y: number, w: number, h: number, c: [number, number, number]): void {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) setPixel(xx, yy, c);
}
function hline(x: number, y: number, w: number, c: [number, number, number], t = 1): void {
  rect(x, y, w, t, c);
}
function vline(x: number, y: number, h: number, c: [number, number, number], t = 1): void {
  rect(x, y, t, h, c);
}
function circle(cx: number, cy: number, r: number, c: [number, number, number]): void {
  for (let yy = cy - r; yy <= cy + r; yy++)
    for (let xx = cx - r; xx <= cx + r; xx++) {
      const dx = xx - cx;
      const dy = yy - cy;
      if (dx * dx + dy * dy <= r * r) setPixel(xx, yy, c);
    }
}
function ring(cx: number, cy: number, r: number, c: [number, number, number], t = 2): void {
  for (let yy = cy - r - t; yy <= cy + r + t; yy++)
    for (let xx = cx - r - t; xx <= cx + r + t; xx++) {
      const d = Math.sqrt((xx - cx) * (xx - cx) + (yy - cy) * (yy - cy));
      if (d >= r - t / 2 && d <= r + t / 2) setPixel(xx, yy, c);
    }
}
// filled triangle (scanline)
function tri(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c: [number, number, number]): void {
  const minY = Math.min(y1, y2, y3);
  const maxY = Math.max(y1, y2, y3);
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    const edges: Array<[number, number, number, number]> = [
      [x1, y1, x2, y2],
      [x2, y2, x3, y3],
      [x3, y3, x1, y1],
    ];
    for (const [ax, ay, bx, by] of edges) {
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
    }
    if (xs.length >= 2) {
      const a = Math.min(...xs);
      const b = Math.max(...xs);
      for (let x = Math.ceil(a); x <= Math.floor(b); x++) setPixel(x, y, c);
    }
  }
}

// ---- 5x7 bitmap font ('#' = on, '.' = off) ----
const GLYPHS: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#..##", "#.#.#", "##..#", "#...#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".##..", ".##..", ".#..."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  ";": [".....", ".##..", ".##..", ".....", ".##..", ".##..", ".#..."],
  "'": ["..#..", "..#..", ".#...", ".....", ".....", ".....", "....."],
  "-": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
  ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "&": [".###.", "#...#", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
  "%": ["##..#", "##.#.", "...#.", "..#..", ".#...", "#.##.", "#..##"],
  $: ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
  '"': [".#.#.", ".#.#.", ".#.#.", ".....", ".....", ".....", "....."],
  "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "*": [".....", ".#.#.", "..#..", "#####", "..#..", ".#.#.", "....."],
};
const CHAR_W = 6; // 5 px glyph + 1 px gap
function textWidth(s: string, scale: number): number {
  return s.length * CHAR_W * scale - scale;
}
function drawText(x: number, y: number, s: string, scale: number, c: [number, number, number]): void {
  let cx = x;
  for (const ch of s) {
    const g = GLYPHS[ch] ?? GLYPHS["?"];
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (g[r][col] === "#") {
          rect(cx + col * scale, y + r * scale, scale, scale, c);
        }
      }
    }
    cx += CHAR_W * scale;
  }
}
function drawTextCentered(y: number, s: string, scale: number, c: [number, number, number], x0 = 0, x1 = W): void {
  const w = textWidth(s, scale);
  drawText(x0 + Math.floor((x1 - x0 - w) / 2), y, s, scale, c);
}
// Greedy word wrap; returns lines that fit maxW at scale.
function wrap(s: string, maxW: number, scale: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const trial = cur ? cur + " " + word : word;
    if (textWidth(trial, scale) <= maxW) {
      cur = trial;
    } else {
      if (cur) lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
function textBlock(x: number, y: number, s: string, maxW: number, scale: number, c: [number, number, number], lh?: number): number {
  const lines = wrap(s, maxW, scale);
  const lineH = lh ?? 7 * scale + 4;
  for (let i = 0; i < lines.length; i++) {
    drawText(x, y + i * lineH, lines[i], scale, c);
  }
  return y + lines.length * lineH;
}

// ---- CRC32 + PNG encoder ----
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter none
    raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- page layout ----
fill(PAPER);
const M = 32; // margin
const CW = W - 2 * M; // 960 content width

// outer double border
rect(14, 14, W - 28, H - 28, INK);
rect(18, 18, W - 36, H - 36, PAPER);
hline(18, 20, W - 36, INK, 1);

// masthead
drawTextCentered(44, "THE WORLD IN ONE DAY", 5, INK);
hline(M, 116, CW, INK, 3);
// date band
rect(M, 128, CW, 46, INK);
drawTextCentered(140, "TUESDAY 24 NOVEMBER 2026", 3, WHITE);
hline(M, 182, CW, INK, 2);
drawTextCentered(196, "MORNING EDITION - ROUND 1", 2, GREY);

// ---- lead story ----
const leadY = 232;
drawText(M, leadY, "LEAD STORY", 2, RED);
hline(M, leadY + 22, CW, RED, 2);
const leadHead = "RUSSIAN JETS TRIGGER SHELTER ALERT IN SOUTH KOREA";
let y = leadY + 38;
y = textBlock(M, y, leadHead, CW, 3, INK, 7 * 3 + 6);
y += 10;
const leadBody =
  "SEVERAL RUSSIAN MILITARY AIRCRAFT ENTERED SOUTH KOREA'S AIR DEFENCE ZONE OVER THE EAST SEA EARLY ON TUESDAY AND APPROACHED ULLEUNGDO ISLAND. THE INTERIOR MINISTRY SENT AN EMERGENCY TEXT AT 07:52 TELLING RESIDENTS OF ULLEUNG COUNTY TO TAKE SHELTER UNDERGROUND OR IN BUILDINGS. FIGHTER JETS WERE SCRAMBLED AND THE ALERT WAS LIFTED AT 07:55, ONCE THE AIRCRAFT HAD LEFT. IT WAS THE FOURTH RUSSIAN ENTRY INTO THE ZONE THIS YEAR.";
// lead text left column, graphic right
const leadTextW = 560;
const leadEnd = textBlock(M, y, leadBody, leadTextW, 2, INK, 7 * 2 + 5);
// graphic: radar map panel
const gx = M + leadTextW + 24;
const gy = y - 6;
const gw = CW - leadTextW - 24;
const gh = 190;
rect(gx, gy, gw, gh, NAVY);
rect(gx + 4, gy + 4, gw - 8, gh - 8, SKY);
ring(gx + 150, gy + 95, 62, NAVY, 2);
ring(gx + 150, gy + 95, 38, NAVY, 2);
circle(gx + 150, gy + 95, 4, RED);
// coastline blob (stylised peninsula, kept small on the right edge)
tri(gx + 268, gy + 44, gx + 322, gy + 66, gx + 292, gy + 140, INK);
tri(gx + 292, gy + 140, gx + 322, gy + 66, gx + 336, gy + 158, INK);
// jets: small triangles heading in
tri(gx + 60, gy + 40, gx + 96, gy + 52, gx + 60, gy + 64, RED);
tri(gx + 40, gy + 110, gx + 76, gy + 122, gx + 40, gy + 134, RED);
tri(gx + 90, gy + 140, gx + 126, gy + 152, gx + 90, gy + 164, RED);
drawText(gx + 12, gy + 8, "KADIZ - EAST SEA", 1, NAVY);
drawText(gx + 12, gy + gh - 20, "ULLEUNGDO - 07:52 ALERT", 1, NAVY);
const leadBottom = Math.max(leadEnd, gy + gh) + 8;
hline(M, leadBottom, CW, INK, 3);

// ---- three panels ----
const panelY = leadBottom + 18;
const gap = 20;
const pw = Math.floor((CW - 2 * gap) / 3);
const px0 = M;
const px1 = M + pw + gap;
const px2 = M + 2 * (pw + gap);

function panel(x: number, kicker: string, head: string, body: string, art: (ay: number) => void): void {
  let py = panelY;
  drawText(x, py, kicker, 2, RED);
  hline(x, py + 22, pw, RED, 2);
  py += 36;
  py = textBlock(x, py, head, pw, 2, INK, 7 * 2 + 5);
  py += 8;
  py = textBlock(x, py, body, pw, 2, INK, 7 * 2 + 5);
  // Art sits below the text, never overlapping it.
  const artY = Math.max(panelY + 268, py + 12);
  art(artY);
}

panel(
  px0,
  "WAR IN UKRAINE",
  "WAR REACHES DEEP INSIDE RUSSIA",
  "UKRAINIAN COMBAT DRONES STRUCK THE KALEYKINO OIL FACILITY IN TATARSTAN, MORE THAN 1,200 KM FROM UKRAINIAN TERRITORY. A RUSSIAN STRIKE HIT A VEHICLE EVACUATING CIVILIANS IN KRAMATORSK, KILLING TWO PEOPLE.",
  (ay) => {
    const ax = px0;
    rect(ax, ay, pw, 92, INK);
    // flame
    tri(ax + 40, ay + 78, ax + 70, ay + 18, ax + 100, ay + 78, GOLD);
    tri(ax + 55, ay + 78, ax + 70, ay + 42, ax + 85, ay + 78, RED);
    drawText(ax + 118, ay + 30, "KALEYKINO", 2, WHITE);
    drawText(ax + 118, ay + 54, "1,200 KM", 2, WHITE);
  }
);
panel(
  px1,
  "SYRIA",
  "LANDMINE KILLS FIVE CHILDREN",
  "A LANDMINE BLAST IN NORTHWEST SYRIA KILLED FIVE CHILDREN, REPORTED EARLY ON TUESDAY.",
  (ay) => {
    const ax = px1;
    rect(ax, ay, pw, 92, PAPER);
    rect(ax, ay, pw, 92, INK); // border only via inner fill below
    rect(ax + 2, ay + 2, pw - 4, 88, PAPER);
    tri(ax + pw / 2 - 42, ay + 76, ax + pw / 2, ay + 12, ax + pw / 2 + 42, ay + 76, GOLD);
    drawText(ax + pw / 2 - 6, ay + 34, "!", 3, INK);
    drawTextCentered(ay + 80, "NORTHWEST SYRIA", 1, INK, ax, ax + pw);
  }
);
panel(
  px2,
  "CHESS",
  "WORLD TITLE MATCH BEGINS IN GENEVA",
  "GAME 1 OF THE FIDE WORLD CHESS CHAMPIONSHIP STARTS TODAY AT 15:00 CET IN GENEVA. CHAMPION D. GUKESH OF INDIA FACES CHALLENGER JAVOKHIR SINDAROV OF UZBEKISTAN, BOTH 20 - THE YOUNGEST WORLD TITLE MATCH EVER. FOURTEEN GAMES, $2.5 MILLION PRIZE FUND.",
  (ay) => {
    const ax = px2;
    const bs = 80 / 8;
    const bx = ax + Math.floor((pw - 80) / 2);
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        rect(bx + Math.floor(c * bs), ay + Math.floor(r * bs), Math.ceil(bs), Math.ceil(bs), (r + c) % 2 ? INK : WHITE);
    circle(bx + Math.floor(4 * bs + bs / 2), ay + Math.floor(7 * bs + bs / 2), 5, RED);
    circle(bx + Math.floor(3 * bs + bs / 2), ay + Math.floor(0 * bs + bs / 2), 5, RED);
  }
);

// vertical rules between panels
vline(px1 - gap / 2, panelY, 360, GREY, 1);
vline(px2 - gap / 2, panelY, 360, GREY, 1);

// footer
const fy = panelY + 380;
hline(M, fy, CW, INK, 2);
drawTextCentered(fy + 12, "COMPILED FROM REPORTS PUBLISHED ON 24 NOVEMBER 2026", 2, GREY);
drawTextCentered(fy + 38, "THE WORLD IN ONE DAY - TUESDAY 24 NOVEMBER 2026", 2, INK);

// ---- write ----
const outDir = process.env.OUTPUT_DIR ?? "/output";
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "entry.png");
fs.writeFileSync(out, encodePNG());
console.log("wrote", out);
