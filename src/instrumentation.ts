export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Validates GENERATION_MODE and GEMINI_API_KEY on Node.js server startup.
    // Fails immediately if GENERATION_MODE=live and GEMINI_API_KEY is missing.
    const { resolveRuntimeConfig } = await import("./lib/config");
    resolveRuntimeConfig();
  }
}
