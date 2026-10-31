import { useEffect, useRef, useState } from "react";
import { fetchSupportAttachment } from "../services/api/platform";

export interface SupportAttachment {
  object_id: string;
  original_name: string;
  media_type: string;
}

export function SupportAttachments({ token, items, audience = "platform" }: { token: string; items?: SupportAttachment[]; audience?: "platform" | "tenant" }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const urlRef = useRef<Record<string, string>>({});

  useEffect(() => () => Object.values(urlRef.current).forEach((url) => URL.revokeObjectURL(url)), []);

  async function toggle(item: SupportAttachment) {
    if (urls[item.object_id]) {
      URL.revokeObjectURL(urls[item.object_id]);
      delete urlRef.current[item.object_id];
      setUrls((current) => {
        const next = { ...current };
        delete next[item.object_id];
        return next;
      });
      return;
    }
    setLoading(item.object_id);
    setError("");
    try {
      const url = URL.createObjectURL(await fetchSupportAttachment(token, item.object_id, audience));
      urlRef.current[item.object_id] = url;
      setUrls((current) => ({ ...current, [item.object_id]: url }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir a captura.");
    } finally {
      setLoading(null);
    }
  }

  if (!items?.length) return null;
  return <div className="support-attachments" aria-label="Capturas de tela anexadas">
    {items.map((item) => <div className="support-attachment" key={item.object_id}>
      <button className="support-attachment-button" type="button" onClick={() => void toggle(item)}>
        {loading === item.object_id ? "Abrindo…" : urls[item.object_id] ? "Ocultar captura" : item.original_name}
      </button>
      {urls[item.object_id] ? <img src={urls[item.object_id]} alt={item.original_name} /> : null}
    </div>)}
    {error ? <small role="alert">{error}</small> : null}
  </div>;
}
