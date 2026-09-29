// Marca do executável do Windows: nome e ícone do Agzos no lugar dos do Electron.
// O Gerenciador de Tarefas mostra a "Descrição do arquivo" (FileDescription) do .exe;
// todos os processos (janela, abas, GPU) usam o mesmo .exe, então todos passam a
// aparecer como "Agzos Browser". Roda no Linux (resedit é JS puro, sem wine).
//
// Uso: node scripts/brand-win.mjs <AgzosBrowser.exe> <icon.ico> <versão>
import fs from "node:fs";

import * as PELibrary from "pe-library";
import * as ResEdit from "resedit";

const [exePath, iconPath, version] = process.argv.slice(2);
if (!exePath || !iconPath || !/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Uso: node scripts/brand-win.mjs <exe> <icon.ico> <x.y.z>");
  process.exit(2);
}

const NAME = "Agzos Browser";
const exe = PELibrary.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = PELibrary.NtExecutableResource.from(exe);

// Ícone: troca todos os grupos de ícone existentes (o principal é o 1º).
const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const targets = groups.length ? groups : [{ id: 1, lang: 1033 }];
for (const group of targets) {
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    group.id,
    group.lang,
    iconFile.icons.map((item) => item.data),
  );
}

// Informações de versão (Propriedades > Detalhes e Gerenciador de Tarefas).
const infos = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
const info = infos[0] ?? ResEdit.Resource.VersionInfo.createEmpty();
const [major, minor, patch] = version.split(".").map(Number);
info.setFileVersion(major, minor, patch, 0, 1033);
info.setProductVersion(major, minor, patch, 0, 1033);
const languages = info.getAllLanguagesForStringValues();
for (const language of languages.length ? languages : [{ lang: 1033, codepage: 1200 }]) {
  info.setStringValues(language, {
    FileDescription: NAME,
    ProductName: NAME,
    CompanyName: "Agzos",
    LegalCopyright: `© ${new Date().getFullYear()} Agzos`,
    InternalName: "AgzosBrowser",
    OriginalFilename: "AgzosBrowser.exe",
    FileVersion: version,
    ProductVersion: version,
  });
}
info.outputToResourceEntries(res.entries);

res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log(`${exePath}: "${NAME}" ${version}, ícone trocado`);
