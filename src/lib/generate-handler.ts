import { NextResponse } from "next/server";
import { resolveRuntimeConfig } from "@/lib/config";
import {
  ERROR_MESSAGES,
  logServerError,
  mapGenerationErrorToResponse,
} from "@/lib/errors";
import {
  type GenerateSelfieOptions,
  generateGoggleSelfie,
} from "@/lib/gemini";
import {
  MAX_IMAGE_BYTES,
  validateSubjectImageBytes,
} from "@/lib/image-validation";
import {
  consumeGenerationQuota,
  extractClientIdentifier,
} from "@/lib/rate-limit";

const FORBIDDEN_OVERRIDE_KEYS = new Set([
  "prompt",
  "reference",
  "references",
  "model",
  "aspect_ratio",
  "aspectratio",
  "image_size",
  "imagesize",
  "response_format",
  "responseformat",
  "resolution",
]);

const ALLOWED_FORM_KEYS = new Set([
  "subject",
  "isAdult",
  "geminiConsent",
]);

function hasForbiddenOverrides(
  url: URL,
  formData: FormData
): string | null {
  for (const key of url.searchParams.keys()) {
    if (FORBIDDEN_OVERRIDE_KEYS.has(key.toLowerCase())) {
      return key;
    }
  }
  for (const key of formData.keys()) {
    if (FORBIDDEN_OVERRIDE_KEYS.has(key.toLowerCase())) {
      return key;
    }
    if (!ALLOWED_FORM_KEYS.has(key)) {
      return key;
    }
  }
  return null;
}

function isBlobLike(
  value: FormDataEntryValue | null
): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Blob).arrayBuffer === "function"
  );
}

export async function handleGeneratePost(
  request: Request,
  options: GenerateSelfieOptions = {}
): Promise<NextResponse> {
  let apiKeyForLogging: string | null = null;

  try {
    // 1. Validate runtime mode & API key first (never auto-fallback from live to mock)
    let config;
    try {
      config = resolveRuntimeConfig({
        env: options.env,
        allowEnvFileFallback: options.allowEnvFileFallback,
        rootDir: options.rootDir,
      });
      apiKeyForLogging = config.apiKey;
    } catch (configError) {
      logServerError("runtime-config-error", configError, null);
      const message =
        configError instanceof Error
          ? configError.message
          : ERROR_MESSAGES.GENERIC_ERROR;
      return NextResponse.json(
        { error: message },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 2. Parse multipart/form-data
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: ERROR_MESSAGES.UNSUPPORTED_FILE },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 3. Reject any attempt to override prompt, references, model, or resolution
    const url = new URL(request.url);
    const forbiddenKey = hasForbiddenOverrides(url, formData);
    if (forbiddenKey) {
      return NextResponse.json(
        { error: "프롬프트, 레퍼런스, 모델, 해상도 값은 지정할 수 없습니다." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 4. Verify required consents (18+ confirmation and Gemini API transmission consent)
    const isAdult = formData.get("isAdult") === "true";
    const geminiConsent = formData.get("geminiConsent") === "true";
    if (!isAdult || !geminiConsent) {
      return NextResponse.json(
        { error: "만 18세 이상 확인과 사진 전송 동의가 모두 필요합니다." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 5. Verify single subject file upload
    const subjectEntries = formData.getAll("subject");
    if (subjectEntries.length === 0) {
      return NextResponse.json(
        { error: ERROR_MESSAGES.UNSUPPORTED_FILE },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (subjectEntries.length > 1) {
      return NextResponse.json(
        { error: "동물 사진은 1장만 올릴 수 있습니다." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const fileEntry = subjectEntries[0] ?? null;
    if (!isBlobLike(fileEntry)) {
      return NextResponse.json(
        { error: ERROR_MESSAGES.UNSUPPORTED_FILE },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (fileEntry.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: ERROR_MESSAGES.FILE_TOO_LARGE },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 6. Validate actual file bytes (magic numbers, not extension)
    let rawBytes: Uint8Array | null = new Uint8Array(
      await fileEntry.arrayBuffer()
    );
    const validation = validateSubjectImageBytes(rawBytes, fileEntry.size);
    if (!validation.ok) {
      rawBytes = null;
      return NextResponse.json(
        { error: validation.error },
        { status: validation.status, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 7. Enforce daily rate limits (3/day per client, MAX_DAILY_GENERATIONS/day total)
    const clientId = extractClientIdentifier(request);
    const quota = consumeGenerationQuota(clientId, {
      maxDailyGenerations: config.maxDailyGenerations,
      maxClientDailyGenerations: config.maxClientDailyGenerations,
    });
    if (!quota.allowed) {
      rawBytes = null;
      return NextResponse.json(
        { error: ERROR_MESSAGES.RATE_LIMITED },
        { status: 429, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 8. Generate goggle selfie and immediately release user image buffers from memory
    let subjectBase64: string | null = Buffer.from(rawBytes).toString("base64");
    rawBytes = null;

    const result = await generateGoggleSelfie(
      {
        data: subjectBase64,
        mimeType: validation.mimeType,
      },
      options
    );
    subjectBase64 = null;

    return NextResponse.json(
      {
        imageDataUrl: `data:${result.mimeType};base64,${result.imageBase64}`,
        mimeType: result.mimeType,
        mode: result.mode,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    logServerError("generate-selfie-failed", error, apiKeyForLogging);
    const mapped = mapGenerationErrorToResponse(error);
    return NextResponse.json(
      { error: mapped.message },
      {
        status: mapped.status,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
