import type { NextResponse } from "next/server";
import { handleGeneratePost } from "@/lib/generate-handler";

export async function POST(request: Request): Promise<NextResponse> {
  return handleGeneratePost(request);
}
