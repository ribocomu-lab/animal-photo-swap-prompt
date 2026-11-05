export const ERROR_MESSAGES = {
  UNSUPPORTED_FILE: "JPEG, PNG, WebP 사진을 올려주세요.",
  FILE_TOO_LARGE: "10MB 이하 사진을 올려주세요.",
  RATE_LIMITED: "지금은 생성이 많아요. 잠시 뒤 다시 시도해 주세요.",
  PAYMENT_REQUIRED: "서비스 점검 중이에요. 잠시 뒤 다시 시도해 주세요.",
  NO_IMAGE:
    "이미지를 만들지 못했어요. 얼굴이 잘 보이는 다른 동물 사진으로 시도해 주세요.",
  GENERIC_ERROR: "문제가 발생했어요. 잠시 뒤 다시 시도해 주세요.",
} as const;

export class NoImageGeneratedError extends Error {
  constructor(message = "응답에 이미지가 없습니다") {
    super(message);
    this.name = "NoImageGeneratedError";
  }
}

function extractHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const candidate = error as Record<string, unknown>;
  for (const key of ["status", "statusCode", "httpStatus", "code"]) {
    const val = candidate[key];
    if (typeof val === "number" && val >= 100 && val < 600) {
      return val;
    }
  }
  if (typeof candidate.message === "string") {
    if (/\b429\b|RESOURCE_EXHAUSTED|Too Many Requests/i.test(candidate.message)) {
      return 429;
    }
    if (/\b402\b|Payment Required|BILLING/i.test(candidate.message)) {
      return 402;
    }
  }
  return null;
}

export function mapGenerationErrorToResponse(error: unknown): {
  status: number;
  message: string;
} {
  if (error instanceof NoImageGeneratedError) {
    return {
      status: 422,
      message: ERROR_MESSAGES.NO_IMAGE,
    };
  }

  const httpStatus = extractHttpStatus(error);
  if (httpStatus === 429) {
    return {
      status: 429,
      message: ERROR_MESSAGES.RATE_LIMITED,
    };
  }
  if (httpStatus === 402) {
    return {
      status: 402,
      message: ERROR_MESSAGES.PAYMENT_REQUIRED,
    };
  }

  return {
    status: 500,
    message: ERROR_MESSAGES.GENERIC_ERROR,
  };
}

/**
 * Redacts potential base64 blobs, data URLs, and API keys before writing to server logs.
 */
export function sanitizeLogMessage(raw: string, apiKey?: string | null): string {
  let sanitized = raw;
  if (apiKey && apiKey.length >= 4) {
    sanitized = sanitized.split(apiKey).join("[REDACTED_API_KEY]");
  }
  sanitized = sanitized.replace(
    /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g,
    "[REDACTED_IMAGE_DATA_URL]"
  );
  sanitized = sanitized.replace(/[A-Za-z0-9+/=]{120,}/g, "[REDACTED_BASE64]");
  sanitized = sanitized.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_API_KEY]");
  return sanitized;
}

export function logServerError(
  context: string,
  error: unknown,
  apiKey?: string | null
): void {
  const status = extractHttpStatus(error);
  const rawMessage =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : "Unknown error";

  const safeMessage = sanitizeLogMessage(rawMessage, apiKey);
  console.error(
    `[goggle-selfie] ${context}${status ? ` (status=${status})` : ""}: ${safeMessage}`
  );
}
