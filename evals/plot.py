#!/usr/bin/env python3
"""Regenerate the benchmark cards from the published, sanitized trial data."""
import csv
from pathlib import Path
from statistics import median

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import FancyBboxPatch

ROOT = Path(__file__).resolve().parent
BLUE, LIGHT_BLUE, GRAY = "#2563EB", "#60A5FA", "#64748B"
INK, MUTED, TRACK = "#09090B", "#64748B", "#F1F5F9"

# Shared publication-grade chart style, with portable Geist discovery.
for font in (Path.home() / "Library/Fonts").glob("Geist-*.ttf"):
    font_manager.fontManager.addfont(str(font))
family = "Geist" if any(f.name == "Geist" for f in font_manager.fontManager.ttflist) else "DejaVu Sans"
plt.rcParams.update({
    "font.family": family, "figure.facecolor": "white", "axes.facecolor": "white",
    "savefig.facecolor": "white", "savefig.dpi": 300, "text.color": INK,
    "svg.fonttype": "path",
})


def read(name):
    with (ROOT / name).open(newline="") as file:
        return list(csv.DictReader(file))


def panel(ax, title, subtitle, values, maximum):
    """Render the horizontal comparison bars from the original HTML cards."""
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_axis_off()
    ax.text(0, 1, title, fontsize=13, fontweight="semibold", va="top")
    ax.text(0, .88, subtitle, fontsize=10, color=MUTED, va="top")
    spacing = .60 / len(values)
    for index, (label, value, display, color) in enumerate(values):
        y = .68 - index * spacing
        ax.text(0, y, label, fontsize=10, va="center")
        ax.text(1, y, display, fontsize=10, fontweight="semibold", ha="right", va="center")
        height = .045
        bottom = y - .105
        for width, fill in [(1, TRACK), (value / maximum, color)]:
            if width:
                ax.add_patch(FancyBboxPatch(
                    (0, bottom), width, height,
                    boxstyle="round,pad=0,rounding_size=.012",
                    transform=ax.transAxes, linewidth=0, facecolor=fill,
                    mutation_aspect=2, clip_on=False,
                ))


def save(fig, name):
    for extension in ("png", "svg"):
        path = ROOT / f"{name}.{extension}"
        fig.savefig(path, dpi=300)
        if extension == "svg":
            path.write_text("\n".join(line.rstrip() for line in path.read_text().splitlines()) + "\n")
    plt.close(fig)


def header(fig, title, subtitle, note):
    fig.text(.045, .955, title, fontsize=20, fontweight="semibold", va="top")
    fig.text(.045, .89, subtitle, fontsize=11, color=MUTED, va="top")
    fig.text(.045, .045, note, fontsize=9, color=MUTED, va="bottom", linespacing=1.4)


def subtitle_chart():
    rows = read("subtitle-matcher.csv")
    variants = [
        ("baseline", "Previous matcher", GRAY),
        ("interval-single", "One pass", BLUE),
        ("interval-verified", "Focused verification", LIGHT_BLUE),
    ]
    latency, accuracy = [], []
    for key, label, color in variants:
        subset = [r for r in rows if r["variant"] == key]
        seconds = median(float(r["ms"]) for r in subset) / 1000
        scored = [r for r in subset if r["pass_strict"]]
        passed = sum(r["pass_strict"] == "True" for r in scored)
        latency.append((label, seconds, f"{seconds:.2f} s", color))
        accuracy.append((label, passed, f"{passed}/{len(scored)}", color))
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.5))
    fig.subplots_adjust(left=.045, right=.955, bottom=.15, top=.78, wspace=.20)
    header(fig, "Subtitle matcher comparison",
           "GPT-6 Luna  |  8 requests  |  3 repetitions per design",
           "Strict scores use the narrower lawyer dialogue window. Community is excluded from accuracy,\n"
           "but included in latency. Times measure matching only, not video playback.")
    panel(axes[0], "Median matching time", "Lower is better", latency, 6)
    panel(axes[1], "Strict subtitle-evidence passes", "Higher is better", accuracy, 21)
    save(fig, "subtitle-matcher")


def engine_chart():
    rows = read("engine-pairs.csv")
    simple = {"play", "open", "episode", "director", "hello", "ambiguity"}
    scenes = {"kimmel", "lawyer", "b99", "office", "saul", "severance"}
    fig, axes = plt.subplots(2, 2, figsize=(10, 6.1))
    fig.subplots_adjust(left=.045, right=.955, bottom=.13, top=.81, wspace=.20, hspace=.24)
    header(fig, "AI SDK vs fx",
           "56 live requests  |  GPT-6 Luna  |  Shared one-pass subtitle matcher",
           "Latency ends at a prepared action or final answer, not video playback.\n"
           "Community visual grounding is excluded from strict scene accuracy.")
    for index, (cases, name, maximum) in enumerate([
        (simple, "simple", 2), (scenes, "scene", 10),
    ]):
        subset = [r for r in rows if r["case"] in cases]
        passed_pairs = {(r["case"], r["run"]) for r in subset if r["pass_strict"] == "True"
                        and any(s["case"] == r["case"] and s["run"] == r["run"]
                                and s["engine"] != r["engine"] and s["pass_strict"] == "True" for s in subset)}
        latency, accuracy = [], []
        for engine, label, color in [("sdk", "AI SDK", BLUE), ("fx", "fx", LIGHT_BLUE)]:
            trial = [r for r in subset if r["engine"] == engine]
            seconds = median(float(r["ms"]) for r in trial if (r["case"], r["run"]) in passed_pairs) / 1000
            passed = sum(r["pass_strict"] == "True" for r in trial)
            latency.append((label, seconds, f"{seconds:.2f} s", color))
            accuracy.append((label, passed, f"{passed}/{len(trial)}", color))
        panel(axes[0, index], f"Successful {name} requests",
              f"Median time, {len(passed_pairs)} paired successes", latency, maximum)
        panel(axes[1, index], f"{'Strict scene' if name == 'scene' else 'Simple request'} accuracy",
              "12 trials per engine", accuracy, 12)
    save(fig, "engine-pairs")


if __name__ == "__main__":
    subtitle_chart()
    engine_chart()
