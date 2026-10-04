import zlib from "node:zlib";

// Pacotes de teste da Chrome Web Store (zip mínimo e CRX3), usados pelos testes 4.5 e 4.6.1.

/** Zip mínimo (sem CRC, que o leitor não confere) para os testes do .crx. */
export function makeZip(files: { name: string; data: Buffer }[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const compressed = zlib.deflateRawSync(file.data);
    const name = Buffer.from(file.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += 30 + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** Comprimento protobuf (varint). */
function varint(value: number) {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  bytes.push(rest);
  return Buffer.from(bytes);
}

/**
 * CRX3: "Cr24", versão 3, tamanho do cabeçalho protobuf (uma prova sha256_with_rsa por
 * chave pública, como a loja manda: a do autor e a do Google) e o zip.
 */
export function makeCrx(zip: Buffer, ...publicKeys: Buffer[]) {
  const proofs = publicKeys.map((publicKey) => {
    const keyField = Buffer.concat([Buffer.from([0x0a]), varint(publicKey.length), publicKey]);
    return Buffer.concat([Buffer.from([0x12]), varint(keyField.length), keyField]);
  });
  const header = Buffer.concat(proofs);
  const head = Buffer.alloc(12);
  head.write("Cr24", 0, "latin1");
  head.writeUInt32LE(3, 4);
  head.writeUInt32LE(header.length, 8);
  return Buffer.concat([head, header, zip]);
}
