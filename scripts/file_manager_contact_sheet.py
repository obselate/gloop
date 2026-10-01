#!/usr/bin/env python3
"""Render labeled warmup captures for visual workload review."""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SCENARIOS = ("list100", "list100000", "tiles100000", "preview3png")
CELL = (600, 430)
COLORS = {"background": "#0d1117", "panel": "#161b22", "text": "#e6edf3",
          "muted": "#8b949e", "accent": "#58a6ff"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--rows", type=int, default=4)
    args = parser.parse_args()
    records = [json.loads(line) for line in args.raw.read_text().splitlines()]
    by_pair = {(record["app"], record["scenario"]): record for record in records
               if record.get("warmup")}
    apps = json.loads(args.manifest.read_text())["apps"]
    names = {app["id"]: app.get("name", app["id"]) for app in apps}
    names["gloop"] = "Gloop"
    order = list(dict.fromkeys(["gloop", *(app["id"] for app in apps)]))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype("/usr/share/fonts/TTF/DejaVuSans.ttf", 20)
    small = ImageFont.truetype("/usr/share/fonts/TTF/DejaVuSans.ttf", 15)
    for kind in ("capture", "late_capture"):
        for batch, first in enumerate(range(0, len(order), args.rows), 1):
            subset = order[first:first + args.rows]
            sheet = Image.new("RGB", (CELL[0] * len(SCENARIOS), CELL[1] * len(subset)), COLORS["background"])
            draw = ImageDraw.Draw(sheet)
            for row, app in enumerate(subset):
                for column, scenario in enumerate(SCENARIOS):
                    x, y = column * CELL[0], row * CELL[1]
                    draw.rounded_rectangle((x + 4, y + 4, x + CELL[0] - 4, y + CELL[1] - 4),
                                           radius=10, fill=COLORS["panel"])
                    record = by_pair.get((app, scenario), {})
                    title = f"{names[app]}  |  {scenario}"
                    draw.text((x + 16, y + 14), title, fill=COLORS["text"], font=font)
                    capture = record.get(kind)
                    if capture:
                        path = Path(capture["path"])
                        with Image.open(path) as source:
                            thumbnail = source.convert("RGB")
                            thumbnail.thumbnail((CELL[0] - 32, CELL[1] - 76))
                            sheet.paste(thumbnail, (x + 16 + (CELL[0] - 32 - thumbnail.width) // 2,
                                                    y + 46 + (CELL[1] - 76 - thumbnail.height) // 2))
                        elapsed = (record["late_capture_elapsed_s"] if kind == "late_capture" else
                                   record["timestamps"]["capture_reply_elapsed_s"])
                        details = f"{record.get('status')}  |  {elapsed:.1f}s"
                        draw.text((x + 16, y + CELL[1] - 25), details,
                                  fill=COLORS["muted"], font=small)
                    else:
                        draw.text((x + 16, y + 70), record.get("reason", "N/A"),
                                  fill=COLORS["accent"], font=small)
            target = args.output_dir / f"{kind}-{batch:02d}.png"
            sheet.save(target)
            print(target)


if __name__ == "__main__":
    main()
