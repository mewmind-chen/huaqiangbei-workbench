import { createServerFn } from "@tanstack/react-start";
import { extractTodoItems, TODO_VISION_PROMPT } from "@/lib/todo-vision";

const DEEPSEEK_MODEL = "deepseek-v4-flash-vision-exp";
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/v1/chat/completions";

export type VisionErrorCode =
  | "vision_not_configured"
  | "vision_auth_failed"
  | "vision_model_unavailable"
  | "image_too_large"
  | "vision_timeout"
  | "vision_rate_limited"
  | "vision_provider_error"
  | "invalid_model_response"
  | "no_todo_detected";

export const VISION_ERROR_MESSAGES: Record<VisionErrorCode, string> = {
  vision_not_configured: "识别服务尚未配置，请联系管理员",
  vision_auth_failed: "识别服务认证失败，请联系管理员",
  vision_model_unavailable: "识别模型暂不可用，请稍后再试",
  image_too_large: "图片过大，请换一张更小的截图",
  vision_timeout: "识别超时，请换一张更清晰的截图再试",
  vision_rate_limited: "识别请求过于频繁，请稍后再试",
  vision_provider_error: "识别服务暂时不可用，请稍后再试",
  invalid_model_response: "识别结果无法解析，请换一张更清晰的截图",
  no_todo_detected: "未识别出待办事项，请检查截图后重试",
};

export function visionErrorMessage(code: VisionErrorCode) {
  return VISION_ERROR_MESSAGES[code] || VISION_ERROR_MESSAGES.vision_provider_error;
}

type VisionResult =
  | { ok: true; text: string }
  | { ok: false; error: VisionErrorCode };

function mapProviderStatus(status: number): VisionErrorCode {
  if (status === 401 || status === 403) return "vision_auth_failed";
  if (status === 404 || status === 422) return "vision_model_unavailable";
  if (status === 408 || status === 504) return "vision_timeout";
  if (status === 429) return "vision_rate_limited";
  return "vision_provider_error";
}

async function callTodoVision(image: string, mime: string): Promise<VisionResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return { ok: false, error: "vision_not_configured" };

  try {
    const response = await fetch(DEEPSEEK_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        max_tokens: 700,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:${mime};base64,${image}` } },
              { type: "text", text: TODO_VISION_PROMPT },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return { ok: false, error: mapProviderStatus(response.status) };
    const body = (await response.json()) as {
      choices?: { message?: { content?: string | { text?: string }[] } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((part) => part?.text || "").join("")
          : "";
    if (!text.trim()) return { ok: false, error: "invalid_model_response" };
    return { ok: true, text };
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return { ok: false, error: "vision_timeout" };
    }
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "vision_timeout" };
    }
    return { ok: false, error: "vision_provider_error" };
  }
}

export const recognizeChatShot = createServerFn({ method: "POST" })
  .validator((input: { image: string; mime: string }) => input)
  .handler(async ({ data }) => {
    if (!data.image || data.image.length > 2_500_000) {
      return { ok: false as const, error: "image_too_large" as const };
    }
    const mime = data.mime === "image/png" ? "image/png" : "image/jpeg";
    const vision = await callTodoVision(data.image, mime);
    if (!vision.ok) return vision;
    try {
      return { ok: true as const, items: extractTodoItems(vision.text) };
    } catch (error) {
      const code = error instanceof Error ? error.message : "invalid_model_response";
      return {
        ok: false as const,
        error: (code === "no_todo_detected" ? code : "invalid_model_response") as VisionErrorCode,
      };
    }
  });
