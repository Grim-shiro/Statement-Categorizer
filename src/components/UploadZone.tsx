"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { AppState } from "@/hooks/useTransactions";

interface UploadZoneProps {
  onFileAccepted: (file: File) => Promise<void>;
  appState: AppState;
  fileCount: number;
}

export default function UploadZone({
  onFileAccepted,
  appState,
  fileCount,
}: UploadZoneProps) {
  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      for (const file of acceptedFiles) {
        await onFileAccepted(file);
      }
    },
    [onFileAccepted]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/pdf": [".pdf"],
    },
    maxSize: 10 * 1024 * 1024,
    disabled: appState === "uploading",
  });

  const isUploading = appState === "uploading";

  return (
    <div
      {...getRootProps()}
      className={`
        relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer
        transition-all duration-200
        ${isDragActive ? "border-[#e94560] bg-[#e94560]/5 scale-[1.01]" : "border-gray-300 hover:border-[#0f3460] hover:bg-gray-50"}
        ${isUploading ? "opacity-50 pointer-events-none" : ""}
      `}
    >
      <input {...getInputProps()} />

      {isUploading ? (
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-[#0f3460] border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-600 font-medium">Processing file...</p>
        </div>
      ) : isDragActive ? (
        <div className="flex flex-col items-center gap-3">
          <svg
            className="w-12 h-12 text-[#e94560]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <p className="text-[#e94560] font-semibold text-lg">
            Drop files here
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <svg
            className="w-12 h-12 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <div>
            <p className="text-gray-700 font-semibold text-lg">
              Drag & drop bank statements here
            </p>
            <p className="text-gray-500 text-sm mt-1">
              or click to browse - supports CSV and PDF files (max 10MB)
            </p>
          </div>
          {fileCount > 0 && (
            <p className="text-sm text-[#0f3460] font-medium mt-2">
              {fileCount} file{fileCount !== 1 ? "s" : ""} uploaded - drop more
              or categorize below
            </p>
          )}
        </div>
      )}
    </div>
  );
}
