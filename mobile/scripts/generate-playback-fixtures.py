#!/usr/bin/env python3
"""Create or verify the small, offline playback lab fixtures.

All pixels and audio are synthetic FFmpeg filter output. Encoding tools can
change bytes across versions; verify the media contract rather than hashes.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1] / "assets" / "playback"
DURATION = 14
CHAPTERS = [(0, 4, "Start"), (4, 9, "Middle"), (9, 14, "End")]
FIXTURES = {
    "mp4-avc.mp4": ("mp4", "h264", "aac"),
    "mkv-avc.mkv": ("matroska", "h264", "aac"),
    "webm-vp9.webm": ("webm", "vp9", "opus"),
    "mp4-hevc.mp4": ("mp4", "hevc", "aac"),
    "mp4-chapters.mp4": ("mp4", "h264", "aac"),
}


def ffmpeg(*args):
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", *map(str, args)],
        check=True,
    )


def generate():
    # Encode all files in a private temporary directory first. A failed encoder
    # must not overwrite the existing, valid fixture set.
    with tempfile.TemporaryDirectory(prefix="navigator-mobile-media-") as directory:
        folder = Path(directory)
        sources = [
            "-f", "lavfi", "-i", f"testsrc2=size=256x144:rate=12:duration={DURATION}",
            "-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:duration={DURATION}",
            "-map", "0:v:0", "-map", "1:a:0",
            "-pix_fmt", "yuv420p", "-g", "12",
        ]
        ffmpeg(*sources, "-c:v", "libx264", "-threads", "1", "-preset", "fast",
               "-profile:v", "baseline", "-crf", "32", "-c:a", "aac", "-b:a", "32k",
               "-movflags", "+faststart", folder / "mp4-avc.mp4")
        ffmpeg("-i", folder / "mp4-avc.mp4", "-map", "0", "-c", "copy",
               folder / "mkv-avc.mkv")
        ffmpeg(*sources, "-c:v", "libvpx-vp9", "-threads", "1", "-b:v", "0",
               "-crf", "38", "-c:a", "libopus", "-b:a", "32k", folder / "webm-vp9.webm")
        ffmpeg(*sources, "-c:v", "libx265", "-threads", "1", "-preset", "fast",
               "-x265-params", "pools=none:frame-threads=1:log-level=error",
               "-crf", "32", "-tag:v", "hvc1", "-c:a", "aac", "-b:a", "32k",
               "-movflags", "+faststart", folder / "mp4-hevc.mp4")
        metadata = folder / "chapters.ffmeta"
        metadata.write_text(";FFMETADATA1\n" + "".join(
            f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={start * 1000}\nEND={end * 1000}\ntitle={title}\n"
            for start, end, title in CHAPTERS
        ))
        ffmpeg("-i", folder / "mp4-avc.mp4", "-f", "ffmetadata", "-i", metadata,
               "-map", "0", "-map_chapters", "1", "-c", "copy", "-movflags", "+faststart",
               folder / "mp4-chapters.mp4")
        verify(folder)
        ROOT.mkdir(parents=True, exist_ok=True)
        for filename in FIXTURES:
            shutil.copyfile(folder / filename, ROOT / filename)


def verify(folder):
    for filename, (container, video, audio) in FIXTURES.items():
        path = folder / filename
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_format", "-show_streams",
             "-show_chapters", "-of", "json", str(path)],
            check=True, text=True, capture_output=True,
        )
        info = json.loads(result.stdout)
        streams = {stream["codec_type"]: stream for stream in info["streams"]}
        assert container in info["format"]["format_name"].split(","), filename
        assert abs(float(info["format"]["duration"]) - DURATION) < 0.1, filename
        assert streams["video"]["codec_name"] == video, filename
        assert streams["video"]["width"] == 256 and streams["video"]["height"] == 144, filename
        assert streams["audio"]["codec_name"] == audio, filename
        actual_chapters = [
            (float(chapter["start_time"]), float(chapter["end_time"]), chapter["tags"]["title"])
            for chapter in info["chapters"]
        ]
        assert actual_chapters == (CHAPTERS if filename == "mp4-chapters.mp4" else []), filename
        # Check complete decoding, not only container headers.
        subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-i", str(path),
                        "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], check=True)
        print(f"{filename}: {container}, {video}/{audio}, {DURATION}s, {path.stat().st_size} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="Check existing fixtures without rewriting.")
    args = parser.parse_args()
    if args.verify:
        verify(ROOT)
    else:
        generate()
