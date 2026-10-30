/**
 * Image preparation. Bills are dense, so besides the full page we send two
 * overlapping half-page crops at higher resolution: small print (tariff, charge
 * lines, history tables) becomes much easier for the vision model to read.
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import { config } from "./config";

export type PreparedImage = { label: string; data: Buffer; mediaType: "image/jpeg" };

const EXTS = [".png", ".jpg", ".jpeg", ".webp"];

export async function findBillImage(billsDir: string, billId: string): Promise<string> {
  for (const ext of EXTS) {
    for (const e of [ext, ext.toUpperCase()]) {
      const p = path.join(billsDir, billId + e);
      try { await fs.access(p); return p; } catch { /* try next */ }
    }
  }
  throw new Error(`No image found for bill "${billId}" in ${billsDir}`);
}

export async function listBills(billsDir: string): Promise<string[]> {
  const files = await fs.readdir(billsDir);
  return files
    .filter((f) => EXTS.includes(path.extname(f).toLowerCase()))
    .map((f) => path.basename(f, path.extname(f)))
    .sort();
}

async function encode(img: Sharp, maxEdge: number): Promise<Buffer> {
  return img
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: false })
    .normalise() // stretch contrast: helps faded photos
    .sharpen({ sigma: 0.6 })
    .jpeg({ quality: 88 })
    .toBuffer();
}

/** full page + top half + bottom half (each half overlaps the middle by 10%). */
export async function prepareImages(file: string, withCrops = true): Promise<PreparedImage[]> {
  const base = sharp(await fs.readFile(file)).rotate(); // honour EXIF orientation of phone photos
  const { data, info } = await base.toBuffer({ resolveWithObject: true });
  const out: PreparedImage[] = [
    { label: "Full bill", data: await encode(sharp(data), config.maxImageEdge), mediaType: "image/jpeg" },
  ];
  if (withCrops && info.height > 600) {
    const h = info.height, w = info.width;
    const half = Math.round(h * 0.6);
    out.push({
      label: "Zoom: top part of the bill",
      data: await encode(sharp(data).extract({ left: 0, top: 0, width: w, height: half }), config.maxImageEdge),
      mediaType: "image/jpeg",
    });
    out.push({
      label: "Zoom: bottom part of the bill",
      data: await encode(sharp(data).extract({ left: 0, top: h - half, width: w, height: half }), config.maxImageEdge),
      mediaType: "image/jpeg",
    });
  }
  return out;
}
