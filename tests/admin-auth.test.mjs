import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { checkAdminPassword } from "../src/lib/admin-auth.ts";

const original = process.env.ADMIN_PASSWORD;
afterEach(() => {
  if (original === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = original;
});

test("accepts only the configured password", () => {
  process.env.ADMIN_PASSWORD = "correct horse";
  assert.ok(checkAdminPassword("correct horse"));
  assert.ok(!checkAdminPassword("correct hors"));
  assert.ok(!checkAdminPassword(""));
  assert.ok(!checkAdminPassword(null));
});

test("rejects everything when ADMIN_PASSWORD is unset", () => {
  delete process.env.ADMIN_PASSWORD;
  assert.ok(!checkAdminPassword(""));
  assert.ok(!checkAdminPassword("anything"));
});
