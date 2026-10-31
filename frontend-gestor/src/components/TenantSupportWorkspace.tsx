import { useEffect, useRef, useState } from "react";
import type { GestorSession } from "../services/api/auth";
import { createTenantSupportRequest, listTenantSupportRequests, type PlatformSupportRequest } from "../services/api/platform";
import { SupportAttachments } from "./SupportAttachments";

export function TenantSupportWorkspace({ session }: { session: GestorSession }) {
  const [topic, setTopic] = useState("ERRO");
  const [module, setModule] = useState("");
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [requests, setRequests] = useState<PlatformSupportRequest[]>([]);

  useEffect(() => {
    void listTenantSupportRequests(session.token).then((result) => setRequests(result.items)).catch(() => undefined);
  }, [session.token]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (screenshots.length === 0) {
      setError("Anexe ao menos uma captura de tela.");
      return;
    }
    setSending(true);
    setError("");
    setReference("");
    try {
      const created = await createTenantSupportRequest(session.token, {
        topic,
        module: module.trim(),
        summary: summary.trim(),
        technical_context: details.trim(),
        screenshots,
      });
      setReference(created.id);
      setModule("");
      setSummary("");
      setDetails("");
      setScreenshots([]);
      if (screenshotInputRef.current) screenshotInputRef.current.value = "";
      const refreshed = await listTenantSupportRequests(session.token);
      setRequests(refreshed.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir o chamado.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="tenant-support">
      <header><div><span className="eyebrow">SUPORTE VORQIX</span><h2>Abrir chamado</h2></div></header>
      <form onSubmit={(event) => void submit(event)}>
        <label>Assunto
          <select value={topic} onChange={(event) => setTopic(event.target.value)}>
            <option value="ERRO">Falha</option><option value="DESEMPENHO">Desempenho</option>
            <option value="ACESSO">Acesso</option><option value="CONFIGURACAO">Configuração</option><option value="OUTRO">Outro</option>
          </select>
        </label>
        <label>Onde aconteceu?
          <input required minLength={2} maxLength={100} value={module} onChange={(event) => setModule(event.target.value)} placeholder="Módulo ou tela" />
        </label>
        <label className="tenant-support__wide">Resumo
          <input required minLength={4} maxLength={160} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Informe o problema" />
        </label>
        <label className="tenant-support__wide">O que aconteceu?
          <textarea required minLength={4} maxLength={4000} rows={4} value={details} onChange={(event) => setDetails(event.target.value)} />
        </label>
        <label className="tenant-support__wide">Capturas de tela
          <input ref={screenshotInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            setScreenshots(files.slice(0, 3));
          }} />
          <small>{screenshots.length ? screenshots.map((file) => file.name).join(" · ") : "Até 3 imagens"}</small>
        </label>
        {error ? <div className="dashboard-error tenant-support__wide" role="alert">{error}</div> : null}
        {reference ? <div className="dashboard-notice tenant-support__wide" role="status">Chamado aberto · referência {reference}</div> : null}
        <footer className="tenant-support__wide"><button className="primary-button" type="submit" disabled={sending}>{sending ? "Enviando…" : "Enviar chamado"}</button></footer>
      </form>
      <div className="tenant-support__requests"><h3>Meus chamados</h3>{requests.length ? requests.map((item) => <article key={item.request_id}>
        <strong>{item.summary}</strong><span>{item.status} · {item.module}</span><small>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.created_at))}</small>
        <SupportAttachments token={session.token} items={item.attachments} audience="tenant" />
      </article>) : <p>Nenhum chamado aberto ainda.</p>}</div>
    </section>
  );
}
