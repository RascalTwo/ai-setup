// lib/write.ts — writeFile that creates the parent directories first.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function write(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}
