import {
  DEFAULT_MAX_DAILY_GENERATIONS,
  MAX_CLIENT_DAILY_GENERATIONS,
} from "./config";

interface DailyBucket {
  dateKey: string;
  totalCount: number;
  clientCounts: Map<string, number>;
}

let currentBucket: DailyBucket = {
  dateKey: "",
  totalCount: 0,
  clientCounts: new Map<string, number>(),
};

export function getDateKey(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ensureBucket(dateKey: string): DailyBucket {
  if (currentBucket.dateKey !== dateKey) {
    currentBucket = {
      dateKey,
      totalCount: 0,
      clientCounts: new Map<string, number>(),
    };
  }
  return currentBucket;
}

export interface RateLimitCheckOptions {
  maxDailyGenerations?: number;
  maxClientDailyGenerations?: number;
  now?: Date;
}

export type RateLimitResult =
  | {
      allowed: true;
      clientCount: number;
      totalCount: number;
    }
  | {
      allowed: false;
      reason: "client_limit" | "global_limit";
      clientCount: number;
      totalCount: number;
    };

/**
 * In-memory daily rate limiter for local development.
 * Enforces 3 generations/day per client and MAX_DAILY_GENERATIONS (default 50) globally.
 */
export function consumeGenerationQuota(
  clientId: string,
  options: RateLimitCheckOptions = {}
): RateLimitResult {
  const maxDaily = options.maxDailyGenerations ?? DEFAULT_MAX_DAILY_GENERATIONS;
  const maxClient =
    options.maxClientDailyGenerations ?? MAX_CLIENT_DAILY_GENERATIONS;
  const dateKey = getDateKey(options.now);
  const bucket = ensureBucket(dateKey);

  const normalizedClient = (clientId || "anonymous").trim() || "anonymous";
  const currentClientCount = bucket.clientCounts.get(normalizedClient) ?? 0;

  if (currentClientCount >= maxClient) {
    return {
      allowed: false,
      reason: "client_limit",
      clientCount: currentClientCount,
      totalCount: bucket.totalCount,
    };
  }

  if (bucket.totalCount >= maxDaily) {
    return {
      allowed: false,
      reason: "global_limit",
      clientCount: currentClientCount,
      totalCount: bucket.totalCount,
    };
  }

  const nextClientCount = currentClientCount + 1;
  bucket.clientCounts.set(normalizedClient, nextClientCount);
  bucket.totalCount += 1;

  return {
    allowed: true,
    clientCount: nextClientCount,
    totalCount: bucket.totalCount,
  };
}

export function extractClientIdentifier(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }
  return "local-client";
}

export function resetRateLimiterForTests(): void {
  currentBucket = {
    dateKey: "",
    totalCount: 0,
    clientCounts: new Map<string, number>(),
  };
}
