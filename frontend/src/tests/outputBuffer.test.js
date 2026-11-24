import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_OUTPUT_CHARS,
  appendChunks,
  cleanOutput,
  splitPartial,
} from "../services/outputBuffer.js";

test("cleanOutput убирает ANSI-коды и CRLF", () => {
  assert.equal(cleanOutput("\x1b[31mошибка\x1b[0m\r\nок"), "ошибка\nок");
});

test("appendChunks склеивает соседние куски одного потока", () => {
  const out = appendChunks(
    [{ stream: "stdout", text: "a" }],
    [
      { stream: "stdout", text: "b" },
      { stream: "stdin", text: "c\n" },
      { stream: "stdout", text: "d" },
    ]
  );
  assert.deepEqual(out, [
    { stream: "stdout", text: "ab" },
    { stream: "stdin", text: "c\n" },
    { stream: "stdout", text: "d" },
  ]);
});

test("appendChunks обрезает начало по лимиту", () => {
  const out = appendChunks(
    [{ stream: "stdout", text: "x".repeat(MAX_OUTPUT_CHARS) }],
    [{ stream: "stdout", text: "yyy" }]
  );
  const total = out.reduce((n, c) => n + c.text.length, 0);
  assert.equal(total, MAX_OUTPUT_CHARS);
  assert.ok(out[0].text.endsWith("yyy"));
});

test("splitPartial отделяет приглашение input() от законченных строк", () => {
  const { done, partial } = splitPartial([
    { stream: "stdout", text: "Привет\nКак тебя зовут? " },
  ]);
  assert.deepEqual(done, [{ stream: "stdout", text: "Привет\n" }]);
  assert.deepEqual(partial, [{ stream: "stdout", text: "Как тебя зовут? " }]);
});

test("splitPartial: после эхо ввода незаконченной строки нет", () => {
  const { done, partial } = splitPartial([
    { stream: "stdout", text: "Имя? " },
    { stream: "stdin", text: "Аня\n" },
  ]);
  assert.equal(done.map((c) => c.text).join(""), "Имя? Аня\n");
  assert.deepEqual(partial, []);
});

test("splitPartial без переводов строк", () => {
  const chunks = [{ stream: "stdout", text: ">>> " }];
  assert.deepEqual(splitPartial(chunks), { done: [], partial: chunks });
});
