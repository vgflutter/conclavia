import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PUBLIC_MEETING_PATHS = [
  "/meeting-room/",
  "/api/meeting-room/",
  "/api/avatar/voice-assets/",
  "/api/webhooks/recall",
  "/api/webhooks/attendee",
  "/api/health",
  "/_next/",
];

export function proxy(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestHost = forwardedHost || request.headers.get("host") || request.nextUrl.hostname;
  if (!requestHost.endsWith(".trycloudflare.com")) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  if (PUBLIC_MEETING_PATHS.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  return new NextResponse("Not found", { status: 404 });
}

export const config = {
  matcher: "/:path*",
};
