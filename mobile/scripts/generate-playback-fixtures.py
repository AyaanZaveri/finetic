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
SUBTITLES = """1
00:00:01,000 --> 00:00:04,000
Navigator test subtitle one

2
00:00:08,000 --> 00:00:11,000
Navigator test subtitle two
"""
FIXTURES = {
    "mp4-avc.mp4": ("mp4", "h264", "aac", None),
    "mkv-avc.mkv": ("matroska", "h264", "aac", None),
    "webm-vp9.webm": ("webm", "vp9", "opus", None),
    "mp4-hevc.mp4": ("mp4", "hevc", "aac", None),
    "mkv-av1-subs.mkv": ("matroska", "av1", "flac", "subrip"),
    "mp4-chapters.mp4": ("mp4", "h264", "aac", None),
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
        inputs = [
            "-f", "lavfi", "-i", f"testsrc2=size=256x144:rate=12:duration={DURATION}",
            "-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:duration={DURATION}",
        ]
        sources = [
            *inputs,
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
        subtitles = folder / "subtitles.srt"
        subtitles.write_text(SUBTITLES, encoding="utf-8")
        ffmpeg(*inputs, "-i", subtitles, "-map", "0:v:0", "-map", "1:a:0", "-map", "2:s:0",
               "-pix_fmt", "yuv420p", "-g", "12", "-c:v", "libsvtav1", "-preset", "10",
               "-svtav1-params", "lp=1", "-crf", "45", "-c:a", "flac", "-c:s", "srt",
               "-metadata:s:s:0", "language=eng", folder / "mkv-av1-subs.mkv")
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
    for filename, (container, video, audio, subtitle) in FIXTURES.items():
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
        assert streams.get("subtitle", {}).get("codec_name") == subtitle, filename
        if subtitle:
            assert streams["subtitle"]["tags"]["language"] == "eng", filename
            decoded = subprocess.run(
                ["ffmpeg", "-v", "error", "-xerror", "-i", str(path),
                 "-map", "0:s:0", "-c:s", "srt", "-f", "srt", "-"],
                check=True, text=True, capture_output=True,
            )
            assert decoded.stdout.strip() == SUBTITLES.strip(), filename
        actual_chapters = [
            (float(chapter["start_time"]), float(chapter["end_time"]), chapter["tags"]["title"])
            for chapter in info["chapters"]
        ]
        assert actual_chapters == (CHAPTERS if filename == "mp4-chapters.mp4" else []), filename
        # Check complete decoding, not only container headers.
        subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-i", str(path),
                        "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], check=True)
        codecs = "/".join(codec for codec in (video, audio, subtitle) if codec)
        print(f"{filename}: {container}, {codecs}, {DURATION}s, {path.stat().st_size} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="Check existing fixtures without rewriting.")
    args = parser.parse_args()
    if args.verify:
        verify(ROOT)
    else:
        generate()
