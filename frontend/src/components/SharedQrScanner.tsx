import { useEffect, useRef, useState } from "react";
import { createQrFrameDetector } from "../services/media/qrFrameDetector";

export function SharedQrScanner({
  onCode,
  onClose,
}: {
  onCode: (code: string) => Promise<void>;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(""),
    [manual, setManual] = useState(""),
    [busy, setBusy] = useState(false);
  const deliver = useRef(onCode);
  deliver.current = onCode;
  useEffect(() => {
    let cancelled = false,
      stream: MediaStream | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      stream?.getTracks().forEach((track) => track.stop());
      if (timer) clearTimeout(timer);
    };
    void (async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          throw Error(
            "A câmera precisa de acesso HTTPS. Você pode digitar o código ou selecionar o equipamento.",
          );
        const detector = await createQrFrameDetector();
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stop();
          return;
        }
        if (!video.current) {
          stop();
          return;
        }
        video.current.srcObject = stream;
        await video.current.play();
        const scan = async () => {
          if (cancelled) return;
          try {
            const results = await detector.detect(video.current!);
            const code = results.find((item) => item.rawValue)?.rawValue;
            if (code) {
              stop();
              setBusy(true);
              try {
                await deliver.current(code);
              } catch (cause) {
                if (!cancelled)
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Código não encontrado.",
                  );
              } finally {
                if (!cancelled) setBusy(false);
              }
              return;
            }
          } catch {
            if (!cancelled)
              setError(
                "Não foi possível ler a câmera. Digite o código ou use a seleção manual.",
              );
            stop();
            return;
          }
          if (!cancelled) timer = setTimeout(() => void scan(), 350);
        };
        void scan();
      } catch (cause) {
        stop();
        if (!cancelled)
          setError(
            cause instanceof Error
              ? [
                  "NotAllowedError",
                  "NotFoundError",
                  "NotReadableError",
                ].includes(cause.name)
                ? "Câmera indisponível ou sem permissão. Digite o código ou selecione o equipamento."
                : cause.message
              : "Câmera indisponível. Digite o código.",
          );
      }
    })();
    return () => {
      cancelled = true;
      stop();
      if (video.current) video.current.srcObject = null;
    };
  }, []);
  return (
    <section className="shared-work__scanner" aria-label="Leitor de QR Code">
      <h3>Ler QR Code do equipamento</h3>
      <video
        ref={video}
        muted
        playsInline
        aria-label="Câmera para leitura do QR Code"
      />
      <p>
        Aponte para a etiqueta do equipamento. O código identifica o local e não
        libera a OS.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <label>
        Ou digite o código da etiqueta
        <input
          value={manual}
          maxLength={500}
          onChange={(event) => setManual(event.target.value)}
        />
      </label>
      <div className="shared-work__actions">
        <button
          type="button"
          disabled={busy || !manual.trim()}
          onClick={() => {
            setBusy(true);
            setError("");
            void onCode(manual.trim())
              .catch((cause) => setError(cause.message))
              .finally(() => setBusy(false));
          }}
        >
          Consultar código
        </button>
        <button type="button" onClick={onClose}>
          Fechar leitor
        </button>
      </div>
    </section>
  );
}
