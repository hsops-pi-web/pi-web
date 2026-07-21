"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getAll, add, remove, clear, validate, type RecentCwd } from "@/lib/recent-cwds-storage";

export function useRecentCwds() {
  const [cwds, setCwds] = useState<RecentCwd[]>([]);
  const [loading, setLoading] = useState(true);
  const initializingRef = useRef(false);

  useEffect(() => {
    if (initializingRef.current) return;
    initializingRef.current = true;

    const loadAndValidate = async () => {
      const loaded = getAll();
      const validationResults = await Promise.allSettled(
        loaded.map((item) => validate(item.path))
      );

      const validCwds = loaded.filter((item, index) => {
        const result = validationResults[index];
        return result.status === "fulfilled" && result.value === true;
      });

      if (validCwds.length < loaded.length) {
        console.log(`[recent-cwds] Removed ${loaded.length - validCwds.length} invalid directories`);
        try {
          const STORAGE_KEY = "pi-web-recent-cwds";
          if (validCwds.length === 0) {
            localStorage.removeItem(STORAGE_KEY);
          } else {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(validCwds));
          }
        } catch (e) {
          console.warn("[recent-cwds] Failed to update localStorage:", e);
        }
      }

      setCwds(validCwds);
      setLoading(false);
    };

    loadAndValidate();
  }, []);

  const addCwd = useCallback((path: string) => {
    const updated = add(path);
    setCwds(updated);
  }, []);

  const removeCwd = useCallback((path: string): RecentCwd[] => {
    const updated = remove(path);
    setCwds(updated);
    return updated;
  }, []);

  const clearCwds = useCallback(() => {
    clear();
    setCwds([]);
  }, []);

  return { cwds, addCwd, removeCwd, clearCwds, loading };
}
