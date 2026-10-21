// Foto de perfil da Conta Agzos: regras puras (tipo pelos bytes, tamanho). A imagem chega
// já recortada e reduzida pelo app (256 × 256 PNG, bem abaixo do limite); o servidor
// confere o conteúdo de novo e não confia no Content-Type.

export const AVATAR_MAX_BYTES = 512 * 1024;
export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];

/** Tipo real da imagem pelos primeiros bytes (assinatura), ou null se não for PNG/JPEG/WebP. */
export function avatarTypeOf(bytes: Uint8Array): AvatarType | null {
  const at = (index: number, expected: number[]) =>
    expected.every((byte, offset) => bytes[index + offset] === byte);
  const ascii = (index: number, text: string) =>
    at(
      index,
      [...text].map((char) => char.charCodeAt(0)),
    );
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return null;
}

/** Tipo aceito no envio: o declarado precisa bater com o conteúdo. */
export function avatarUploadProblem(
  declared: string | null,
  bytes: Uint8Array,
): { code: string; message: string } | null {
  const type = (declared ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!(AVATAR_TYPES as readonly string[]).includes(type)) {
    return { code: "bad_type", message: "Use uma imagem PNG, JPEG ou WebP." };
  }
  if (bytes.byteLength === 0) {
    return { code: "bad_request", message: "Requisição inválida." };
  }
  if (bytes.byteLength > AVATAR_MAX_BYTES) {
    return { code: "too_large", message: "A foto passa de 512 KB." };
  }
  if (avatarTypeOf(bytes) !== type) {
    return { code: "bad_image", message: "O arquivo não é uma imagem PNG, JPEG ou WebP válida." };
  }
  return null;
}
