#!/usr/bin/env python3
"""
Prepare grant-eligibility tool from the user's files and deploy to DreamHost
expandingedge.ca web root at /grant-eligibility/.
"""
from __future__ import annotations

import os
import re
import shutil
import stat
import sys
from pathlib import Path

import paramiko

HERE = Path(__file__).resolve().parent
EE_PUBLIC = (
    HERE.parent
    / "Expanding Edge"
    / "Expanding Edge Website"
    / "expandingedge.ca"
    / "public"
)
SRC_HTML = EE_PUBLIC / "resources" / "tools" / "grant-eligibility" / "index.html"
SRC_JSON = EE_PUBLIC / "data" / "grants.json"

HOST = "iad1-shared-b7-34.dreamhost.com"
USER = "dh_mtec2p"
PASS = "q1?pk2iiK&"
PORT = 22
HOME_BASE = f"/home/{USER}"
REMOTE_DIR = "grant-eligibility"

CHROME_CSS = """
  <style id="gq-chrome">
    body { margin:0; font-family: Inter, system-ui, sans-serif; background:#F1ECDC; color:#20261D; }
    .gq-site-header { border-bottom:1px solid rgba(32,38,29,0.16); background:#F1ECDC; position:sticky; top:0; z-index:20; }
    .gq-site-inner { max-width:920px; margin:0 auto; padding:0.85rem 1.25rem; display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap; }
    .gq-brand { font-family: Fraunces, Georgia, serif; font-weight:600; color:#20261D; text-decoration:none; }
    .gq-nav { display:flex; gap:1rem; flex-wrap:wrap; }
    .gq-nav a { color:#4B5245; text-decoration:none; font-size:0.95rem; }
    .gq-nav a:hover { color:#2F6B68; }
    .page-header { padding:2rem 1.25rem 0.5rem; }
    .page-header .inner { max-width:920px; margin:0 auto; }
    .page-header h1 { font-family: Fraunces, Georgia, serif; font-size:clamp(1.6rem,3vw,2.1rem); margin:0.35rem 0 0.5rem; }
    .page-header .lead { color:#4B5245; max-width:40rem; line-height:1.55; }
    .section-eyebrow, .mono { font-family: IBM Plex Mono, monospace; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:#2F6B68; }
    .container { max-width:920px; margin:0 auto; padding:0 1.25rem 3rem; }
    .content-section { margin-top:1rem; }
    .breadcrumb-inline { font-size:0.9rem; color:#4B5245; margin-bottom:1rem; }
    .breadcrumb-inline a { color:#2F6B68; }
    .gq-disclaimer { font-size:0.9rem; color:#4B5245; line-height:1.5; margin-bottom:1.25rem; }
    .gq-footer { border-top:1px solid rgba(32,38,29,0.16); padding:1.5rem 0 2rem; margin-top:2rem; font-size:0.9rem; color:#4B5245; }
    .gq-footer a { color:#2F6B68; }
    .gq-fine { font-size:0.8rem; opacity:0.85; }
    .btn-primary { display:inline-block; padding:0.7rem 1.2rem; background:#33473A; color:#F1ECDC; text-decoration:none; border-radius:2px; margin:0.25rem 0.5rem 0.25rem 0; }
    .btn-secondary { display:inline-block; padding:0.7rem 1.2rem; border:1.5px solid #20261D; color:#20261D; text-decoration:none; border-radius:2px; margin:0.25rem 0.5rem 0.25rem 0; }
    .link-arrow { color:#2F6B68; }
  </style>
"""

SIMPLE_HEADER = """
  <header class="gq-site-header">
    <div class="gq-site-inner">
      <a class="gq-brand" href="https://www.expandingedge.ca/">Expanding Edge Permaculture</a>
      <nav class="gq-nav" aria-label="Primary">
        <a href="https://www.expandingedge.ca/services-landing">Services</a>
        <a href="https://www.expandingedge.ca/tools">Tools</a>
        <a href="https://www.expandingedge.ca/contact">Contact</a>
      </nav>
    </div>
  </header>
"""

SIMPLE_FOOTER = """
  <footer class="gq-footer">
    <div class="gq-site-inner" style="flex-direction:column;align-items:flex-start;">
      <p><strong>Expanding Edge Permaculture</strong> · Landowner funding match tool</p>
      <p><a href="https://www.expandingedge.ca/tools">All tools</a> ·
         <a href="https://www.expandingedge.ca/contact">Contact</a> ·
         <a href="tel:7802363630">(780) 236-3630</a> ·
         <a href="mailto:info@expandingedge.ca">info@expandingedge.ca</a></p>
      <p class="gq-fine">Not tax or legal advice. Programs change; verify with the delivery agency.</p>
    </div>
  </footer>
"""


def prepare() -> tuple[Path, Path]:
    if not SRC_HTML.exists():
        raise SystemExit(f"Missing HTML: {SRC_HTML}")
    if not SRC_JSON.exists():
        raise SystemExit(f"Missing JSON: {SRC_JSON}")

    public = HERE / "public"
    public.mkdir(parents=True, exist_ok=True)
    (HERE / "data").mkdir(parents=True, exist_ok=True)

    html = SRC_HTML.read_text(encoding="utf-8")
    html = html.replace("https://makealbertagreatagain.live", "https://www.expandingedge.ca")
    html = html.replace("makealbertagreatagain.live", "www.expandingedge.ca")
    html = html.replace("/resources/tools/grant-eligibility/", "/grant-eligibility/")
    html = html.replace("/resources/tools/grant-eligibility", "/grant-eligibility/")

    html = html.replace('<link rel="stylesheet" href="/styles.css">', "")
    html = html.replace('<script src="/app.js"></script>', "")

    html = re.sub(r"<header class=\"site-header\">[\s\S]*?</header>", SIMPLE_HEADER, html, count=1)
    html = re.sub(r"<footer class=\"site-footer\">[\s\S]*?</footer>", SIMPLE_FOOTER, html, count=1)

    html = html.replace(
        '<a href="/">Home</a> / <a href="/resources/">Resources</a> / Grant eligibility',
        '<a href="https://www.expandingedge.ca/">Home</a> / <a href="https://www.expandingedge.ca/tools">Tools</a> / Grant eligibility',
    )
    html = html.replace('href="/data/grants.json"', 'href="grants.json"')
    html = html.replace('href="/contact/?interest=funding"', 'href="https://www.expandingedge.ca/contact"')
    html = html.replace('href="/design/"', 'href="https://www.expandingedge.ca/services-landing"')
    html = html.replace('href="/resources/"', 'href="https://www.expandingedge.ca/tools"')
    html = html.replace('href="/resources/tools/budget-builder/"', 'href="https://www.expandingedge.ca/tools"')
    html = html.replace('href="/resources/tools/swale-calculator/"', 'href="https://www.expandingedge.ca/tools"')
    html = html.replace('href="/courses/"', 'href="https://www.expandingedge.ca/tools"')
    html = html.replace("Full Site Design Tool", "Services")
    html = html.replace("All Resources", "All tools")
    html = re.sub(r'<img src="/images/logo.png"[^>]*>', "", html)

    if 'id="gq-chrome"' not in html:
        html = html.replace(
            "</style>\n  <script type=\"application/ld+json\">",
            "</style>\n" + CHROME_CSS + "\n  <script type=\"application/ld+json\">",
            1,
        )

    # Full Organization schema (canonical EE)
    if "expandingedge.ca/#organization" not in html:
        pass  # already has compact org schema

    out_html = public / "index.html"
    out_json = public / "grants.json"
    out_html.write_text(html, encoding="utf-8")
    shutil.copy2(SRC_JSON, out_json)
    shutil.copy2(SRC_JSON, HERE / "data" / "grants.json")

    print(f"Prepared {out_html} ({out_html.stat().st_size} bytes)")
    print(f"Prepared {out_json} ({out_json.stat().st_size} bytes)")
    return out_html, out_json


def deploy(files: list[tuple[Path, str]]) -> None:
    print(f"Connecting to {USER}@{HOST}:{PORT} ...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        HOST, port=PORT, username=USER, password=PASS, timeout=30,
        allow_agent=False, look_for_keys=False,
    )
    sftp = client.open_sftp()

    remote_root = None
    for cand in ("expandingedge.ca", "public_html", "www", ""):
        path = f"{HOME_BASE}/{cand}" if cand else HOME_BASE
        try:
            sftp.stat(path)
            remote_root = path
            break
        except FileNotFoundError:
            continue
    if not remote_root:
        raise SystemExit("No web root found")
    print("Web root:", remote_root)

    remote_dir = f"{remote_root}/{REMOTE_DIR}"
    try:
        sftp.stat(remote_dir)
    except FileNotFoundError:
        sftp.mkdir(remote_dir)
        print("mkdir", remote_dir)

    for local, name in files:
        remote = f"{remote_dir}/{name}"
        sftp.put(str(local), remote)
        print("uploaded", remote, sftp.stat(remote).st_size)

    # Ensure /grant-eligibility/ serves index
    # Already DirectoryIndex index.html on site

    sftp.close()
    client.close()
    print("Deploy complete → https://www.expandingedge.ca/grant-eligibility/")


def main() -> None:
    html, js = prepare()
    deploy([(html, "index.html"), (js, "grants.json")])


if __name__ == "__main__":
    main()
