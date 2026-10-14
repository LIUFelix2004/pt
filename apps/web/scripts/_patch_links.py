
from pathlib import Path
import re

# --- live-index ---
p = Path(r"D:\Lauchpad\apps\web\app\live-index.tsx")
t = p.read_text(encoding="utf-8")
t2, n = re.subn(
    r"<Link\n(\s*)key=\{l\.token\}\n\1href=\{`/launch/\$\{l\.token\}`\}",
    r"<a\n\1key={l.token}\n\1href={`/launch/${l.token}/`}",
    t,
    count=1,
)
if n != 1:
    raise SystemExit(f"live-index open replace failed: {n}")
t2, n = re.subn(
    r"(ratio\.toFixed\(1\)%\{ratio > 100 \? ` · \$\{t\(\"oversubscribed\"\)\}` : \"\"\}\n\s*</p>\n\s*)</Link>",
    r"\1</a>",
    t2,
    count=1,
)
if n != 1:
    # fallback: replace last </Link> before map end
    idx = t2.rfind("</Link>")
    if idx < 0:
        raise SystemExit("no Link close")
    t2 = t2[:idx] + "</a>" + t2[idx+7:]
    print("live-index used fallback close replace")
else:
    print("live-index close ok")
if 'Link' not in re.sub(r'import Link from "next/link";\n?', '', t2):
    t2 = re.sub(r'import Link from "next/link";\n?', '', t2)
    print("removed unused Link import")
p.write_text(t2, encoding="utf-8")
print("live-index done")

# --- create form ---
p = Path(r"D:\Lauchpad\apps\web\app\create\create-launch-form.tsx")
t = p.read_text(encoding="utf-8")
t2 = t.replace("href={`/launch/${created}`}", "href={`/launch/${created}/`}")
t2 = t2.replace(">/launch/{created}<", ">/launch/{created}/<")
# convert Link to a for this one occurrence if present
t2 = re.sub(
    r'<Link href=\{`/launch/\$\{created\}/`\}([^>]*)>',
    r'<a href={`/launch/${created}/`}\1>',
    t2,
    count=1,
)
# If we changed opening Link to a, fix the next </Link> after created
if "<a href={`/launch/${created}/`}" in t2 and t != t2:
    # find that anchor and its closing tag within ~400 chars
    m = re.search(r"<a href=\{`/launch/\$\{created\}/`\}[\s\S]{0,400}?</Link>", t2)
    if m:
        t2 = t2[:m.start()] + m.group(0).replace("</Link>", "</a>") + t2[m.end():]
        print("create form Link->a")
p.write_text(t2, encoding="utf-8")
print("create form done", t != t2)

# --- flywheel ---
p = Path(r"D:\Lauchpad\apps\web\app\flywheel\page.tsx")
t = p.read_text(encoding="utf-8")
t2 = t.replace("href={`/launch/${n.token}`}", "href={`/launch/${n.token}/`}")
p.write_text(t2, encoding="utf-8")
print("flywheel done", t != t2)
