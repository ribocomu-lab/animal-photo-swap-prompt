import fs from "node:fs/promises";
import path from "node:path";
import type { AllowedImageMimeType } from "./image-validation";

export interface EncodedImageAsset {
  name: string;
  data: string;
  mimeType: AllowedImageMimeType;
}

export const REFERENCE_FILENAMES = ["duck.jpeg", "hippo.jpeg", "pig.jpeg"] as const;
export const MOCK_RESULT_FILENAME = "pig.jpeg";

function getPocDir(rootDir: string = process.cwd()): string {
  return path.join(rootDir, "poc");
}

/**
 * Reads the 3 reference images in the exact fixed order: duck.jpeg, hippo.jpeg, pig.jpeg.
 * Never copied to public/ or exposed to client bundles.
 */
export async function loadReferenceImages(
  rootDir: string = process.cwd()
): Promise<EncodedImageAsset[]> {
  const referencesDir = path.join(getPocDir(rootDir), "references");
  const results: EncodedImageAsset[] = [];

  for (const filename of REFERENCE_FILENAMES) {
    const filePath = path.join(referencesDir, filename);
    const buffer = await fs.readFile(filePath);
    results.push({
      name: filename,
      data: buffer.toString("base64"),
      mimeType: "image/jpeg",
    });
  }

  return results;
}

/**
 * Reads the fixed prompt from poc/prompt.txt without modifying its content.
 */
export async function loadFixedPrompt(rootDir: string = process.cwd()): Promise<string> {
  const promptPath = path.join(getPocDir(rootDir), "prompt.txt");
  return fs.readFile(promptPath, "utf8");
}

/**
 * Reads poc/references/pig.jpeg for mock mode response.
 */
export async function loadMockResultImage(
  rootDir: string = process.cwd()
): Promise<EncodedImageAsset> {
  const pigPath = path.join(getPocDir(rootDir), "references", MOCK_RESULT_FILENAME);
  const buffer = await fs.readFile(pigPath);
  return {
    name: MOCK_RESULT_FILENAME,
    data: buffer.toString("base64"),
    mimeType: "image/jpeg",
  };
}
