# /// script
# requires-python = ">=3.11"
# dependencies = ["google-genai"]
# ///
"""Generate a goggle selfie for every animal photo in poc/subjects.

Usage:
    uv run poc/generate.py --dry-run
    uv run poc/generate.py --attempts 2
"""

import argparse
import base64
import mimetypes
import os
import sys
import time
from pathlib import Path

POC_DIR = Path(__file__).resolve().parent
ENV_FILE = POC_DIR.parent / ".env.local"
REFERENCES_DIR = POC_DIR / "references"
SUBJECTS_DIR = POC_DIR / "subjects"
OUTPUT_DIR = POC_DIR / "output"
PROMPT_FILE = POC_DIR / "prompt.txt"

MODEL = "gemini-nano-banana-2.1"
USD_PER_1K_IMAGE = 0.0336  # Output only; input image tokens are billed separately.
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def load_api_key() -> str | None:
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            name, separator, value = line.strip().partition("=")
            if separator and name == "GEMINI_API_KEY":
                return value.strip().strip("'\"")
    return os.environ.get("GEMINI_API_KEY")


def list_images(directory: Path) -> list[Path]:
    return sorted(
        path for path in directory.iterdir() if path.suffix.lower() in IMAGE_SUFFIXES
    )


def image_part(path: Path) -> dict:
    mime_type = mimetypes.guess_type(path.name)[0]
    return {
        "type": "image",
        "data": base64.b64encode(path.read_bytes()).decode(),
        "mime_type": mime_type,
    }


def build_input(references: list[Path], subject: Path, prompt: str) -> list[dict]:
    parts: list[dict] = [{"type": "text", "text": "[구도 기준 이미지]"}]
    parts += [image_part(path) for path in references]
    parts += [
        {"type": "text", "text": "[주인공 동물 사진]"},
        image_part(subject),
        {"type": "text", "text": prompt},
    ]
    return parts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--attempts", type=int, default=1, help="images per subject")
    parser.add_argument("--dry-run", action="store_true", help="check inputs only")
    args = parser.parse_args()

    references = list_images(REFERENCES_DIR)
    subjects = list_images(SUBJECTS_DIR)
    total = len(subjects) * args.attempts
    print(f"레퍼런스 {len(references)}장, 동물 사진 {len(subjects)}장, 생성 예정 {total}장")
    print(f"예상 출력 비용: ${total * USD_PER_1K_IMAGE:.2f} (입력 이미지 비용 별도)")

    if not subjects:
        print(f"동물 사진을 {SUBJECTS_DIR} 폴더에 넣어 주세요.", file=sys.stderr)
        return 1

    api_key = load_api_key()
    if not api_key:
        print(f"{ENV_FILE} 파일에 GEMINI_API_KEY가 없습니다.", file=sys.stderr)
        return 1
    if args.dry_run:
        print("입력 확인 완료. API는 호출하지 않았습니다.")
        return 0

    from google import genai

    client = genai.Client(api_key=api_key)
    prompt = PROMPT_FILE.read_text()
    run_dir = OUTPUT_DIR / time.strftime("%Y%m%d-%H%M%S")
    run_dir.mkdir(parents=True)

    failures = 0
    for subject in subjects:
        for attempt in range(1, args.attempts + 1):
            label = f"{subject.stem}-{attempt}"
            try:
                interaction = client.interactions.create(
                    model=MODEL,
                    input=build_input(references, subject, prompt),
                    response_format={
                        "type": "image",
                        "aspect_ratio": "1:1",
                        "image_size": "1K",
                    },
                )
                output_image = interaction.output_image
                if output_image is None:
                    raise RuntimeError("응답에 이미지가 없습니다")
                output_path = run_dir / f"{label}.png"
                output_path.write_bytes(base64.b64decode(output_image.data))
                print(f"완료: {output_path}")
            except Exception as error:
                failures += 1
                print(f"실패: {label}: {error}", file=sys.stderr)

    print(f"결과: 성공 {total - failures}장, 실패 {failures}장")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
