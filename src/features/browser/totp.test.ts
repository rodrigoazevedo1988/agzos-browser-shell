import { describe, expect, it } from "vitest";

import { generateTotp, isValidTotpSecret, normalizeTotpSecret, secondsRemaining } from "./totp";

// Segredo dos vetores da RFC 6238 (SHA-1): ASCII "12345678901234567890" em Base32.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTP (RFC 6238)", () => {
  it("gera o código de 6 dígitos dos vetores da RFC em T=59s", async () => {
    const code = await generateTotp(RFC_SECRET, { now: 59_000, digits: 6 });
    expect(code).toBe("287082");
  });

  it("acompanha os vetores em 1111111109s e 1234567890s", async () => {
    expect(await generateTotp(RFC_SECRET, { now: 1_111_111_109_000, digits: 6 })).toBe("081804");
    expect(await generateTotp(RFC_SECRET, { now: 1_234_567_890_000, digits: 6 })).toBe("005924");
  });

  it("mantém o mesmo código dentro da mesma janela de 30s", async () => {
    const a = await generateTotp(RFC_SECRET, { now: 60_000 });
    const b = await generateTotp(RFC_SECRET, { now: 89_000 });
    const c = await generateTotp(RFC_SECRET, { now: 90_000 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("extrai o segredo de uma URI otpauth://", () => {
    const uri = "otpauth://totp/Agzos:eu@exemplo.com?secret=JBSWY3DPEHPK3PXP&issuer=Agzos";
    expect(normalizeTotpSecret(uri)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("normaliza Base32 com espaços e padding", () => {
    expect(normalizeTotpSecret("jbsw y3dp ehpk 3pxp")).toBe("JBSWY3DPEHPK3PXP");
    expect(normalizeTotpSecret("JBSWY3DPEHPK3PXP====")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("valida segredos Base32 e rejeita lixo", () => {
    expect(isValidTotpSecret("JBSWY3DPEHPK3PXP")).toBe(true);
    expect(isValidTotpSecret("")).toBe(false);
    expect(isValidTotpSecret("tem 1 e 8 inválidos: 18")).toBe(false);
  });

  it("devolve string vazia para segredo inválido em vez de lançar", async () => {
    expect(await generateTotp("")).toBe("");
    expect(await generateTotp("não-é-base32-!!!")).toBe("");
  });

  it("conta os segundos restantes da janela", () => {
    expect(secondsRemaining({ now: 0 })).toBe(30);
    expect(secondsRemaining({ now: 10_000 })).toBe(20);
    expect(secondsRemaining({ now: 29_000 })).toBe(1);
  });
});
