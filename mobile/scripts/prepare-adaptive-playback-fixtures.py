#!/usr/bin/env python3
"""Generate, verify, or serve synthetic HLS and DASH fixtures for native tests."""
import argparse
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from xml.etree import ElementTree

SOURCE = Path(__file__).resolve().parents[1] / "assets" / "playback" / "mp4-avc.mp4"
DURATION = 14
HLS_PATH = "hls/playlist.m3u8"
DASH_PATH = "dash/manifest.mpd"
DASH_INIT = "init-stream$RepresentationID$.m4s"
DASH_SEGMENT = "chunk-stream$RepresentationID$-$Number%05d$.m4s"
DASH_NAMESPACE = {"dash": "urn:mpeg:dash:schema:mpd:2011"}
CODECS = {"video": "h264", "audio": "aac"}
MEDIA_PATH = re.compile(
    r"/(?:hls/(?:playlist\.m3u8|segment-[0-9]{3}\.ts)"
    r"|dash/(?:manifest\.mpd|init-stream[01]\.m4s|chunk-stream[01]-[0-9]{5}\.m4s))"
)


def generate(folder):
    remux = ["ffmpeg", "-v", "error", "-nostdin", "-i", str(SOURCE),
             "-map", "0:v:0", "-map", "0:a:0", "-c", "copy"]
    (folder / "hls").mkdir()
    (folder / "dash").mkdir()
    subprocess.run(
        [*remux, "-f", "hls", "-hls_time", "2", "-hls_playlist_type", "vod",
         "-hls_flags", "independent_segments", "-hls_segment_filename", "segment-%03d.ts", "playlist.m3u8"],
        cwd=folder / "hls", check=True,
    )
    # Each segment is a separate file, so clients can seek without HTTP range requests.
    subprocess.run(
        [*remux, "-f", "dash", "-seg_duration", "2", "-single_file", "0",
         "-init_seg_name", DASH_INIT, "-media_seg_name", DASH_SEGMENT,
         "-adaptation_sets", "id=0,streams=v id=1,streams=a", "manifest.mpd"],
        cwd=folder / "dash", check=True,
    )


def verify_media(path, expected_codecs):
    protocols = ["-protocol_whitelist", "file,crypto,data"]
    info = json.loads(subprocess.check_output(
        ["ffprobe", "-v", "error", *protocols, "-show_entries", "format=duration:stream=codec_type,codec_name",
         "-of", "json", str(path)], text=True,
    ))
    codecs = {stream["codec_type"]: stream["codec_name"] for stream in info["streams"]}
    duration = float(info["format"]["duration"])
    if codecs != expected_codecs or abs(duration - DURATION) >= 0.1:
        raise ValueError(f"Unexpected streams or duration in {path.name}: {codecs}, {duration}s")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-xerror", "-nostdin", *protocols, "-i", str(path),
         "-map", "0", "-f", "null", "-"], check=True,
    )


def verify_dash(manifest_path):
    manifest = ElementTree.parse(manifest_path).getroot()
    sets = manifest.findall("dash:Period/dash:AdaptationSet", DASH_NAMESPACE)
    if manifest.get("type") != "static" or [entry.get("contentType") for entry in sets] != list(CODECS):
        raise ValueError("Expected a static DASH manifest with video and audio renditions")

    # Validate the manifest's exact segment sequence and decode it even on
    # FFmpeg builds that lack the optional MPEG-DASH demuxer.
    with tempfile.TemporaryDirectory(prefix="navigator-dash-verify-") as directory:
        for index, adaptation in enumerate(sets):
            identifier = str(index)
            media = adaptation.attrib["contentType"]
            representation = adaptation.find("dash:Representation", DASH_NAMESPACE)
            template = adaptation.find("dash:Representation/dash:SegmentTemplate", DASH_NAMESPACE)
            if (representation is None or representation.get("id") != identifier or template is None
                    or template.get("initialization") != DASH_INIT or template.get("media") != DASH_SEGMENT):
                raise ValueError(f"Unexpected DASH {media} segment template")
            timeline = template.findall("dash:SegmentTimeline/dash:S", DASH_NAMESPACE)
            count = sum(1 + int(segment.get("r", "0")) for segment in timeline)
            if count < 2:
                raise ValueError(f"Expected a DASH {media} segment timeline")
            first = int(template.get("startNumber", "1"))
            names = [f"init-stream{identifier}.m4s"]
            names.extend(f"chunk-stream{identifier}-{number:05d}.m4s" for number in range(first, first + count))
            track = Path(directory) / f"{media}.mp4"
            with track.open("wb") as output:
                for name in names:
                    with (manifest_path.parent / name).open("rb") as segment:
                        shutil.copyfileobj(segment, output)
            verify_media(track, {media: CODECS[media]})


def verify(folder):
    playlist = (folder / HLS_PATH).read_text(encoding="utf-8").splitlines()
    if "#EXT-X-PLAYLIST-TYPE:VOD" not in playlist or "#EXT-X-ENDLIST" not in playlist:
        raise ValueError("Expected a complete HLS VOD playlist")
    verify_media(folder / HLS_PATH, CODECS)
    print(f"Verified /{HLS_PATH}: H.264/AAC, {DURATION}s", flush=True)
    verify_dash(folder / DASH_PATH)
    print(f"Verified /{DASH_PATH}: H.264/AAC, {DURATION}s", flush=True)


class MediaHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        ".m3u8": "application/vnd.apple.mpegurl",
        ".ts": "video/mp2t",
        ".mpd": "application/dash+xml",
        ".m4s": "video/iso.segment",
    }

    def send_head(self):
        route = self.path.split("?", 1)[0]
        if MEDIA_PATH.fullmatch(route):
            path = Path(self.translate_path(self.path)).resolve()
            if path.is_relative_to(self.directory) and path.is_file():
                return super().send_head()
        self.send_error(HTTPStatus.NOT_FOUND)
        return None


def serve(folder, port):
    handler = partial(MediaHandler, directory=str(folder.resolve()))
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"Serving adaptive fixtures on http://127.0.0.1:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--output", type=Path, help="Copy verified fixtures to an empty directory.")
    source.add_argument("--directory", type=Path, help="Serve already verified fixtures from this directory.")
    parser.add_argument("--serve", metavar="PORT", type=int, help="Serve the fixtures on loopback.")
    args = parser.parse_args()
    if args.serve is not None and not 0 <= args.serve <= 65535:
        parser.error("--serve must use a port from 0 to 65535")
    if args.directory is not None:
        if args.serve is None:
            parser.error("--directory requires --serve")
        if not all((args.directory / path).is_file() for path in (HLS_PATH, DASH_PATH)):
            parser.error("--directory must contain the HLS and DASH fixtures")
        serve(args.directory, args.serve)
        return
    if args.output is not None and args.output.exists():
        if not args.output.is_dir() or any(args.output.iterdir()):
            parser.error("--output must be an empty or new directory")

    with tempfile.TemporaryDirectory(prefix="navigator-adaptive-playback-") as directory:
        folder = Path(directory)
        generate(folder)
        verify(folder)
        if args.output is not None:
            shutil.copytree(folder, args.output, dirs_exist_ok=True)
        if args.serve is not None:
            serve(folder, args.serve)


if __name__ == "__main__":
    main()
