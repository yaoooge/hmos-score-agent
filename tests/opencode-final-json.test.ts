import assert from "node:assert/strict";
import test from "node:test";
import { FinalJsonParseError, extractFinalJsonObject } from "../src/opencode/finalJson.js";

test("extractFinalJsonObject parses raw JSON object", () => {
  assert.deepEqual(extractFinalJsonObject('{"ok":true}'), { ok: true });
});

test("extractFinalJsonObject parses fenced JSON object", () => {
  assert.deepEqual(extractFinalJsonObject('```json\n{"ok":true}\n```'), { ok: true });
});

test("extractFinalJsonObject parses a single object with surrounding text", () => {
  assert.deepEqual(extractFinalJsonObject('结果如下：\n{"ok":true}\n结束'), { ok: true });
});

test("extractFinalJsonObject rejects malformed JSON", () => {
  assert.throws(() => extractFinalJsonObject('{"ok":'), FinalJsonParseError);
});

test("extractFinalJsonObject rejects multiple JSON objects", () => {
  assert.throws(() => extractFinalJsonObject('{"a":1}\n{"b":2}'), FinalJsonParseError);
});
