import { createHash, timingSafeEqual } from "node:crypto";

// /admin is already behind Vercel Authentication; every admin Server Action
// also checks ADMIN_PASSWORD so it stays closed if that protection is off.
// Unset ADMIN_PASSWORD = every attempt fails.
export function checkAdminPassword(input: FormDataEntryValue | null): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof input !== "string" || input === "") return false;
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
