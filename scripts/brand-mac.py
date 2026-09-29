"""Marca do app do Mac, como o electron-packager faz.

Executável "Agzos Browser", helpers "Agzos Browser Helper (GPU|Renderer|Plugin)" e ícone
agzos.icns. O Electron procura os helpers como "<CFBundleName> Helper" quando não acha os
"Electron Helper". Uso: python3 scripts/brand-mac.py "<Agzos Browser.app>"
"""

import glob
import os
import plistlib
import sys

NAME = "Agzos Browser"
BUNDLE_ID = "br.agzos.browser"


def edit(path, **values):
    with open(path, "rb") as f:
        data = plistlib.load(f)
    data.update(values)
    with open(path, "wb") as f:
        plistlib.dump(data, f)


def main(app):
    macos = os.path.join(app, "Contents", "MacOS")
    os.rename(os.path.join(macos, "Electron"), os.path.join(macos, NAME))
    edit(
        os.path.join(app, "Contents", "Info.plist"),
        CFBundleName=NAME,
        CFBundleDisplayName=NAME,
        CFBundleIdentifier=BUNDLE_ID,
        CFBundleExecutable=NAME,
        CFBundleIconFile="agzos.icns",
    )
    frameworks = os.path.join(app, "Contents", "Frameworks")
    helpers = glob.glob(os.path.join(frameworks, "Electron Helper*.app"))
    if not helpers:
        sys.exit("helpers do Electron não encontrados")
    for helper in helpers:
        old = os.path.basename(helper)[: -len(".app")]
        new = NAME + old[len("Electron") :]
        suffix = old[len("Electron Helper") :].strip(" ()")
        os.rename(
            os.path.join(helper, "Contents", "MacOS", old),
            os.path.join(helper, "Contents", "MacOS", new),
        )
        # Sem CFBundleExecutable o rcodesign assina o helper como Mach-O avulso e o
        # Gatekeeper acusa "danificado".
        edit(
            os.path.join(helper, "Contents", "Info.plist"),
            CFBundleName=new,
            CFBundleDisplayName=new,
            CFBundleExecutable=new,
            CFBundleIdentifier=f"{BUNDLE_ID}.helper" + (f".{suffix}" if suffix else ""),
        )
        os.rename(helper, os.path.join(frameworks, new + ".app"))
        print(f"{old} -> {new}")


if __name__ == "__main__":
    main(sys.argv[1])
