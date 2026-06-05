/**
 * Cirthan Provider Extension
 *
 * Cirthan provider for pi.
 *
 * - Registers a provider using Cirthan's OpenAI-compatible API
 * - Fetches model configs from /v1/models when authenticated
 * - Uses per-model inference defaults and thinking budgets from the API
 */

import {
	type ExtensionAPI,
	type ExtensionContext,
	type ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

import {
	type Model,
	type Api,
	type Context,
	type SimpleStreamOptions,
	type AssistantMessageEventStream,
	streamSimpleOpenAICompletions,
} from "@earendil-works/pi-ai";

// =============================================================================
// Types
// =============================================================================

interface InferenceDefaults {
	temperature: number;
	top_p: number;
	top_k: number;
	min_p: number;
	presence_penalty: number;
	repetition_penalty: number;
}

interface ThinkingBudgets {
	minimal: number;
	low: number;
	medium: number;
	high: number;
	xhigh: number;
}

interface RawModel {
	id: string;
	reasoning: boolean;
	input_modalities: string[];
	context_window?: number;
	max_tokens?: number;
	inference_defaults?: InferenceDefaults;
	thinking_budgets?: ThinkingBudgets;
}

interface ModelsSnapshot {
	object: "list";
	version: string;
	data: RawModel[];
}

const SHIPPED_SNAPSHOT = JSON.stringify({
    "object": "list",
    "version": "2026-06-02T02:06:08Z",
    "data": [
        {
            "id": "saelorn",
            "object": "model",
            "created": 0,
            "owned_by": "cirthan",
            "description": "deliberate, great for complex tasks",
            "reasoning": true,
            "input_modalities": ["text", "image"],
            "context_window": 262144,
            "max_tokens": 32768,
            "inference_defaults": { "min_p": 0, "top_k": 20, "top_p": 0.95, "temperature": 0.6, "presence_penalty": 0, "repetition_penalty": 1 },
            "thinking_budgets": { "low": 1024, "high": 4096, "xhigh": 8192, "medium": 2048, "minimal": 512 }
        },
        {
            "id": "breglan",
            "object": "model",
            "created": 0,
            "owned_by": "cirthan",
            "description": "snappy, great for everyday use",
            "reasoning": true,
            "input_modalities": ["text", "image"],
            "context_window": 262144,
            "max_tokens": 32768,
            "inference_defaults": { "min_p": 0, "top_k": 20, "top_p": 0.95, "temperature": 0.6, "presence_penalty": 0, "repetition_penalty": 1 },
            "thinking_budgets": { "low": 1024, "high": 4096, "xhigh": 8192, "medium": 2048, "minimal": 512 }
        },
        {
            "id": "whisper",
            "object": "model",
            "created": 0,
            "owned_by": "cirthan",
            "description": "Whisper Large V3 Turbo",
            "reasoning": false,
            "input_modalities": ["audio"]
        }
    ]
});

// =============================================================================
// Configuration
// =============================================================================

const CIRTHAN_API_BASE_URL = (process.env.CIRTHAN_BASE_URL ?? "https://api.cirthan.com/v1").replace(/\/+$/, "");

// =============================================================================
// Active model metadata
// =============================================================================

let activeSnapshot: ModelsSnapshot | null = null;

// =============================================================================
// Auth helpers
// =============================================================================

async function getCirthanApiKey(ctx: ExtensionContext): Promise<string | undefined> {
	const envKey = process.env.CIRTHAN_API_KEY;
	try {
		const authKey = await ctx.modelRegistry.getApiKeyForProvider("cirthan");
		if (authKey) return authKey;
	} catch {
		// Provider may not be registered yet.
	}
	return envKey;
}

// =============================================================================
// Snapshot loading + refresh
// =============================================================================

function loadShippedSnapshot(): ModelsSnapshot {
	return JSON.parse(SHIPPED_SNAPSHOT) as ModelsSnapshot;
}

async function loadSnapshot(apiKey?: string): Promise<ModelsSnapshot> {
	if (apiKey) {
		try {
			const response = await fetch(`${CIRTHAN_API_BASE_URL}/models`, {
				headers: { Authorization: `Bearer ${apiKey}` },
			});

			if (response.ok) {
				const fresh = (await response.json()) as ModelsSnapshot;
				activeSnapshot = fresh;
				return fresh;
			}
		} catch {
			// Network error — use the current or shipped snapshot silently.
		}
	}

	const snapshot = activeSnapshot ?? loadShippedSnapshot();
	activeSnapshot = snapshot;
	return snapshot;
}

// =============================================================================
// Model config building
// =============================================================================

function getModelsFromSnapshot(snapshot: ModelsSnapshot): ProviderModelConfig[] {
	return snapshot.data
		.filter((m) => m.input_modalities.includes("text"))
		.map((m) => {
			const config: ProviderModelConfig = {
				id: m.id,
				name: m.id,
				reasoning: m.reasoning ?? false,
				input: m.input_modalities.filter((mod) => mod === "text" || mod === "image") as ("text" | "image")[],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: m.context_window ?? 200_000,
				maxTokens: m.max_tokens ?? 32_768,
			};

			// Map thinking budgets to thinkingLevelMap
			// Pi passes options.reasoning as the ThinkingLevel enum.
			// We look up model.thinkingLevelMap[options.reasoning] in streamSimple.
			if (m.reasoning && m.thinking_budgets) {
				config.thinkingLevelMap = {
					minimal: String(m.thinking_budgets.minimal),
					low: String(m.thinking_budgets.low),
					medium: String(m.thinking_budgets.medium),
					high: String(m.thinking_budgets.high),
					xhigh: String(m.thinking_budgets.xhigh),
				};
			}

			return config;
		});
}

// =============================================================================
// Custom stream function with per-model params
// =============================================================================

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cirthanStreamSimple(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const modelInfo = activeSnapshot?.data.find((m) => m.id === model.id);
	const defaults = modelInfo?.inference_defaults;
	const hasReasoning = modelInfo?.reasoning ?? false;
	const existingOnPayload = options?.onPayload;

	return streamSimpleOpenAICompletions(model as Model<"openai-completions">, context, {
		...options,
		temperature: defaults?.temperature,
		onPayload: (payload: unknown, modelArg: Model<Api>) => {
			if (payload && typeof payload === "object") {
				const p = payload as Record<string, unknown>;

				// Apply per-model inference defaults
				if (defaults) {
					p.top_p = defaults.top_p;
					p.top_k = defaults.top_k;
					p.min_p = defaults.min_p;
					p.presence_penalty = defaults.presence_penalty;
					p.repetition_penalty = defaults.repetition_penalty;
				}

				if (hasReasoning) {
					const requestedReasoning = options?.reasoning as string | undefined;
					const budgetValue = options?.reasoning && requestedReasoning !== "off"
						? model.thinkingLevelMap?.[options.reasoning]
						: undefined;
					const enableThinking = requestedReasoning !== undefined && requestedReasoning !== "off" && budgetValue !== null;
					const extraBody = asRecord(p.extra_body);
					const chatTemplateKwargs = asRecord(extraBody.chat_template_kwargs);

					p.extra_body = {
						...extraBody,
						chat_template_kwargs: {
							...chatTemplateKwargs,
							enable_thinking: enableThinking,
						},
					};

					if (typeof budgetValue === "string") {
						p.thinking_token_budget = Number(budgetValue);
					} else if (!enableThinking) {
						p.thinking_token_budget = 0;
					} else {
						delete p.thinking_token_budget;
					}
				}
			}
			existingOnPayload?.(payload, modelArg);
		},
	});
}

// =============================================================================
// Extension entry point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	// Prefer live model metadata during extension load so the initial model registry
	// and `pi --list-models` see the current context windows.
	const initialSnapshot = await loadSnapshot(process.env.CIRTHAN_API_KEY);
	const models = getModelsFromSnapshot(initialSnapshot);

	pi.registerProvider("cirthan", {
		baseUrl: CIRTHAN_API_BASE_URL,
		apiKey: "$CIRTHAN_API_KEY",
		api: "openai-completions",
		streamSimple: cirthanStreamSimple,
		models,
	});

	pi.on("session_start", async (_event, ctx) => {
		const apiKey = await getCirthanApiKey(ctx);

		if (!apiKey) {
			console.log("[Cirthan Provider] API key not configured.");
			console.log("[Cirthan Provider] Options:");
			console.log("  1. Set CIRTHAN_API_KEY environment variable");
			console.log("  2. Add to ~/.pi/agent/auth.json (provider: \"cirthan\")");
			return;
		}

		// Refresh from API when auth is available through pi's model registry.
		const snapshot = await loadSnapshot(apiKey);
		const refreshedModels = getModelsFromSnapshot(snapshot);

		ctx.modelRegistry.registerProvider("cirthan", {
			baseUrl: CIRTHAN_API_BASE_URL,
			apiKey: "$CIRTHAN_API_KEY",
			api: "openai-completions",
			streamSimple: cirthanStreamSimple,
			models: refreshedModels,
		});
	});
}
