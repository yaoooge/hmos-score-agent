import assert from "node:assert/strict";
import test from "node:test";
import viteConfig from "../web/vite.config.js";

test("dashboard dev proxy leaves the page entry route to Vite", () => {
  assert.equal(typeof viteConfig, "object");
  assert.notEqual(viteConfig, null);

  const proxy = viteConfig.server?.proxy;
  assert.equal(typeof proxy, "object");
  assert.notEqual(proxy, null);

  assert.equal(
    Object.prototype.hasOwnProperty.call(proxy, "/dashboard"),
    false,
    "proxying all of /dashboard sends /dashboard/ to the API instead of the Vite app",
  );
});

test("dashboard dev proxy still forwards dashboard API routes", () => {
  assert.equal(typeof viteConfig, "object");
  assert.notEqual(viteConfig, null);

  const proxy = viteConfig.server?.proxy;
  assert.equal(typeof proxy, "object");
  assert.notEqual(proxy, null);

  for (const apiPath of [
    "/dashboard/summary",
    "/dashboard/tasks",
    "/dashboard/reports",
    "/dashboard/analysis",
    "/dashboard/cross-device",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(proxy, apiPath),
      true,
      `${apiPath} should be proxied to the API server in dev`,
    );
  }
});

test("dashboard dev proxy forwards remote task result API routes", () => {
  assert.equal(typeof viteConfig, "object");
  assert.notEqual(viteConfig, null);

  const proxy = viteConfig.server?.proxy;
  assert.equal(typeof proxy, "object");
  assert.notEqual(proxy, null);

  assert.equal(
    Object.prototype.hasOwnProperty.call(proxy, "/score/remote-tasks"),
    true,
    "/score/remote-tasks should be proxied to the API server in dev",
  );
});
