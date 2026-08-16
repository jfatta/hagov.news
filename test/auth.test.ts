import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth";

describe("passwords", () => {
  it("hash y verificación round-trip", async () => {
    const { hash, salt } = await hashPassword("contraseña-segura-123");
    expect(await verifyPassword("contraseña-segura-123", salt, hash)).toBe(true);
  });
  it("contraseña incorrecta falla", async () => {
    const { hash, salt } = await hashPassword("contraseña-segura-123");
    expect(await verifyPassword("otra-cosa-distinta", salt, hash)).toBe(false);
  });
  it("salts distintos por usuario", async () => {
    const a = await hashPassword("misma");
    const b = await hashPassword("misma");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});
