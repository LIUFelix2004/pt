
import winreg
from pathlib import Path
out = []
for root, path in [
    (winreg.HKEY_CURRENT_USER, r"Environment"),
    (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
]:
    try:
        key = winreg.OpenKey(root, path)
    except FileNotFoundError:
        out.append("missing " + path)
        continue
    i = 0
    while True:
        try:
            name, val, typ = winreg.EnumValue(key, i)
            i += 1
        except OSError:
            break
        nu = name.upper()
        if "CLOUD" in nu or "CF_" in nu or "WRANGLER" in nu or ("TOKEN" in nu and ("CF" in nu or "CLOUD" in nu or "API" in nu)):
            out.append("reg %s %s len=%s typ=%s" % (path, name, len(str(val)), typ))

for p in Path(r"D:/Lauchpad").glob(".env*"):
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        u = line.upper()
        if "CLOUDFLARE" in u or "CF_API" in u:
            out.append("%s key=%s" % (p.name, line.split("=", 1)[0]))

roots = [
    Path(r"D:/Lauchpad/scripts"),
    Path(r"D:/Lauchpad/apps/web/scripts"),
    Path(r"C:/Users/Administrator/agent-tools"),
]
for root in roots:
    if not root.exists():
        continue
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if p.stat().st_size > 300000:
            continue
        if p.suffix.lower() not in {".ps1", ".py", ".txt", ".log", ".md", ".json", ".cmd", ".bat", ".env"}:
            continue
        try:
            t = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        if "CLOUDFLARE_API_TOKEN" in t:
            out.append("hit " + str(p))

Path(r"D:/Lauchpad/_cf_auth_probe2.txt").write_text("\n".join(out), encoding="utf-8")
print("lines", len(out))
