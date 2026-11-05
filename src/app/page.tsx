import { SelfieGeneratorApp } from "@/components/SelfieGeneratorApp";
import { resolveRuntimeConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const config = resolveRuntimeConfig();
  return <SelfieGeneratorApp initialMockMode={config.mode === "mock"} />;
}
