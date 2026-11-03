import { useEffect, useRef, useState } from "react";

type Fallback = { src: string; url?: string; failed?: boolean };

// A direct load that fails (for example a Cross-Origin-Resource-Policy refusal)
// is retried once through the mail service, which fetches the same image that
// the email references (ADR 0121). Callers have already passed image consent.
export function useRemoteImage(mailId: string | undefined, src: string) {
  const [fallback, setFallback] = useState<Fallback>();
  const mounted = useRef(true), request = useRef<AbortController | undefined>(undefined);
  // Closing the reader cancels a pending copy so it stops holding a service slot.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  useEffect(() => () => { if (fallback?.url) URL.revokeObjectURL(fallback.url); }, [fallback]);
  const current = fallback?.src === src ? fallback : undefined;
  const onError = () => {
    if (current) { if (current.url) setFallback({ src, failed: true }); return; }
    if (!mailId || !/^https:/i.test(src)) return setFallback({ src, failed: true });
    setFallback({ src });
    const controller = request.current = new AbortController();
    void (async () => {
      const response = await fetch(`/api/messages/${encodeURIComponent(mailId)}/remote-image?src=${encodeURIComponent(src)}`, { signal: controller.signal });
      if (!response.ok) throw new Error("Remote image unavailable");
      const url = URL.createObjectURL(await response.blob());
      if (!mounted.current) return URL.revokeObjectURL(url);
      setFallback((value) => {
        if (value?.src === src && !value.url && !value.failed) return { src, url };
        URL.revokeObjectURL(url);
        return value;
      });
    })().catch(() => {
      if (mounted.current) setFallback((value) => value?.src === src && !value.url ? { src, failed: true } : value);
    });
  };
  return { src: current?.url ?? src, retrying: !!current && !current.url && !current.failed, failed: !!current?.failed, onError };
}
