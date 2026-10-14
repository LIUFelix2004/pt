interface Env {
  PORTUS_API_ORIGIN?: string;
}

const DEFAULT_ORIGIN = "http://85.155.224.140.sslip.io:8787";

function apiOrigin(env: Env): string {
  const raw = (env.PORTUS_API_ORIGIN || DEFAULT_ORIGIN).trim();
  return raw.replace(/\/$/, "");
}

function buildTarget(request: Request, origin: string): string {
  const url = new URL(request.url);
  let path = url.pathname.replace(/^\/api/, "");
  if (!path.startsWith("/")) path = `/${path}`;
  return `${origin}${path}${url.search}`;
}

function proxyHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  for (const h of [
    "host",
    "cf-connecting-ip",
    "cf-ray",
    "cf-visitor",
    "cf-ipcountry",
    "x-forwarded-proto",
    "x-forwarded-for",
    "x-real-ip",
    "content-length",
  ]) {
    headers.delete(h);
  }
  return headers;
}

function withCors(headers: Headers, request: Request): Headers {
  const out = new Headers(headers);
  const origin = request.headers.get("Origin") || "*";
  out.set("Access-Control-Allow-Origin", origin);
  out.set("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
  out.set(
    "Access-Control-Allow-Headers",
    request.headers.get("Access-Control-Request-Headers") || "Content-Type, Authorization",
  );
  out.set("Access-Control-Max-Age", "86400");
  if (!out.has("Cache-Control")) {
    out.set("Cache-Control", "no-store");
  }
  return out;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: withCors(new Headers(), request),
    });
  }

  const origin = apiOrigin(env);
  const target = buildTarget(request, origin);
  const init: RequestInit = {
    method: request.method,
    headers: proxyHeaders(request),
    redirect: "follow",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    (init as RequestInit & { duplex?: string }).duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: "upstream_unreachable", detail: message }), {
      status: 502,
      headers: withCors(new Headers({ "Content-Type": "application/json" }), request),
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: withCors(new Headers(upstream.headers), request),
  });
};