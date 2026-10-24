#!/usr/bin/env python3
"""Rebuild the single participant skill archive and rollout checksum."""
from pathlib import Path
import gzip, hashlib, io, re, tarfile
repo = Path(__file__).resolve().parent.parent
root = repo / "plugin/skills/hack-os"
buf = io.BytesIO()
with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
    with tarfile.open(fileobj=gz, mode="w") as archive:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                data = path.read_bytes()
                entry = tarfile.TarInfo("hack-os/" + path.relative_to(root).as_posix())
                entry.size, entry.mode, entry.mtime = len(data), 0o644, 0
                archive.addfile(entry, io.BytesIO(data))
output = repo / "public/hack-os-skills-1.2.0.tgz"
output.write_bytes(buf.getvalue())
sha = hashlib.sha256(output.read_bytes()).hexdigest()
release = repo / "docs/hack-os/release"
(release / "SHA256SUMS").write_text(sha + "  public/hack-os-skills-1.2.0.tgz\n")
patch = release / "installer-hack-os.patch"
patch.write_text(re.sub(r'(?m)^\+SKILLS_SHA256="[a-f0-9]+"', '+SKILLS_SHA256="' + sha + '"', patch.read_text()))
print(sha + "  " + str(output))
