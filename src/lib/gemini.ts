import { GoogleGenAI } from "@google/genai";
import {
  type EncodedImageAsset,
  loadFixedPrompt,
  loadMockResultImage,
  loadReferenceImages,
} from "./assets";
import { type GenerationMode, resolveRuntimeConfig } from "./config";
import { NoImageGeneratedError } from "./errors";
import type { AllowedImageMimeType } from "./image-validation";

export const FIXED_MODEL = "gemini-nano-banana-2.1" as const;

export const FIXED_RESPONSE_FORMAT = {
  type: "image",
  aspect_ratio: "1:1",
  image_size: "1K",
} as const;

export const MOCK_DELAY_MS = 2000;

export type InteractionTextPart = {
  type: "text";
  text: string;
};

export type InteractionImagePart = {
  type: "image";
  data: string;
  mime_type: AllowedImageMimeType;
};

export type InteractionPart = InteractionTextPart | InteractionImagePart;

export interface SubjectImageInput {
  data: string;
  mimeType: AllowedImageMimeType;
}

/**
 * Builds the exact ordered input array for Gemini image generation:
 * 1. Text: "[구도 기준 이미지]"
 * 2. References: duck.jpeg, hippo.jpeg, pig.jpeg
 * 3. Text: "[주인공 동물 사진]"
 * 4. User's animal photo
 * 5. Full prompt from poc/prompt.txt
 */
export function buildInteractionInput(
  references: ReadonlyArray<Pick<EncodedImageAsset, "data" | "mimeType">>,
  subject: SubjectImageInput,
  prompt: string
): InteractionPart[] {
  if (references.length !== 3) {
    throw new Error(`레퍼런스 이미지는 정확히 3장이어야 합니다 (현재 ${references.length}장).`);
  }

  return [
    { type: "text", text: "[구도 기준 이미지]" },
    ...references.map(
      (ref): InteractionImagePart => ({
        type: "image",
        data: ref.data,
        mime_type: ref.mimeType,
      })
    ),
    { type: "text", text: "[주인공 동물 사진]" },
    {
      type: "image",
      data: subject.data,
      mime_type: subject.mimeType,
    },
    { type: "text", text: prompt },
  ];
}

export interface InteractionsClientLike {
  interactions: {
    create: (params: {
      model: string;
      input: InteractionPart[];
      response_format: {
        type: "image";
        aspect_ratio: "1:1";
        image_size: "1K";
      };
    }) => Promise<{
      output_image?: {
        data?: string;
        mime_type?: string;
      } | null;
    }>;
  };
}

export interface GenerateSelfieOptions {
  env?: Record<string, string | undefined>;
  allowEnvFileFallback?: boolean;
  rootDir?: string;
  mockDelayMs?: number;
  clientFactory?: (apiKey: string) => InteractionsClientLike;
}

export interface GenerateSelfieResult {
  imageBase64: string;
  mimeType: string;
  mode: GenerationMode;
}

function defaultClientFactory(apiKey: string): InteractionsClientLike {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      retryOptions: {
        attempts: 1,
      },
    },
  }) as unknown as InteractionsClientLike;
}

export async function generateGoggleSelfie(
  subject: SubjectImageInput,
  options: GenerateSelfieOptions = {}
): Promise<GenerateSelfieResult> {
  const config = resolveRuntimeConfig({
    env: options.env,
    allowEnvFileFallback: options.allowEnvFileFallback,
    rootDir: options.rootDir,
  });

  if (config.mode === "mock") {
    const delayMs = options.mockDelayMs ?? MOCK_DELAY_MS;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const mockImage = await loadMockResultImage(options.rootDir);
    return {
      imageBase64: mockImage.data,
      mimeType: mockImage.mimeType,
      mode: "mock",
    };
  }

  // live mode: config.apiKey is guaranteed non-null by resolveRuntimeConfig
  const apiKey = config.apiKey!;
  const [references, prompt] = await Promise.all([
    loadReferenceImages(options.rootDir),
    loadFixedPrompt(options.rootDir),
  ]);

  const input = buildInteractionInput(references, subject, prompt);
  const client = (options.clientFactory ?? defaultClientFactory)(apiKey);

  // Automatic retries are disabled both in client httpOptions and by not wrapping in retry loops.
  const interaction = await client.interactions.create({
    model: FIXED_MODEL,
    input,
    response_format: FIXED_RESPONSE_FORMAT,
  });

  const outputImage = interaction?.output_image;
  if (!outputImage || !outputImage.data) {
    throw new NoImageGeneratedError("응답에 이미지가 없습니다");
  }

  return {
    imageBase64: outputImage.data,
    mimeType: outputImage.mime_type || "image/png",
    mode: "live",
  };
}
