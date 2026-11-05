import { ERROR_MESSAGES } from "./errors";

export type AllowedImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Inspects actual file bytes (magic numbers) rather than file extension or client MIME type.
 */
export function detectImageMimeType(bytes: Uint8Array): AllowedImageMimeType | null {
  if (!bytes || bytes.length < 4) {
    return null;
  }

  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // WebP: "RIFF" (0..3) + 4-byte size + "WEBP" (8..11)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

export type ImageValidationResult =
  | {
      ok: true;
      mimeType: AllowedImageMimeType;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export function validateSubjectImageBytes(
  bytes: Uint8Array,
  declaredSize?: number
): ImageValidationResult {
  const effectiveSize = Math.max(bytes.byteLength, declaredSize ?? 0);
  if (effectiveSize > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      status: 400,
      error: ERROR_MESSAGES.FILE_TOO_LARGE,
    };
  }

  const mimeType = detectImageMimeType(bytes);
  if (!mimeType) {
    return {
      ok: false,
      status: 400,
      error: ERROR_MESSAGES.UNSUPPORTED_FILE,
    };
  }

  return {
    ok: true,
    mimeType,
  };
}
