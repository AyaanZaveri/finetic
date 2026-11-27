"""Synthetic WEB-DL-like files, not copies of commercial media."""
import pathlib
import subprocess
import sys

directory = pathlib.Path(sys.argv[1])
directory.mkdir(parents=True, exist_ok=True)


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def encode(name, channels, codec, options):
    path = directory / name
    ffmpeg(
        "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=24000/1001:duration=30",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=30",
        "-map", "0:v", "-map", "1:a", "-c:v", codec, "-pix_fmt", "yuv420p",
        "-threads", "4", *options, "-c:a", "eac3", "-ac", str(channels),
        "-b:a", "192k" if channels == 2 else "640k", str(path),
    )
    print(name, path.stat().st_size, flush=True)
    subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                    "stream=codec_name,profile,width,height,channels:format=duration,size",
                    "-of", "compact", str(path)], check=True)


encode("avc-stereo.mkv", 2, "libx264",
       ["-preset", "veryfast", "-profile:v", "high", "-crf", "24", "-g", "96", "-bf", "3"])
encode("avc-surround-open-gop.mkv", 6, "libx264",
       ["-preset", "veryfast", "-profile:v", "high", "-crf", "20", "-g", "120",
        "-bf", "3", "-x264-params", "open-gop=1:scenecut=0"])
encode("hevc-control.mkv", 6, "libx265",
       ["-preset", "ultrafast", "-crf", "12", "-x265-params", "pools=4:frame-threads=2:keyint=48:log-level=error"])

source = directory / "avc-stereo.mkv"
ffmpeg("-i", str(source), "-map", "0", "-c", "copy", "-cues_to_front", "1",
       str(directory / "avc-front-cues.mkv"))
# A streaming-style Matroska file intentionally omits the cue index. Keep it
# as a diagnostic control, separate from the normal indexed WEB-DL cases.
ffmpeg("-i", str(source), "-map", "0", "-c", "copy", "-live", "1",
       str(directory / "avc-no-cues.mkv"))
