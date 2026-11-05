"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { ERROR_MESSAGES } from "@/lib/errors";
import { MAX_IMAGE_BYTES } from "@/lib/image-validation";

type ScreenStep = "upload" | "generating" | "result";

export interface SelfieGeneratorAppProps {
  initialMockMode: boolean;
}

const ACCEPTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function SelfieGeneratorApp({
  initialMockMode,
}: SelfieGeneratorAppProps) {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<ScreenStep>("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isAdult, setIsAdult] = useState(false);
  const [geminiConsent, setGeminiConsent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [isMockMode, setIsMockMode] = useState<boolean>(initialMockMode);

  // Release object URL when preview changes or unmounts
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function clearSelectedFile() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleFileSelection(files: FileList | null) {
    setErrorMessage(null);
    if (!files || files.length === 0) {
      return;
    }

    const file = files[0];
    if (!file) {
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      clearSelectedFile();
      setErrorMessage(ERROR_MESSAGES.FILE_TOO_LARGE);
      return;
    }

    if (file.type && !ACCEPTED_MIME_TYPES.has(file.type.toLowerCase())) {
      clearSelectedFile();
      setErrorMessage(ERROR_MESSAGES.UNSUPPORTED_FILE);
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    const nextPreviewUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewUrl(nextPreviewUrl);
  }

  function handleDropzoneKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    if (step === "generating") {
      return;
    }
    handleFileSelection(event.dataTransfer.files);
  }

  const canSubmit =
    step === "upload" &&
    selectedFile !== null &&
    isAdult &&
    geminiConsent;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !selectedFile) {
      return;
    }

    setErrorMessage(null);
    setStep("generating");

    try {
      const formData = new FormData();
      formData.append("subject", selectedFile);
      formData.append("isAdult", String(isAdult));
      formData.append("geminiConsent", String(geminiConsent));

      const response = await fetch("/api/generate", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json().catch(() => null)) as {
        imageDataUrl?: string;
        mode?: "mock" | "live";
        error?: string;
      } | null;

      if (!response.ok || !payload?.imageDataUrl) {
        let message: string = ERROR_MESSAGES.GENERIC_ERROR;
        if (payload?.error) {
          message = payload.error;
        } else if (response.status === 429) {
          message = ERROR_MESSAGES.RATE_LIMITED;
        } else if (response.status === 402) {
          message = ERROR_MESSAGES.PAYMENT_REQUIRED;
        }
        setErrorMessage(message);
        setStep("upload");
        return;
      }

      if (payload.mode === "mock") {
        setIsMockMode(true);
      }

      setResultImageUrl(payload.imageDataUrl);
      setStep("result");
    } catch {
      setErrorMessage(ERROR_MESSAGES.GENERIC_ERROR);
      setStep("upload");
    }
  }

  function handleSaveImage() {
    if (!resultImageUrl) {
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = resultImageUrl;
    const ext = resultImageUrl.startsWith("data:image/png") ? "png" : "jpeg";
    anchor.download = `goggle-selfie.${ext}`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }

  function handleResetForNewPhoto() {
    clearSelectedFile();
    setResultImageUrl(null);
    setErrorMessage(null);
    setStep("upload");
  }

  function handleOpenGemini() {
    window.open("https://gemini.google.com/app", "_blank", "noopener,noreferrer");
  }

  return (
    <main className="page-shell">
      {isMockMode && (
        <div className="mock-banner" role="status" aria-live="polite">
          <span className="mock-banner-dot" aria-hidden="true" />
          <span>테스트 모드: 실제 생성 결과가 아닙니다</span>
        </div>
      )}

      <header className="app-header">
        <div className="header-badge-row">
          <span className="goggle-pill">
            <span className="goggle-icon-lens" aria-hidden="true" />
            <span>SWIM CAP &amp; GOGGLE SELFIE</span>
          </span>
        </div>
        <h1 className="app-title">동물 수경 셀카 만들기</h1>
        <p className="app-subtitle">
          동물 사진 1장만 올리면 검은 수모와 연두색 수경을 쓴 셀카로 만들어 드려요.
        </p>
      </header>

      {step === "upload" && (
        <form className="main-card" onSubmit={handleSubmit} noValidate>
          <input
            ref={fileInputRef}
            id={fileInputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only-file-input"
            onChange={(e) => handleFileSelection(e.target.files)}
          />

          <div
            role="button"
            tabIndex={0}
            aria-label="우리 집 동물 사진 1장을 올려주세요"
            className={`upload-dropzone ${
              selectedFile ? "upload-dropzone-has-file" : ""
            }`}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={handleDropzoneKeyDown}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {!selectedFile || !previewUrl ? (
              <>
                <div className="upload-goggle-graphic" aria-hidden="true">
                  <span className="goggle-loop" />
                  <span className="goggle-bridge" />
                  <span className="goggle-loop" />
                </div>
                <p className="upload-headline">
                  우리 집 동물 사진 1장을 올려주세요
                </p>
                <p className="upload-guide">
                  얼굴이 잘 보이는 사진 / 한 마리만 / 밝은 사진
                </p>
                <p className="upload-format-hint">
                  JPEG, PNG, WebP · 최대 10MB
                </p>
              </>
            ) : (
              <div className="selected-preview-wrap">
                <img
                  src={previewUrl}
                  alt="업로드할 우리 집 동물 사진 미리보기"
                  className="selected-preview-thumb"
                />
                <div className="selected-preview-info">
                  <span className="selected-file-label">
                    우리 집 동물 사진 1장을 올려주세요
                  </span>
                  <span className="selected-file-name">{selectedFile.name}</span>
                  <span className="selected-change-hint">
                    얼굴이 잘 보이는 사진 / 한 마리만 / 밝은 사진 (터치하여 변경)
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="consent-list">
            <label className="consent-item">
              <input
                type="checkbox"
                className="consent-checkbox"
                checked={isAdult}
                onChange={(e) => setIsAdult(e.target.checked)}
              />
              <span>만 18세 이상입니다</span>
            </label>

            <label className="consent-item">
              <input
                type="checkbox"
                className="consent-checkbox"
                checked={geminiConsent}
                onChange={(e) => setGeminiConsent(e.target.checked)}
              />
              <span>
                사진을 이미지 생성을 위해 Google Gemini API로 전송하는 데 동의합니다
              </span>
            </label>
          </div>

          {errorMessage && (
            <div className="error-banner" role="alert">
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            className="primary-btn"
            disabled={!canSubmit}
          >
            수경 셀카 만들기
          </button>
        </form>
      )}

      {step === "generating" && (
        <section className="main-card" aria-live="polite" aria-busy="true">
          <div className="generating-box">
            {previewUrl && (
              <div className="generating-preview-frame">
                <img
                  src={previewUrl}
                  alt="생성 중인 동물 사진 미리보기"
                  className="generating-preview-img"
                />
              </div>
            )}
            <div className="generating-status-pill">
              <span className="spinner-dot" aria-hidden="true" />
              <span>수경 셀카를 만드는 중이에요...</span>
            </div>
            <p className="generating-desc">
              검은 수모와 연두색 수경을 맞춰 입히고 있어요. 잠시만 기다려 주세요.
            </p>
          </div>

          <button type="button" className="primary-btn" disabled>
            수경 셀카 만들기
          </button>
        </section>
      )}

      {step === "result" && resultImageUrl && (
        <section className="main-card" aria-live="polite">
          <div className="result-image-frame">
            <img
              src={resultImageUrl}
              alt="검은 수모와 연두색 수경을 쓴 동물 셀카 결과 이미지"
              className="result-image"
            />
            {isMockMode && (
              <div className="result-mock-watermark">
                샘플 이미지 · 실제 생성 결과가 아닙니다
              </div>
            )}
          </div>

          <div className="result-actions-grid">
            <button
              type="button"
              className="primary-btn"
              onClick={handleSaveImage}
            >
              이미지 저장
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={handleResetForNewPhoto}
            >
              다른 사진으로 만들기
            </button>
          </div>

          <div className="gemini-handoff-box">
            <p className="gemini-handoff-guide">
              결과 이미지를 저장한 뒤 Gemini에 첨부해 보세요
            </p>
            <button
              type="button"
              className="gemini-btn"
              onClick={handleOpenGemini}
            >
              Gemini에서 이어서 수정해 보세요
            </button>
          </div>
        </section>
      )}

      <p className="privacy-footnote">
        업로드한 사진과 생성된 이미지는 서버에 보관하지 않으며, 요청 처리 후 메모리에서 즉시 해제됩니다.
      </p>
    </main>
  );
}
