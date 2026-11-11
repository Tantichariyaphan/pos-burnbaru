"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SyncController } from "./sync-controller";

/**
 * ข้อมูลที่ซิงก์กับเซิร์ฟเวอร์: polling + visibilitychange + optimistic update ที่ไม่ถูกข้อมูลเก่าทับ
 * (ตรรกะหลักอยู่ใน SyncController ซึ่งมี unit test)
 */
export function useSyncedResource<T>(
  initial: T,
  fetcher: () => Promise<T>,
  opts: { intervalMs?: number | null; errorMessage?: (e: unknown) => string } = {},
) {
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const errRef = useRef(opts.errorMessage);
  errRef.current = opts.errorMessage;

  const ctrl = useMemo(
    () =>
      new SyncController<T>(() => fetcherRef.current(), {
        onApply: (v) => { setData(v); setError(null); setLastOkAt(Date.now()); },
        onError: (e) => setError(errRef.current ? errRef.current(e) : e instanceof Error ? e.message : String(e)),
      }),
    [],
  );

  const refresh = useCallback(() => ctrl.refresh(), [ctrl]);
  const track = useCallback(<R,>(fn: () => Promise<R>) => ctrl.track(fn), [ctrl]);

  const interval = opts.intervalMs === undefined ? 8000 : opts.intervalMs;
  useEffect(() => {
    if (interval === null) return;
    const tick = () => { if (document.visibilityState === "visible") void ctrl.refresh(); };
    const id = setInterval(tick, interval);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("online", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); window.removeEventListener("online", tick); };
  }, [ctrl, interval]);

  return { data, setData, error, lastOkAt, refresh, track };
}
