#!/usr/bin/env python3
"""
Minimal HTTP server wrapping faster-whisper for local STT.
Designed to be spawned by the BoloAI Electron app.

Usage:
    python3 server.py --ffmpeg-path /path/to/ffmpeg [--port 18788]

Endpoints:
    GET  /           -> {"status": "ready"}   (health check)
    POST /inference  -> {"text": "..."}        (transcribe audio)
        Accepts multipart/form-data with a "file" field containing WebM/Opus audio.

Prints "READY" to stdout once the model is loaded and server is listening.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

# Globals set after argument parsing
model = None
ffmpeg_path = "ffmpeg"


def parse_multipart(body: bytes, content_type: str) -> bytes:
    """
    Parse multipart/form-data manually (Python 3.13 removed the cgi module).
    Extracts the first file part's binary content.
    """
    # Extract boundary from Content-Type header
    # e.g. "multipart/form-data; boundary=----WhisperBoundary1234"
    boundary = None
    for part in content_type.split(";"):
        part = part.strip()
        if part.startswith("boundary="):
            boundary = part[len("boundary="):].strip().strip('"')
            break

    if not boundary:
        raise ValueError("No boundary found in Content-Type header")

    boundary_bytes = ("--" + boundary).encode()
    end_boundary = (boundary_bytes + b"--")

    # Split body by boundary
    parts = body.split(boundary_bytes)

    for part in parts:
        # Skip empty parts and end boundary
        stripped = part.strip()
        if not stripped or stripped == b"--" or stripped.startswith(b"--\r\n"):
            continue

        # Find the blank line separating headers from content
        header_end = part.find(b"\r\n\r\n")
        if header_end == -1:
            continue

        headers_raw = part[:header_end].decode("utf-8", errors="replace")
        content = part[header_end + 4:]  # Skip \r\n\r\n

        # Check if this is a file field
        if 'filename=' in headers_raw:
            # Remove trailing \r\n if present
            if content.endswith(b"\r\n"):
                content = content[:-2]
            return content

    raise ValueError("No file part found in multipart data")


class FasterWhisperHandler(BaseHTTPRequestHandler):
    """HTTP request handler for faster-whisper inference."""

    def log_message(self, format, *args):
        """Override to prefix log messages."""
        print(f"[faster-whisper] {format % args}", flush=True)

    def do_GET(self):
        """Health check endpoint."""
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"status": "ready"}).encode())

    def do_POST(self):
        """Transcription endpoint."""
        if self.path != "/inference":
            self.send_error(404, "Not found")
            return

        t_start = time.time()

        try:
            # Read request body
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length == 0:
                self.send_error(400, "Empty request body")
                return

            body = self.rfile.read(content_length)
            content_type = self.headers.get("Content-Type", "")

            # Extract audio data from multipart form
            audio_data = parse_multipart(body, content_type)
            t_parse = time.time()

            # Write to temp file
            with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
                f.write(audio_data)
                webm_path = f.name

            wav_path = webm_path.replace(".webm", ".wav")

            try:
                # Convert WebM -> WAV via ffmpeg
                result = subprocess.run(
                    [ffmpeg_path, "-i", webm_path,
                     "-ar", "16000", "-ac", "1",
                     "-c:a", "pcm_s16le",
                     "-y", wav_path],
                    capture_output=True, timeout=30
                )
                if result.returncode != 0:
                    stderr = result.stderr.decode("utf-8", errors="replace")
                    self.send_error(500, f"ffmpeg failed: {stderr[:200]}")
                    return

                t_ffmpeg = time.time()

                # Transcribe with faster-whisper
                segments, info = model.transcribe(
                    wav_path,
                    language="en",
                    vad_filter=True,   # Strip silence — speeds up real-world audio
                    beam_size=1,       # Greedy decoding for speed
                )
                text = " ".join(seg.text for seg in segments).strip()
                t_transcribe = time.time()

            finally:
                # Clean up temp files
                try:
                    os.unlink(webm_path)
                except OSError:
                    pass
                try:
                    os.unlink(wav_path)
                except OSError:
                    pass

            total_ms = int((t_transcribe - t_start) * 1000)
            parse_ms = int((t_parse - t_start) * 1000)
            ffmpeg_ms = int((t_ffmpeg - t_parse) * 1000)
            stt_ms = int((t_transcribe - t_ffmpeg) * 1000)

            print(f"[faster-whisper] Transcribed in {total_ms}ms "
                  f"(parse:{parse_ms}ms, ffmpeg:{ffmpeg_ms}ms, stt:{stt_ms}ms)",
                  flush=True)

            response = json.dumps({"text": text})
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response.encode())

        except Exception as e:
            print(f"[faster-whisper] Error: {e}", flush=True)
            error_msg = json.dumps({"error": str(e)})
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(error_msg)))
            self.end_headers()
            self.wfile.write(error_msg.encode())


def main():
    global model, ffmpeg_path

    parser = argparse.ArgumentParser(description="faster-whisper HTTP server")
    parser.add_argument("--port", type=int, default=18788, help="Port to listen on")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--ffmpeg-path", default="ffmpeg", help="Path to ffmpeg binary")
    parser.add_argument("--model", default="tiny.en", help="Whisper model name")
    args = parser.parse_args()

    ffmpeg_path = args.ffmpeg_path

    # Load model (first run will download ~75MB from HuggingFace)
    print(f"[faster-whisper] Loading model '{args.model}'...", flush=True)
    t0 = time.time()

    from faster_whisper import WhisperModel
    model = WhisperModel(args.model, device="cpu", compute_type="int8")

    load_ms = int((time.time() - t0) * 1000)
    print(f"[faster-whisper] Model loaded in {load_ms}ms", flush=True)

    # Start HTTP server
    server = HTTPServer((args.host, args.port), FasterWhisperHandler)
    print(f"READY", flush=True)  # Signal for Electron manager
    print(f"[faster-whisper] Listening on {args.host}:{args.port}", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[faster-whisper] Shutting down...", flush=True)
        server.server_close()


if __name__ == "__main__":
    main()
