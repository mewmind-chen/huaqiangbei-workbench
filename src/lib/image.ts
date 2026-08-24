export async function blobToJpegBase64(blob: Blob, maxW = 1280, maxH = 1800): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxW / Math.max(bitmap.width, 1), maxH / Math.max(bitmap.height, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法处理图片");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let quality = 0.9;
  let base64 = canvas.toDataURL("image/jpeg", quality).split(",")[1] || "";
  while (base64.length > 700_000 && quality > 0.45) {
    quality -= 0.12;
    base64 = canvas.toDataURL("image/jpeg", quality).split(",")[1] || "";
  }
  if (!base64) throw new Error("图片编码失败");
  return base64;
}
