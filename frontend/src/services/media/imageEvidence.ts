import type { EvidencePhotoUploadInput } from "../../types/api";

const MAX_EDGE = 1280;
const TARGET_BYTES = 700 * 1024;
const MIN_EDGE = 760;
const QUALITY_STEPS = [0.72, 0.64, 0.56, 0.5];

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Não foi possível processar ${file.name}.`));
    };
    image.src = url;
  });
}

function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Falha ao compactar a foto.")),
      "image/jpeg",
      quality,
    );
  });
}

function drawScaled(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number,
): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error("Navegador sem suporte para compactação da foto.");
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/"))
    throw new Error(`${file.name} não é uma imagem.`);

  const image = await loadImage(file);
  let canvas = drawScaled(
    image,
    image.naturalWidth,
    image.naturalHeight,
    MAX_EDGE,
  );
  let best: Blob | null = null;

  for (let resizePass = 0; resizePass < 3; resizePass += 1) {
    for (const quality of QUALITY_STEPS) {
      const candidate = await canvasToJpeg(canvas, quality);
      if (!best || candidate.size < best.size) best = candidate;
      if (candidate.size <= TARGET_BYTES) return candidate;
    }

    const currentEdge = Math.max(canvas.width, canvas.height);
    if (currentEdge <= MIN_EDGE) break;
    const nextEdge = Math.max(MIN_EDGE, Math.round(currentEdge * 0.82));
    canvas = drawScaled(canvas, canvas.width, canvas.height, nextEdge);
  }

  if (!best) throw new Error("Falha ao compactar a foto.");
  return best;
}

export async function prepareEvidencePhoto(
  file: File,
  checklistExecutionId: string,
  observation: string,
): Promise<EvidencePhotoUploadInput> {
  const compressed = await compressImage(file);
  const safeBase = file.name.replace(/\.[^.]+$/, "").trim() || "evidencia";
  return {
    checklist_execucao_id: checklistExecutionId,
    nome_arquivo: `${safeBase}.jpg`,
    mime_type: "image/jpeg",
    tamanho_bytes: compressed.size,
    arquivo: compressed,
    observacao: observation,
  };
}
