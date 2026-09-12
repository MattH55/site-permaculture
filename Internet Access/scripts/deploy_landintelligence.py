"""Deploy internet-access/ plus root robots.txt and sitemap.xml.

Does not overwrite landintelligence.online/internet.html except when
--with-internet-html is passed (adds a link to the new map only).
"""

from __future__ import annotations

import argparse
import ftplib
from pathlib import Path

FTP_HOST = "ftp.prosperapolarplunge.com"
FTP_USER = "DeLeeuw@landintelligence.online"
FTP_PASS = "H9RaINY9m&(iF8FT"
FTP_PORT = 21

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
LI = (
    ROOT.parent
    / "Expanding Edge"
    / "Expanding Edge Website"
    / "public"
    / "land-intelligence"
)

SKIP_NAMES = {".DS_Store"}


def ensure_dir(ftp: ftplib.FTP, path: str) -> None:
    parts = [p for p in path.replace("\\", "/").split("/") if p]
    cwd = ""
    for part in parts:
        cwd = f"{cwd}/{part}" if cwd else part
        try:
            ftp.mkd(cwd)
        except Exception:
            pass


def upload(ftp: ftplib.FTP, local: Path, remote: str) -> None:
    remote = remote.replace("\\", "/")
    parent = "/".join(remote.split("/")[:-1])
    if parent:
        ensure_dir(ftp, parent)
    with local.open("rb") as fh:
        ftp.storbinary(f"STOR {remote}", fh)
    print(f"Uploaded {local} -> {remote} ({local.stat().st_size} bytes)")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--with-internet-html", action="store_true")
    args = parser.parse_args()

    ftp = ftplib.FTP()
    ftp.connect(FTP_HOST, FTP_PORT, timeout=120)
    ftp.login(FTP_USER, FTP_PASS)
    ftp.set_pasv(True)
    print(f"Connected to {FTP_HOST}")
    ftp.cwd("/")

    upload(ftp, LI / "robots.txt", "robots.txt")
    upload(ftp, LI / "sitemap.xml", "sitemap.xml")

    if args.with_internet_html:
        upload(ftp, LI / "internet.html", "internet.html")

    for path in PUBLIC.rglob("*"):
        if not path.is_file() or path.name in SKIP_NAMES:
            continue
        rel = path.relative_to(PUBLIC).as_posix()
        upload(ftp, path, f"internet-access/{rel}")

    ftp.quit()
    print("Deploy complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
