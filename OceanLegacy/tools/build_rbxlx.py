#!/usr/bin/env python3
"""src/ 폴더의 Luau 스크립트를 Roblox Studio에서 바로 열 수 있는 .rbxlx 파일로 묶습니다.

규칙 (Rojo와 동일):
  *.server.lua -> Script, *.client.lua -> LocalScript, *.lua -> ModuleScript, 폴더 -> Folder
"""
import os
import sys
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
OUT = os.path.join(ROOT, "dist", "OceanLegacy.rbxlx")

counter = 0


def ref():
    global counter
    counter += 1
    return f"RBX{counter:08X}"


def cdata(text):
    return "<![CDATA[" + text.replace("]]>", "]]]]><![CDATA[>") + "]]>"


def item(cls, name, children="", source=None):
    props = f'<string name="Name">{escape(name)}</string>'
    if source is not None:
        props += f'<ProtectedString name="Source">{cdata(source)}</ProtectedString>'
    return f'<Item class="{cls}" referent="{ref()}"><Properties>{props}</Properties>{children}</Item>\n'


def script_item(path):
    fname = os.path.basename(path)
    with open(path, encoding="utf-8") as f:
        source = f.read()
    for suffix, cls in ((".server.lua", "Script"), (".client.lua", "LocalScript"), (".lua", "ModuleScript")):
        if fname.endswith(suffix):
            return item(cls, fname[: -len(suffix)], source=source)
    return ""


def children_of(directory):
    out = ""
    for entry in sorted(os.listdir(directory)):
        full = os.path.join(directory, entry)
        if os.path.isdir(full):
            out += item("Folder", entry, children_of(full))
        elif entry.endswith(".lua"):
            out += script_item(full)
    return out


def main():
    body = ""
    body += item("Workspace", "Workspace")
    body += item("Lighting", "Lighting")
    body += item("ReplicatedStorage", "ReplicatedStorage", item("Folder", "Shared", children_of(os.path.join(SRC, "ReplicatedStorage", "Shared"))))
    body += item("ServerScriptService", "ServerScriptService", children_of(os.path.join(SRC, "ServerScriptService")))
    body += item(
        "StarterPlayer",
        "StarterPlayer",
        item("StarterPlayerScripts", "StarterPlayerScripts", children_of(os.path.join(SRC, "StarterPlayer", "StarterPlayerScripts"))),
    )
    xml = '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" version="4">\n' + body + "</roblox>\n"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(xml)
    print("빌드 완료:", os.path.relpath(OUT, ROOT))


if __name__ == "__main__":
    sys.exit(main())
