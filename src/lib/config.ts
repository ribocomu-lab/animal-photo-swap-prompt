import fs from "node:fs";
import path from "node:path";

export type GenerationMode = "mock" | "live";

export interface RuntimeConfig {
  mode: GenerationMode;
  apiKey: string | null;
  maxDailyGenerations: number;
  maxClientDailyGenerations: number;
}

export const DEFAULT_MAX_DAILY_GENERATIONS = 50;
export const MAX_CLIENT_DAILY_GENERATIONS = 3;

function readApiKeyFromEnvFile(rootDir: string = process.cwd()): string | null {
  const envFilePath = path.join(rootDir, ".env.local");
  if (!fs.existsSync(envFilePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(envFilePath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }
      const name = line.slice(0, separatorIndex).trim();
      if (name === "GEMINI_API_KEY") {
        const value = line
          .slice(separatorIndex + 1)
          .trim()
          .replace(/^['"]|['"]$/g, "");
        return value || null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export interface ResolveConfigOptions {
  env?: Record<string, string | undefined>;
  allowEnvFileFallback?: boolean;
  rootDir?: string;
}

export function resolveRuntimeConfig(options: ResolveConfigOptions = {}): RuntimeConfig {
  const env = options.env ?? process.env;
  const allowEnvFileFallback = options.allowEnvFileFallback ?? (options.env === undefined);

  const rawMode = (env.GENERATION_MODE ?? "mock").trim() || "mock";
  if (rawMode !== "mock" && rawMode !== "live") {
    throw new Error(
      `지원하지 않는 GENERATION_MODE 값입니다: "${rawMode}". "mock" 또는 "live"만 사용할 수 있습니다.`
    );
  }

  const mode: GenerationMode = rawMode;

  const envApiKey = env.GEMINI_API_KEY?.trim() || null;
  const apiKey =
    envApiKey ?? (allowEnvFileFallback ? readApiKeyFromEnvFile(options.rootDir) : null);

  if (mode === "live" && !apiKey) {
    throw new Error(
      "GENERATION_MODE=live 실행 시 GEMINI_API_KEY 환경 변수가 필요합니다. mock 모드로 자동 전환하지 않습니다."
    );
  }

  const rawMaxDaily = env.MAX_DAILY_GENERATIONS?.trim();
  let maxDailyGenerations = DEFAULT_MAX_DAILY_GENERATIONS;
  if (rawMaxDaily) {
    const parsed = Number.parseInt(rawMaxDaily, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      maxDailyGenerations = parsed;
    }
  }

  return {
    mode,
    apiKey,
    maxDailyGenerations,
    maxClientDailyGenerations: MAX_CLIENT_DAILY_GENERATIONS,
  };
}
