"use client";

import { useState, useCallback, useRef } from "react";
import { isAcceptedDoc } from "@/lib/upload";

export function useDragDrop(onDrop: (files: File[]) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const counterRef = useRef(0);

  const hasAcceptedFiles = useCallback((items: DataTransferItemList) => {
    return Array.from(items).some((item) => {
      if (item.type.startsWith("image/")) return true;
      const file = item.getAsFile();
      return file ? isAcceptedDoc(file.name) : item.kind === "file";
    });
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasAcceptedFiles(e.dataTransfer.items)) return;
    e.preventDefault();
    counterRef.current += 1;
    setIsDragOver(true);
  }, [hasAcceptedFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasAcceptedFiles(e.dataTransfer.items)) return;
    e.preventDefault();
  }, [hasAcceptedFiles]);

  const handleDragLeave = useCallback(() => {
    counterRef.current -= 1;
    if (counterRef.current <= 0) {
      counterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    onDrop(files);
  }, [onDrop]);

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
