export async function prepareOccurrencePhoto(file: File): Promise<string> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 15 * 1024 * 1024
  )
    throw Error("Escolha uma foto JPEG, PNG ou WebP de até 15 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas"),
      scale = Math.min(1, 1280 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw Error("Não foi possível preparar a foto.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let encoded = canvas.toDataURL("image/jpeg", 0.75);
    for (const quality of [0.6, 0.45, 0.3]) {
      if (encoded.length <= 410000) break;
      encoded = canvas.toDataURL("image/jpeg", quality);
    }
    if (encoded.length > 410000)
      throw Error("A foto ainda está grande. Escolha outra imagem.");
    return encoded;
  } finally {
    URL.revokeObjectURL(url);
  }
}
