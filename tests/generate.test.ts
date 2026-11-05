import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleGeneratePost } from "@/lib/generate-handler";
import {
  loadFixedPrompt,
  loadReferenceImages,
} from "@/lib/assets";
import { resolveRuntimeConfig } from "@/lib/config";
import { ERROR_MESSAGES, sanitizeLogMessage } from "@/lib/errors";
import {
  buildInteractionInput,
  FIXED_MODEL,
  FIXED_RESPONSE_FORMAT,
  generateGoggleSelfie,
  type InteractionsClientLike,
} from "@/lib/gemini";
import {
  detectImageMimeType,
  MAX_IMAGE_BYTES,
} from "@/lib/image-validation";
import { resetRateLimiterForTests } from "@/lib/rate-limit";

function createValidJpegBytes(extraLength = 32): Uint8Array {
  const bytes = new Uint8Array(4 + extraLength);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xe0;
  return bytes;
}

function createValidPngBytes(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
}

function createValidWebpBytes(): Uint8Array {
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x24, 0x00, 0x00, 0x00, // size
    0x57, 0x45, 0x42, 0x50, // "WEBP"
    0x56, 0x50, 0x38, 0x20,
  ]);
}

function buildValidFormData(
  bytes: Uint8Array = createValidJpegBytes(),
  filename = "dog.jpeg",
  mimeType = "image/jpeg"
): FormData {
  const formData = new FormData();
  const blob = new Blob([bytes], { type: mimeType });
  formData.append("subject", blob, filename);
  formData.append("isAdult", "true");
  formData.append("geminiConsent", "true");
  return formData;
}

describe("수경 셀카 생성 웹앱 검증 테스트", () => {
  beforeEach(() => {
    resetRateLimiterForTests();
  });

  describe("1. 입력 순서 및 고정 파라미터 검증 (실제 Gemini 미호출)", () => {
    it("입력 순서가 [구도 기준 이미지] -> duck, hippo, pig -> [주인공 동물 사진] -> 사용자 사진 -> poc/prompt.txt 전문 순서와 정확히 일치한다", async () => {
      const references = await loadReferenceImages();
      const prompt = await loadFixedPrompt();
      const duckBytes = fs.readFileSync(
        path.join(process.cwd(), "poc/references/duck.jpeg")
      );
      const hippoBytes = fs.readFileSync(
        path.join(process.cwd(), "poc/references/hippo.jpeg")
      );
      const pigBytes = fs.readFileSync(
        path.join(process.cwd(), "poc/references/pig.jpeg")
      );
      const rawPrompt = fs.readFileSync(
        path.join(process.cwd(), "poc/prompt.txt"),
        "utf8"
      );

      const subjectData = Buffer.from(createValidPngBytes()).toString("base64");
      const parts = buildInteractionInput(
        references,
        { data: subjectData, mimeType: "image/png" },
        prompt
      );

      expect(parts).toHaveLength(7);
      // 1. 텍스트 [구도 기준 이미지]
      expect(parts[0]).toEqual({
        type: "text",
        text: "[구도 기준 이미지]",
      });
      // 2. duck.jpeg, hippo.jpeg, pig.jpeg 순서 고정
      expect(parts[1]).toEqual({
        type: "image",
        data: duckBytes.toString("base64"),
        mime_type: "image/jpeg",
      });
      expect(parts[2]).toEqual({
        type: "image",
        data: hippoBytes.toString("base64"),
        mime_type: "image/jpeg",
      });
      expect(parts[3]).toEqual({
        type: "image",
        data: pigBytes.toString("base64"),
        mime_type: "image/jpeg",
      });
      // 3. 텍스트 [주인공 동물 사진]
      expect(parts[4]).toEqual({
        type: "text",
        text: "[주인공 동물 사진]",
      });
      // 4. 사용자 사진
      expect(parts[5]).toEqual({
        type: "image",
        data: subjectData,
        mime_type: "image/png",
      });
      // 5. poc/prompt.txt 전문
      expect(parts[6]).toEqual({
        type: "text",
        text: rawPrompt,
      });
    });

    it("live 모드에서 가짜(mock) 클라이언트로 호출할 때 모델, 해상도, 비율, 입력 순서가 정확히 전달된다", async () => {
      const createSpy = vi.fn().mockResolvedValue({
        output_image: {
          data: Buffer.from("generated-image").toString("base64"),
          mime_type: "image/png",
        },
      });
      const fakeClientFactory = vi.fn(
        (): InteractionsClientLike => ({
          interactions: {
            create: createSpy,
          },
        })
      );

      const subjectBase64 = Buffer.from(createValidJpegBytes()).toString(
        "base64"
      );
      const result = await generateGoggleSelfie(
        { data: subjectBase64, mimeType: "image/jpeg" },
        {
          env: {
            GENERATION_MODE: "live",
            GEMINI_API_KEY: "test-only-fake-key",
          },
          allowEnvFileFallback: false,
          clientFactory: fakeClientFactory,
        }
      );

      expect(fakeClientFactory).toHaveBeenCalledWith("test-only-fake-key");
      expect(createSpy).toHaveBeenCalledTimes(1);

      const callArg = createSpy.mock.calls[0]?.[0];
      expect(callArg.model).toBe(FIXED_MODEL);
      expect(callArg.response_format).toEqual(FIXED_RESPONSE_FORMAT);
      expect(callArg.input).toHaveLength(7);
      expect(callArg.input[0]).toEqual({
        type: "text",
        text: "[구도 기준 이미지]",
      });
      expect(callArg.input[4]).toEqual({
        type: "text",
        text: "[주인공 동물 사진]",
      });
      expect(callArg.input[5]).toEqual({
        type: "image",
        data: subjectBase64,
        mime_type: "image/jpeg",
      });
      expect(result.mode).toBe("live");
      expect(result.imageBase64).toBe(
        Buffer.from("generated-image").toString("base64")
      );
    });
  });

  describe("2. 실행 모드 (mock 및 live 키 누락 오류)", () => {
    it("GENERATION_MODE=mock일 때 Gemini를 호출하지 않고 poc/references/pig.jpeg를 반환한다", async () => {
      const fakeClientFactory = vi.fn();
      const pigBase64 = fs
        .readFileSync(path.join(process.cwd(), "poc/references/pig.jpeg"))
        .toString("base64");

      const result = await generateGoggleSelfie(
        {
          data: Buffer.from(createValidJpegBytes()).toString("base64"),
          mimeType: "image/jpeg",
        },
        {
          env: { GENERATION_MODE: "mock" },
          allowEnvFileFallback: false,
          mockDelayMs: 5,
          clientFactory: fakeClientFactory,
        }
      );

      expect(fakeClientFactory).not.toHaveBeenCalled();
      expect(result.mode).toBe("mock");
      expect(result.imageBase64).toBe(pigBase64);
    });

    it("live 모드에서 GEMINI_API_KEY가 없으면 mock으로 전환하지 않고 명확한 오류를 던진다", async () => {
      expect(() =>
        resolveRuntimeConfig({
          env: { GENERATION_MODE: "live", GEMINI_API_KEY: "" },
          allowEnvFileFallback: false,
        })
      ).toThrow(/GEMINI_API_KEY/);

      const request = new Request("http://localhost:3000/api/generate", {
        method: "POST",
        body: buildValidFormData(),
      });
      const response = await handleGeneratePost(request, {
        env: { GENERATION_MODE: "live", GEMINI_API_KEY: "" },
        allowEnvFileFallback: false,
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toMatch(/GEMINI_API_KEY/);
      expect(body.imageDataUrl).toBeUndefined();
    });
  });

  describe("3. API 요청 변조 차단 (프롬프트, 레퍼런스, 모델, 해상도)", () => {
    it.each([
      ["prompt", "고양이를 우주비행사로 그려줘"],
      ["references", "custom.jpeg"],
      ["reference", "custom.jpeg"],
      ["model", "gemini-2.5-flash"],
      ["aspect_ratio", "16:9"],
      ["image_size", "4K"],
    ])(
      "FormData에 허용되지 않은 %s 필드를 보내면 400으로 거부한다",
      async (field, value) => {
        const formData = buildValidFormData();
        formData.append(field, value);

        const request = new Request("http://localhost:3000/api/generate", {
          method: "POST",
          body: formData,
        });
        const response = await handleGeneratePost(request, {
          env: { GENERATION_MODE: "mock" },
          allowEnvFileFallback: false,
          mockDelayMs: 0,
        });

        expect(response.status).toBe(400);
      }
    );

    it("쿼리 스트링으로 prompt나 model 변경을 시도해도 400으로 거부한다", async () => {
      const request = new Request(
        "http://localhost:3000/api/generate?model=other&prompt=hack",
        {
          method: "POST",
          body: buildValidFormData(),
        }
      );
      const response = await handleGeneratePost(request, {
        env: { GENERATION_MODE: "mock" },
        allowEnvFileFallback: false,
        mockDelayMs: 0,
      });

      expect(response.status).toBe(400);
    });
  });

  describe("4. 파일 형식(매직 바이트), 10MB 크기 제한, 동의 누락, 한도 초과 검증", () => {
    it("확장자가 .jpeg여도 실제 내용이 이미지가 아니면 거부한다", async () => {
      const fakeBytes = new TextEncoder().encode("not an actual image file");
      expect(detectImageMimeType(fakeBytes)).toBeNull();

      const formData = buildValidFormData(
        fakeBytes,
        "fake-photo.jpeg",
        "image/jpeg"
      );
      const request = new Request("http://localhost:3000/api/generate", {
        method: "POST",
        body: formData,
      });
      const response = await handleGeneratePost(request, {
        env: { GENERATION_MODE: "mock" },
        allowEnvFileFallback: false,
        mockDelayMs: 0,
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe(ERROR_MESSAGES.UNSUPPORTED_FILE);
    });

    it("JPEG, PNG, WebP 실제 매직 바이트를 정확히 판별한다", () => {
      expect(detectImageMimeType(createValidJpegBytes())).toBe("image/jpeg");
      expect(detectImageMimeType(createValidPngBytes())).toBe("image/png");
      expect(detectImageMimeType(createValidWebpBytes())).toBe("image/webp");
    });

    it("10MB를 초과하는 파일은 거부하고 지정된 안내 문구를 반환한다", async () => {
      const oversizedBytes = new Uint8Array(MAX_IMAGE_BYTES + 1);
      oversizedBytes[0] = 0xff;
      oversizedBytes[1] = 0xd8;
      oversizedBytes[2] = 0xff;

      const formData = buildValidFormData(oversizedBytes);
      const request = new Request("http://localhost:3000/api/generate", {
        method: "POST",
        body: formData,
      });
      const response = await handleGeneratePost(request, {
        env: { GENERATION_MODE: "mock" },
        allowEnvFileFallback: false,
        mockDelayMs: 0,
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe(ERROR_MESSAGES.FILE_TOO_LARGE);
    });

    it("만 18세 이상 확인 또는 사진 전송 동의가 누락되면 요청을 거부한다", async () => {
      const formWithoutAdult = new FormData();
      formWithoutAdult.append(
        "subject",
        new Blob([createValidJpegBytes()], { type: "image/jpeg" }),
        "pet.jpeg"
      );
      formWithoutAdult.append("isAdult", "false");
      formWithoutAdult.append("geminiConsent", "true");

      const res1 = await handleGeneratePost(
        new Request("http://localhost:3000/api/generate", {
          method: "POST",
          body: formWithoutAdult,
        }),
        { env: { GENERATION_MODE: "mock" }, mockDelayMs: 0 }
      );
      expect(res1.status).toBe(400);

      const formWithoutGeminiConsent = new FormData();
      formWithoutGeminiConsent.append(
        "subject",
        new Blob([createValidJpegBytes()], { type: "image/jpeg" }),
        "pet.jpeg"
      );
      formWithoutGeminiConsent.append("isAdult", "true");
      formWithoutGeminiConsent.append("geminiConsent", "false");

      const res2 = await handleGeneratePost(
        new Request("http://localhost:3000/api/generate", {
          method: "POST",
          body: formWithoutGeminiConsent,
        }),
        { env: { GENERATION_MODE: "mock" }, mockDelayMs: 0 }
      );
      expect(res2.status).toBe(400);
    });

    it("여러 장 업로드를 시도하면 거부한다", async () => {
      const formData = buildValidFormData();
      formData.append(
        "subject",
        new Blob([createValidJpegBytes()], { type: "image/jpeg" }),
        "second.jpeg"
      );

      const response = await handleGeneratePost(
        new Request("http://localhost:3000/api/generate", {
          method: "POST",
          body: formData,
        }),
        { env: { GENERATION_MODE: "mock" }, mockDelayMs: 0 }
      );
      expect(response.status).toBe(400);
    });

    it("클라이언트별 하루 3회 한도를 초과하면 429와 지정 문구를 반환하고 Gemini를 호출하지 않는다", async () => {
      const clientFactory = vi.fn();

      for (let i = 0; i < 3; i += 1) {
        const okRes = await handleGeneratePost(
          new Request("http://localhost:3000/api/generate", {
            method: "POST",
            headers: { "x-forwarded-for": "203.0.113.10" },
            body: buildValidFormData(),
          }),
          {
            env: { GENERATION_MODE: "mock" },
            allowEnvFileFallback: false,
            mockDelayMs: 0,
            clientFactory,
          }
        );
        expect(okRes.status).toBe(200);
      }

      const fourthRes = await handleGeneratePost(
        new Request("http://localhost:3000/api/generate", {
          method: "POST",
          headers: { "x-forwarded-for": "203.0.113.10" },
          body: buildValidFormData(),
        }),
        {
          env: { GENERATION_MODE: "mock" },
          allowEnvFileFallback: false,
          mockDelayMs: 0,
          clientFactory,
        }
      );

      expect(fourthRes.status).toBe(429);
      const body = await fourthRes.json();
      expect(body.error).toBe(ERROR_MESSAGES.RATE_LIMITED);
      expect(clientFactory).not.toHaveBeenCalled();
    });

    it("전체 일일 한도(MAX_DAILY_GENERATIONS)를 초과하면 429를 반환한다", async () => {
      const env = {
        GENERATION_MODE: "mock",
        MAX_DAILY_GENERATIONS: "2",
      };

      const res1 = await handleGeneratePost(
        new Request("http://localhost:3000/api/generate", {
          method: "POST",
          headers: { "x-forwarded-for": "198.51.100.1" },
          body: buildValidFormData(),
        }),
        { env, allowEnvFileFallback: false, mockDelayMs: 0 }
      );
      expect(res1.status).toBe(200);

      const res2 = await handleGeneratePost(
        new Request("http://localhost:3000/api/generate", {
          method: "POST",
          headers: { "x-forwarded-for": "198.51.100.2" },
          body: buildValidFormData(),
        }),
        { env, allowEnvFileFallback: false, mockDelayMs: 0 }
      );
      expect(res2.status).toBe(200);

      const res3 = await handleGeneratePost(
        new Request("http://localhost:3000/api/generate", {
          method: "POST",
          headers: { "x-forwarded-for": "198.51.100.3" },
          body: buildValidFormData(),
        }),
        { env, allowEnvFileFallback: false, mockDelayMs: 0 }
      );
      expect(res3.status).toBe(429);
      const body = await res3.json();
      expect(body.error).toBe(ERROR_MESSAGES.RATE_LIMITED);
    });
  });

  describe("5. 상위 API 오류 매핑 및 민감정보 로그 마스킹", () => {
    it("HTTP 402, 429, 이미지 없음 응답을 명세된 문구로 정확히 매핑한다", async () => {
      const makeErrorClient = (err: unknown): InteractionsClientLike => ({
        interactions: {
          create: vi.fn().mockRejectedValue(err),
        },
      });

      const res402 = await handleGeneratePost(
        new Request("http://localhost:3000/api/generate", {
          method: "POST",
          body: buildValidFormData(),
        }),
        {
          env: { GENERATION_MODE: "live", GEMINI_API_KEY: "dummy-key" },
          allowEnvFileFallback: false,
          clientFactory: () => makeErrorClient({ status: 402, message: "Billing needed" }),
        }
      );
      expect(res402.status).toBe(402);
      expect((await res402.json()).error).toBe(ERROR_MESSAGES.PAYMENT_REQUIRED);

      const res429 = await handleGeneratePost(
        new Request("http://localhost:3000/api/generate", {
          method: "POST",
          body: buildValidFormData(),
        }),
        {
          env: { GENERATION_MODE: "live", GEMINI_API_KEY: "dummy-key" },
          allowEnvFileFallback: false,
          clientFactory: () => makeErrorClient({ status: 429, message: "Too Many Requests" }),
        }
      );
      expect(res429.status).toBe(429);
      expect((await res429.json()).error).toBe(ERROR_MESSAGES.RATE_LIMITED);

      const resNoImg = await handleGeneratePost(
        new Request("http://localhost:3000/api/generate", {
          method: "POST",
          body: buildValidFormData(),
        }),
        {
          env: { GENERATION_MODE: "live", GEMINI_API_KEY: "dummy-key" },
          allowEnvFileFallback: false,
          clientFactory: () => ({
            interactions: {
              create: vi.fn().mockResolvedValue({ output_image: null }),
            },
          }),
        }
      );
      expect(resNoImg.status).toBe(422);
      expect((await resNoImg.json()).error).toBe(ERROR_MESSAGES.NO_IMAGE);
    });

    it("로그 메시지에서 API 키와 이미지 base64 데이터를 제거한다", () => {
      const fakeKey = "AIzaSyTestSecretKey1234567890";
      const fakeBase64 = "A".repeat(200);
      const sanitized = sanitizeLogMessage(
        `Failed with key=${fakeKey} payload=data:image/jpeg;base64,${fakeBase64}`,
        fakeKey
      );
      expect(sanitized).not.toContain(fakeKey);
      expect(sanitized).not.toContain(fakeBase64);
    });
  });

  describe("6. 고정 자산 공개 경로 및 클라이언트 번들 미포함 확인", () => {
    it("public/ 디렉토리에 레퍼런스 이미지나 프롬프트 파일이 복사되어 있지 않다", () => {
      const publicDir = path.join(process.cwd(), "public");
      if (!fs.existsSync(publicDir)) {
        expect(fs.existsSync(publicDir)).toBe(false);
        return;
      }
      const files = fs.readdirSync(publicDir);
      expect(files).not.toContain("duck.jpeg");
      expect(files).not.toContain("hippo.jpeg");
      expect(files).not.toContain("pig.jpeg");
      expect(files).not.toContain("prompt.txt");
    });

    it("클라이언트 번들(.next/static)에 프롬프트 문구나 레퍼런스 파일이 포함되지 않는다", () => {
      const staticDir = path.join(process.cwd(), ".next", "static");
      if (!fs.existsSync(staticDir)) {
        return;
      }

      const collectFiles = (dir: string): string[] => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const out: string[] = [];
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            out.push(...collectFiles(full));
          } else {
            out.push(full);
          }
        }
        return out;
      };

      const allStaticFiles = collectFiles(staticDir);
      const duckBase64Prefix = fs
        .readFileSync(path.join(process.cwd(), "poc/references/duck.jpeg"))
        .toString("base64")
        .slice(0, 64);

      for (const filePath of allStaticFiles) {
        const basename = path.basename(filePath);
        expect(basename).not.toBe("duck.jpeg");
        expect(basename).not.toBe("hippo.jpeg");
        expect(basename).not.toBe("pig.jpeg");
        expect(basename).not.toBe("prompt.txt");

        if (filePath.endsWith(".js") || filePath.endsWith(".css")) {
          const content = fs.readFileSync(filePath, "utf8");
          expect(content).not.toContain("[구도 기준 이미지]");
          expect(content).not.toContain("[주인공 동물 사진]");
          expect(content).not.toContain("검은색 실리콘 수모");
          expect(content).not.toContain("duck.jpeg");
          expect(content).not.toContain("hippo.jpeg");
          expect(content).not.toContain(duckBase64Prefix);
        }
      }
    });
  });
});
