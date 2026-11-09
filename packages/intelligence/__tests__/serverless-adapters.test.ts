import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { toNodeHandler, toFetchHandler, toLambdaHandler } from "../serverless/adapters";
import type { Handler } from "../serverless/types";

const echoHandler: Handler = async req => ({
  status: req.path === "/boom" ? 500 : 200,
  body: { method: req.method, path: req.path, query: req.query, body: req.body, clientKey: req.clientKey }
});

describe("toNodeHandler", () => {
  it("round-trips a real HTTP request through a live Node server", async () => {
    const server = createServer(toNodeHandler(echoHandler));
    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/security/assemble?x=1`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: "t1" })
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.path).toBe("/security/assemble");
      expect(data.query).toEqual({ x: "1" });
      expect(data.body).toEqual({ taskId: "t1" });
      expect(typeof data.clientKey).toBe("string");
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it("413s an oversized body before invoking the handler", async () => {
    const server = createServer(toNodeHandler(echoHandler, { maxBodyBytes: 4 }));
    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/x`, { method: "POST", body: "way more than 4 bytes" });
      expect(res.status).toBe(413);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});

describe("toFetchHandler", () => {
  it("adapts a standard Request/Response pair", async () => {
    const handler = toFetchHandler(echoHandler);
    const response = await handler(new Request("https://example.com/director/expand-team?a=b", {
      method: "POST", headers: { "cf-connecting-ip": "1.2.3.4" }, body: JSON.stringify({ requestedTeamSize: 2 })
    }));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.path).toBe("/director/expand-team");
    expect(data.query).toEqual({ a: "b" });
    expect(data.clientKey).toBe("1.2.3.4");
  });

  it("treats GET with no body as undefined body, not a parse error", async () => {
    const handler = toFetchHandler(echoHandler);
    const response = await handler(new Request("https://example.com/health"));
    const data = await response.json();
    expect(data.body).toBeUndefined();
  });

  it("propagates the handler's status code", async () => {
    const handler = toFetchHandler(echoHandler);
    const response = await handler(new Request("https://example.com/boom", { method: "POST" }));
    expect(response.status).toBe(500);
  });
});

describe("toLambdaHandler", () => {
  it("adapts an API Gateway HTTP API v2 event, plain and base64-encoded", async () => {
    const handler = toLambdaHandler(echoHandler);
    const plain = await handler({
      requestContext: { http: { method: "POST", sourceIp: "9.9.9.9" } },
      rawPath: "/security/release", rawQueryString: "k=v",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: "t1" })
    });
    expect(plain.statusCode).toBe(200);
    const parsed = JSON.parse(plain.body);
    expect(parsed.path).toBe("/security/release");
    expect(parsed.query).toEqual({ k: "v" });
    expect(parsed.clientKey).toBe("9.9.9.9");

    const encoded = await handler({
      requestContext: { http: { method: "POST" } },
      rawPath: "/x", body: Buffer.from(JSON.stringify({ a: 1 })).toString("base64"), isBase64Encoded: true
    });
    expect(JSON.parse(encoded.body).body).toEqual({ a: 1 });
  });

  it("defaults to GET and root path when the event omits them", async () => {
    const handler = toLambdaHandler(echoHandler);
    const result = await handler({});
    expect(JSON.parse(result.body).method).toBe("GET");
    expect(JSON.parse(result.body).path).toBe("/");
  });
});
