import { describe, test, expect, afterAll, spyOn, afterEach } from "bun:test";

// Start mock server with a mutable handler before importing api.ts
let mockHandler: (req: Request) => Response | Promise<Response> = () =>
  new Response("not configured", { status: 500 });

const server = Bun.serve({
  // 127.0.0.1 on both sides — "localhost" can resolve to ::1 first and
  // intermittently stall fetches (random timeout failures).
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    return mockHandler(req);
  },
});

// Set env vars BEFORE importing api.ts so BASE and token resolve correctly
process.env.VX_API_BASE = `http://127.0.0.1:${server.port}`;
process.env.VERCEL_TOKEN = "test-token-123";

// Dynamic import after env is configured
const { vercel, vercelStream } = await import("../src/api.ts");

afterAll(() => server.stop());

describe("vercel()", () => {
  afterEach(() => {
    mockHandler = () => new Response("not configured", { status: 500 });
  });

  test("basic GET returns parsed JSON", async () => {
    let capturedUrl = "";
    let capturedAuth = "";
    mockHandler = (req) => {
      capturedUrl = req.url;
      capturedAuth = req.headers.get("Authorization") ?? "";
      return Response.json({ ok: true });
    };

    const result = await vercel("/test");

    expect(result).toEqual({ ok: true });
    expect(new URL(capturedUrl).pathname).toBe("/test");
    expect(capturedAuth).toBe("Bearer test-token-123");
  });

  test("request URL starts with mock server base and includes path", async () => {
    let capturedUrl = "";
    mockHandler = (req) => {
      capturedUrl = req.url;
      return Response.json({});
    };

    await vercel("/v6/deployments");

    const url = new URL(capturedUrl);
    expect(url.pathname).toBe("/v6/deployments");
    expect(url.origin).toBe(`http://127.0.0.1:${server.port}`);
  });

  test("throws on non-ok response", async () => {
    mockHandler = () => new Response("not found", { status: 404 });

    expect(vercel("/bad")).rejects.toThrow("Vercel API 404: not found");
  });

  test("403 with invalidToken gives token-expired hint", async () => {
    mockHandler = () => new Response(
      JSON.stringify({ error: { code: "forbidden", message: "Not authorized", invalidToken: true } }),
      { status: 403 }
    );

    expect(vercel("/bad")).rejects.toThrow("token is invalid or expired");
  });

  test("403 without invalidToken gives scope hint", async () => {
    mockHandler = () => new Response(
      JSON.stringify({ error: { code: "forbidden", message: "Not authorized" } }),
      { status: 403 }
    );

    expect(vercel("/bad")).rejects.toThrow("token may lack scope");
  });

  test("401 gives VERCEL_TOKEN hint", async () => {
    mockHandler = () => new Response("unauthorized", { status: 401 });

    expect(vercel("/bad")).rejects.toThrow("check VERCEL_TOKEN");
  });

  // The warning goes through hint(), which is suppressed when stdout is piped
  // (as it is under `bun test`) — VX_HINTS=1 forces it on so it's observable.
  test("warns when rate limit remaining < 10", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    process.env.VX_HINTS = "1";
    mockHandler = () =>
      Response.json({}, { headers: { "X-RateLimit-Remaining": "5" } });

    try {
      await vercel("/test");
    } finally {
      delete process.env.VX_HINTS;
    }

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain("5");
    spy.mockRestore();
  });

  test("no warning when rate limit remaining > 10", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    process.env.VX_HINTS = "1";
    mockHandler = () =>
      Response.json({}, { headers: { "X-RateLimit-Remaining": "100" } });

    try {
      await vercel("/test");
    } finally {
      delete process.env.VX_HINTS;
    }

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test("POST with body sends correct method and payload", async () => {
    let capturedMethod = "";
    let capturedBody = "";
    mockHandler = async (req) => {
      capturedMethod = req.method;
      capturedBody = await req.text();
      return Response.json({ created: true });
    };

    const result = await vercel("/test", { method: "POST", body: { key: "value" } });

    expect(result).toEqual({ created: true });
    expect(capturedMethod).toBe("POST");
    expect(capturedBody).toBe('{"key":"value"}');
  });
});

describe("vercelStream()", () => {
  afterEach(() => {
    mockHandler = () => new Response("not configured", { status: 500 });
  });

  test("returns raw Response with body intact", async () => {
    mockHandler = () => new Response("streaming data");

    const res = await vercelStream("/stream");

    expect(res).toBeInstanceOf(Response);
    expect(await res.text()).toBe("streaming data");
  });
});
