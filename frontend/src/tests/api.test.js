// Запуск: node --test src/services/api.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { ApiError, agentInfo, startLspSession } from "./api.js";

const conn = { agentUrl: "http://agent", sessionId: "s1", filesToken: "T" };

test("каждый запрос получает сигнал таймаута", async () => {
  let signal = null;
  globalThis.fetch = async (url, options) => {
    signal = options.signal;
    return new Response("{}", { status: 200 });
  };

  await agentInfo(conn);

  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
});

test("таймаут превращается в ApiError с кодом timeout", async () => {
  globalThis.fetch = async () => {
    throw new DOMException("The operation timed out.", "TimeoutError");
  };

  await assert.rejects(startLspSession("python"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    assert.equal(error.code, "timeout");
    return true;
  });
});

test("сетевая ошибка остаётся network", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };

  await assert.rejects(agentInfo(conn), (error) => error.code === "network");
});