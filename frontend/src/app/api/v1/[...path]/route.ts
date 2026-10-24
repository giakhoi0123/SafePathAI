import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: { path: string[] } };

const FORWARD_HEADERS = [
  "accept", "content-type", "authorization", "x-user-id",
  "if-none-match", "if-modified-since", "range", "x-request-id",
];
const HOP_HEADERS = [
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailers", "transfer-encoding", "upgrade",
];

async function forward(request: Request, { params }: RouteContext): Promise<Response> {
  const backend = process.env.INTERNAL_BACKEND_URL || process.env.BACKEND_URL ||
    (process.env.NODE_ENV !== "production" ? "http://127.0.0.1:8000" : "");

  if (!backend) {
    return NextResponse.json(
      { detail: "INTERNAL_BACKEND_URL is not configured on the frontend server" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  let target: URL;
  try {
    target = new URL(backend);
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) {
      throw new Error("Invalid backend origin");
    }
    const safePath = params.path.map((part) => encodeURIComponent(part)).join("/");
    target.pathname = `${target.pathname.replace(/\/$/, "")}/api/v1/${safePath}`;
    target.search = new URL(request.url).search;
  } catch {
    return NextResponse.json({ detail: "Invalid INTERNAL_BACKEND_URL configuration" }, { status: 503 });
  }

  const headers = new Headers();
  FORWARD_HEADERS.forEach((key) => {
    const value = request.headers.get(key);
    if (value !== null) headers.set(key, value);
  });

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
      redirect: "manual",
      cache: "no-store",
    });
    const responseHeaders = new Headers(upstream.headers);
    HOP_HEADERS.forEach((key) => responseHeaders.delete(key));
    // The browser must not receive a backend's internal redirect Location.
    const location = responseHeaders.get("location");
    if (location && location.startsWith(backend)) {
      responseHeaders.set("location", location.replace(backend, ""));
    }
    return new Response(
      upstream.status === 204 || upstream.status === 304 || request.method === "HEAD"
        ? null : upstream.body,
      { status: upstream.status, headers: responseHeaders }
    );
  } catch (error) {
    console.error("[api/v1 proxy] Backend request failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json(
      { detail: "Backend temporarily unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const HEAD = forward;
