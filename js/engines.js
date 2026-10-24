// Deux moteurs, tous deux utilisables sans Internet :
//  - "webllm" : le modèle tourne dans le navigateur (WebGPU), téléchargé une seule fois puis mis en cache ;
//  - "api"    : un serveur local compatible OpenAI (Ollama, LM Studio, llama.cpp…).

export const CONTEXT_TOKENS = 8192;
const PREFILL_CHUNK = 64;

// Modèles proposés (identifiants du catalogue WebLLM), du plus léger au plus capable.
export const WEBLLM_MODELS = [
  { id: "Qwen3.5-2B-q4f16_1-MLC", label: "Qwen 3.5 2B — très léger" },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B — léger" },
  { id: "Qwen3.5-4B-q4f16_1-MLC", label: "Qwen 3.5 4B — recommandé" },
  { id: "Phi-4-mini-instruct-q4f16_1-MLC", label: "Phi-4 mini 3.8B" },
  { id: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC", label: "Mistral 7B v0.3 — bon en français" },
  { id: "Llama-3.1-8B-Instruct-q4f16_1-MLC", label: "Llama 3.1 8B" },
  { id: "gemma-2-9b-it-q4f16_1-MLC", label: "Gemma 2 9B" },
  { id: "Qwen3.5-9B-q4f16_1-MLC", label: "Qwen 3.5 9B — le meilleur, lourd" },
];

function gpuError(e) {
  if (!/device.*lost|lost.*device|mapAsync|out of memory|GPUBuffer/i.test(String(e?.message || e))) return e;
  return new Error(
    "La carte graphique a abandonné (mémoire graphique insuffisante ou calcul trop long). Réessaie : le modèle va être rechargé. Si ça recommence, choisis un modèle plus léger dans les réglages, ou recharge la page."
  );
}

let webllm = null;
const loadLib = async () => (webllm ??= await import("../vendor/web-llm/index.js"));

export async function webllmInfo(modelId) {
  const lib = await loadLib();
  const rec = lib.prebuiltAppConfig.model_list.find((m) => m.model_id === modelId);
  let cached = false;
  try {
    cached = await lib.hasModelInCache(modelId);
  } catch {}
  return { vram: rec?.vram_required_MB, cached };
}

export async function deleteWebllmModel(modelId) {
  const lib = await loadLib();
  await lib.deleteModelAllInfoInCache(modelId);
}

class WebLLMEngine {
  constructor() {
    this.engine = null;
    this.modelId = null;
  }

  async load(modelId, onProgress) {
    if (this.engine && this.modelId === modelId) return;
    if (!navigator.gpu) {
      throw new Error(
        "WebGPU n'est pas disponible dans ce navigateur. Utilisez Chrome, Edge ou Safari récent, ou passez au moteur « Serveur local » dans les réglages."
      );
    }
    const lib = await loadLib();
    // Certains GPU ne gèrent pas le f16 : on bascule alors sur la variante f32 du même modèle.
    const adapter = await navigator.gpu.requestAdapter();
    let id = modelId;
    if (adapter && !adapter.features.has("shader-f16") && id.includes("q4f16_1")) {
      const alt = id.replace("q4f16_1", "q4f32_1");
      if (lib.prebuiltAppConfig.model_list.some((m) => m.model_id === alt)) id = alt;
    }
    await this.reset();
    try {
      this.engine = await lib.CreateMLCEngine(
        id,
        { initProgressCallback: (r) => onProgress?.(r.progress, r.text) },
        // Traité d'un bloc, le prompt dépasse le délai que macOS accorde au GPU
        // (« Device is lost »), surtout sur puce Intel : on le découpe en petits morceaux.
        { context_window_size: CONTEXT_TOKENS, prefill_chunk_size: PREFILL_CHUNK }
      );
    } catch (e) {
      throw gpuError(e);
    }
    this.modelId = modelId;
  }

  // Après une erreur GPU le moteur est inutilisable : on l'oublie pour qu'il soit rechargé.
  async reset() {
    const engine = this.engine;
    this.engine = null;
    this.modelId = null;
    try {
      await engine?.unload();
    } catch {}
  }

  async stream(messages, onDelta, signal, opts) {
    const onAbort = () => this.engine?.interruptGenerate();
    signal.addEventListener("abort", onAbort);
    try {
      const req = { messages, stream: true, temperature: opts.temperature };
      if (/^Qwen3/.test(this.modelId)) req.extra_body = { enable_thinking: false };
      const chunks = await this.engine.chat.completions.create(req);
      for await (const chunk of chunks) {
        const d = chunk.choices[0]?.delta?.content;
        if (d) onDelta(d);
      }
    } catch (e) {
      if (e?.name === "AbortError" && signal.aborted) throw e;
      await this.reset();
      throw gpuError(e);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

class ApiEngine {
  constructor(base, model) {
    this.base = base.replace(/\/+$/, "");
    this.model = model;
  }

  async load() {
    if (!this.model) throw new Error("Choisissez un modèle pour le serveur local dans les réglages.");
  }

  async stream(messages, onDelta, signal, opts) {
    const res = await fetch(`${this.base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages, stream: true, temperature: opts.temperature }),
      signal,
    });
    if (!res.ok) throw new Error(`Le serveur local a répondu ${res.status} : ${await res.text()}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const l = line.trim();
        if (!l.startsWith("data:")) continue;
        const data = l.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const d = JSON.parse(data).choices?.[0]?.delta?.content;
          if (d) onDelta(d);
        } catch {}
      }
    }
  }
}

export async function listApiModels(base) {
  const res = await fetch(`${base.replace(/\/+$/, "")}/models`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json.data || []).map((m) => m.id);
}

const webllmEngine = new WebLLMEngine();

export function getEngine(settings) {
  return settings.engine === "api" ? new ApiEngine(settings.apiBase, settings.apiModel) : webllmEngine;
}

export function engineModelId(settings) {
  return settings.engine === "api" ? settings.apiModel : settings.webllmModel;
}
