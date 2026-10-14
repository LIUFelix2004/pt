import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Route: GET /download/mcp — the page itself lives at /download, and Next.js
// forbids a Route Handler and a Page occupying the same segment.
// Serves the prebuilt obscura-mcp.zip with Content-Disposition: attachment.
// The zip is generated at build time (npm run bundle -w @obscura/mcp) and is
// never committed. If it is missing, return 404 with instructions instead of a
// broken download.
const ZIP_PATH = resolve(process.cwd(), "../../packages/mcp-server/dist/obscura-mcp.zip");
const SHA_PATH = resolve(process.cwd(), "../../packages/mcp-server/dist/obscura-mcp.sha256");

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const zip = readFileSync(ZIP_PATH);
    const sha = readFileSync(SHA_PATH, "utf8").trim();
    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="obscura-mcp.zip"',
        "X-Obscura-SHA256": sha,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "obscura-mcp.zip has not been built yet. Run `npm run bundle -w @obscura/mcp`." },
      { status: 404 },
    );
  }
}
