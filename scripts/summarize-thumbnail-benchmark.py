"""Compare measured JPEG delivery times for the same sequence of preview requests."""
import json
import pathlib
import statistics
import sys


def read_samples(path):
    marker = "THUMBNAIL_BENCHMARK "
    return [json.loads(line.split(marker, 1)[1])
            for line in pathlib.Path(path).read_text().splitlines() if marker in line]


aether, mpv = map(read_samples, sys.argv[1:])
assert len(aether) == len(mpv) == 22, "Both paths must return every JPEG"
assert [(r["group"], r["target"]) for r in aether] == [(r["group"], r["target"]) for r in mpv]
assert all(r["engine"] == "aether" for r in aether)
assert all(r["engine"] == "libmpv" for r in mpv)
print("## macOS thumbnail speed comparison")
print("\nSame runner, HTTP fixture, request order, and 448 px width cap. Optimized builds.")
print("Latency: request sent to JPEG bytes available, including native image transport.")
print("The libmpv path uses Navigator's indexed keyframe preview decoder. Aether uses retained stills or its session frame extractor.")
print("The playing decoder is paused in both tests. Browser, network WAN, and rendering latency are excluded.")
print("\n| Group | Samples per engine | Aether median (ms) | libmpv median (ms) | Aether range (ms) | libmpv range (ms) |")
print("| --- | ---: | ---: | ---: | ---: | ---: |")
for group in ("first-distant", "resident", "distant", "revisit"):
    a = [r["ms"] for r in aether if r["group"] == group]
    m = [r["ms"] for r in mpv if r["group"] == group]
    print(f"| {group} | {len(a)} | {statistics.median(a):.2f} | {statistics.median(m):.2f} | {min(a):.2f}–{max(a):.2f} | {min(m):.2f}–{max(m):.2f} |")
print("\n| Group | Target (s) | Aether (ms) | Aether path | libmpv (ms) |")
print("| --- | ---: | ---: | --- | ---: |")
for a, m in zip(aether, mpv):
    print(f'| {a["group"]} | {a["target"]:g} | {a["ms"]:.2f} | {a["path"]} | {m["ms"]:.2f} |')
