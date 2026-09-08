#!/usr/bin/env python3
"""Build the animation theme catalog from icons/Ani/<theme>/<state>/*.webp."""

import argparse
import hashlib
import json
import re
from pathlib import Path


DEFAULT_ROOT = Path(__file__).resolve().parents[1] / "icons" / "Ani"
DEFAULT_KEYWORDS = Path(__file__).resolve().parents[1] / "shared" / "animation-keywords.json"
STATE_ALIASES = {
    "idle": "idle",
    "comment": "comment",
    "newpost": "newpost",
    "newport": "newpost",
    "post": "post",
    "menu": "menu",
    "loading": "loading",
}

REPEAT_SUFFIX = re.compile(r"\s+-\s*(\d+)$")


def webp_duration_ms(path):
    """Return one animation cycle in milliseconds using the WebP RIFF chunks."""
    data = path.read_bytes()
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return 2400
    position = 12
    duration = 0
    while position + 8 <= len(data):
        size = int.from_bytes(data[position + 4:position + 8], "little")
        body = data[position + 8:position + 8 + size]
        if data[position:position + 4] == b"ANMF" and len(body) >= 15:
            duration += int.from_bytes(body[12:15], "little")
        position += 8 + size + (size & 1)
    return min(60000, max(250, duration or 2400))


def animation_asset(path, animation_root):
    match = REPEAT_SUFFIX.search(path.stem)
    return {
        "path": str(path.relative_to(animation_root)).replace("\\", "/"),
        "durationMs": webp_duration_ms(path),
        "maxPlays": min(20, max(1, int(match.group(1)))) if match else 1,
    }


def load_keyword_rules(path):
    if not path.is_file():
        return []
    values = json.loads(path.read_text(encoding="utf-8"))
    rules = []
    for state, value in values.items():
        if not re.fullmatch(r"[a-z][a-z0-9_-]{0,39}", state):
            continue
        keywords = value if isinstance(value, list) else value.get("keywords", []) if isinstance(value, dict) else []
        if not isinstance(keywords, list):
            continue
        rule = {"state": state, "keywords": [str(keyword) for keyword in keywords if str(keyword)]}
        if isinstance(value, dict) and value.get("exclusive") is True:
            rule["exclusive"] = True
        rules.append(rule)
    return rules


def build_catalog(animation_root, keyword_rules):
    themes = []
    if not animation_root.is_dir():
        return {"version": 4, "keywordRules": keyword_rules, "themes": themes}

    state_names = ["idle", "comment", "newpost", "post", "menu", "loading"]
    state_names.extend(rule["state"] for rule in keyword_rules if rule["state"] not in state_names)

    for theme_dir in sorted(animation_root.iterdir(), key=lambda path: path.name.casefold()):
        if not theme_dir.is_dir() or theme_dir.name.startswith("."):
            continue
        states = {name: [] for name in state_names}
        for state_dir in theme_dir.iterdir():
            if not state_dir.is_dir():
                continue
            state = STATE_ALIASES.get(state_dir.name.casefold(), state_dir.name.casefold())
            if state not in states:
                continue
            states[state].extend(
                animation_asset(path, animation_root)
                for path in sorted(state_dir.glob("*.webp"), key=lambda path: path.name.casefold())
                if path.is_file()
            )
        if states["idle"]:
            themes.append({"id": theme_dir.name, "name": theme_dir.name, "states": states})
    return {"version": 4, "keywordRules": keyword_rules, "themes": themes}


def package_assets(catalog, source_root, package_root):
    """Use ASCII bundle paths while preserving theme IDs and source metadata."""
    if source_root.resolve() == package_root.resolve():
        raise ValueError("Package destination must differ from the source")
    for theme in catalog["themes"]:
        for assets in theme["states"].values():
            for asset in assets:
                source = source_root / asset["path"]
                name = hashlib.sha256(asset["path"].encode("utf-8")).hexdigest() + ".webp"
                relative = "assets/" + name
                destination = package_root / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(source.read_bytes())
                asset["path"] = relative


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--keywords", type=Path, default=DEFAULT_KEYWORDS)
    parser.add_argument("--package-root", type=Path)
    args = parser.parse_args()
    output = args.output or args.root / "catalog.json"
    catalog = build_catalog(args.root, load_keyword_rules(args.keywords))
    if args.package_root:
        package_assets(catalog, args.root, args.package_root)
        output = args.output or args.package_root / "catalog.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Generated {output} ({len(catalog['themes'])} themes)")
