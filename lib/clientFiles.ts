/**
 * Bill images the user uploaded in this tab, kept in memory by id.
 * On serverless hosts each request can land on a different instance, so the
 * bill page re-sends the file with the decode request when it still has it.
 */
const files = new Map<string, File>();

export function rememberFile(id: string, file: File) {
  files.set(id, file);
}

export function recallFile(id: string): File | undefined {
  return files.get(id);
}
