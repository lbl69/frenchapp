// Deux moteurs :
//  - "claude" : l'API Claude d'Anthropic, appelée directement depuis le navigateur avec ta clé ;
//  - "api"    : un serveur local compatible OpenAI (Ollama, LM Studio, llama.cpp…).

// Version du SDK officiel, chargée depuis un CDN (le site n'a pas d'étape de build).
const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.132.1/+esm";

export const CLAUDE_MODELS = [
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 — rapide et économique" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — corrections plus fines" },
];

// Taille d'historique renvoyée à chaque message, en caractères (≈ 3 caractères par token).
export function historyBudget(settings) {
  return settings.engine === "claude" ? 400_000 : (8192 - 1500) * 3;
}

let sdk = null;
const loadSdk = async () => (sdk ??= await import(SDK_URL));

class ClaudeEngine {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async load() {
    if (!this.apiKey) throw new Error("Saisis ta clé API Claude dans les réglages (⚙️).");
    const { default: Anthropic } = await loadSdk();
    // La clé reste dans ce navigateur : elle n'est envoyée qu'à api.anthropic.com.
    this.client = new Anthropic({ apiKey: this.apiKey, dangerouslyAllowBrowser: true });
  }

  async stream(messages, onDelta, signal) {
    const [system, ...history] = messages;
    const params = {
      model: this.model,
      max_tokens: 64000,
      // Un tuteur qui converse : peu de réflexion, réponses rapides.
      output_config: { effort: "low" },
      // Le prompt du tuteur est identique d'un message à l'autre : on le met en cache.
      system: [{ type: "text", text: system.content, cache_control: { type: "ephemeral" } }],
      cache_control: { type: "ephemeral" },
      messages: history,
    };
    // Sur Sonnet, si un filtre de sécurité refuse à tort, l'API bascule seule sur un autre modèle.
    const stream =
      this.model === "claude-sonnet-5-5"
        ? this.client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
        : this.client.messages.stream(params);
    const onAbort = () => stream.abort();
    signal.addEventListener("abort", onAbort);
    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") onDelta(event.delta.text);
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        onDelta("\n\n*(Le modèle a refusé de répondre à ce message. Reformule-le ou passe à autre chose.)*");
      }
    } catch (e) {
      throw claudeError(e, signal);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

function claudeError(e, signal) {
  const E = sdk;
  if (signal.aborted || e instanceof E.APIUserAbortError) {
    const abort = new Error("Arrêté");
    abort.name = "AbortError";
    return abort;
  }
  if (e instanceof E.AuthenticationError) return new Error("Clé API refusée. Vérifie-la dans les réglages (⚙️).");
  if (e instanceof E.PermissionDeniedError) return new Error("Cette clé API n'a pas accès à ce modèle.");
  if (e instanceof E.RateLimitError) return new Error("Trop de requêtes, ou crédit épuisé sur ton compte Anthropic. Réessaie dans un instant.");
  if (e instanceof E.BadRequestError) {
    const msg = e.error?.error?.message || e.message;
    if (/credit|billing/i.test(msg)) return new Error("Crédit insuffisant sur ton compte Anthropic (console.anthropic.com → Billing).");
    return new Error(`Requête refusée par l'API : ${msg}`);
  }
  if (e instanceof E.InternalServerError) return new Error("L'API Claude est momentanément indisponible. Réessaie dans un instant.");
  if (e instanceof E.APIConnectionError) return new Error("Impossible de joindre l'API Claude. Vérifie ta connexion Internet.");
  return e;
}

class ApiEngine {
  constructor(base, model) {
    this.base = base.replace(/\/+$/, "");
    this.model = model;
  }

  async load() {
    if (!this.model) throw new Error("Choisissez un modèle pour le serveur local dans les réglages.");
  }

  async stream(messages, onDelta, signal) {
    const res = await fetch(`${this.base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages, stream: true }),
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

export function getEngine(settings) {
  return settings.engine === "api"
    ? new ApiEngine(settings.apiBase, settings.apiModel)
    : new ClaudeEngine(settings.claudeKey, settings.claudeModel);
}
