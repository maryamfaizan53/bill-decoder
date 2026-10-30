import fs from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";

export type Row = Record<string, string>;

export async function readCsv(file: string): Promise<{ rows: Row[]; fields: string[] }> {
  const text = (await fs.readFile(file, "utf8")).replace(/^﻿/, "");
  const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(`${file}: ${parsed.errors[0].message}`);
  return { rows: parsed.data, fields: parsed.meta.fields ?? [] };
}

/** UTF-8, original column order; cells with commas/quotes/newlines are quoted and inner quotes doubled (RFC 4180). */
export async function writeCsv(file: string, fields: string[], rows: Row[]) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const text = Papa.unparse({ fields, data: rows.map((r) => fields.map((f) => r[f] ?? "")) }, { newline: "\n" });
  await fs.writeFile(file, text + "\n", "utf8");
}
