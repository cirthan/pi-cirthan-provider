/**
 * Cirthan Provider Extension
 *
 * Cirthan provider for pi.
 *
 * - Registers a provider using Cirthan's OpenAI-compatible API
 * - Fetches /v1/models on session start to filter which models are enabled
 * - Provides hardcoded model configs with metadata
 */

import {
	type ExtensionAPI,
	type ExtensionContext,
	type ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";

// =============================================================================
// Types (OpenAI /models compatible)
// =============================================================================

type OpenAIModel = {
	id: string;
	object?: string;
	created?: number;
	owned_by?: string;
	root?: string;
	parent?: string;
	max_model_len?: number;
	contextWindow?: number;
};

type OpenAIModelsResponse = {
	object?: string;
	data: OpenAIModel[];
};

// =============================================================================
// Configuration
// =============================================================================

const CIRTHAN_API_BASE_URL = (process.env.CIRTHAN_BASE_URL ?? "https://api.cirthan.com/v1").replace(/\/+$/, "");
const CIRTHAN_MODELS_ENDPOINT = `${CIRTHAN_API_BASE_URL}/models`;

/** Default model for this provider. */
const CIRTHAN_DEFAULT_MODEL_ID = "glm-4.7-flash";

// =============================================================================
// Hardcoded model configs
// =============================================================================

/** Hardcoded model configurations - exactly matching /v1/models response. */
const HARDCODED_MODELS: ProviderModelConfig[] = [
	{
		id: "glm-4.7-flash",
		name: "glm-4.7-flash",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 131072,
	},
	{
		id: "qwen3-vl-8b-instruct",
		name: "qwen3-vl-8b-instruct",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 32768,
	},
	{
		id: "minimax-m2.5",
		name: "minimax-m2.5",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 196608,
		maxTokens: 131072,
	},
];

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

async function hasCirthanApiKey(ctx: ExtensionContext): Promise<boolean> {
	if (process.env.CIRTHAN_API_KEY) return true;
	try {
		const authKey = await ctx.modelRegistry.getApiKeyForProvider("cirthan");
		return !!authKey;
	} catch {
		return false;
	}
}

// =============================================================================
// Model fetching + filtering
// =============================================================================

/**
 * Verify models are enabled by fetching /v1/models.
 *
 * API is the source of truth for WHAT models exist.
 * HARDCODED_MODELS provide enriched metadata (reasoning, cost, input types, etc.)
 * that the API may not return.
 *
 * For each model in the API response:
 * - Merge with hardcoded entry to get full metadata
 * - Use API's max_model_len/contextWindow for limits
 * - Lean on hardcoded for other fields
 */
async function fetchAndFilterModels(apiKey?: string): Promise<ProviderModelConfig[]> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5000);

	try {
		const headers: Record<string, string> = {
			Accept: "application/json",
		};
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

		console.log(`[Cirthan Provider] Fetching enabled models from: ${CIRTHAN_MODELS_ENDPOINT}`);
		const response = await fetch(CIRTHAN_MODELS_ENDPOINT, { headers, signal: controller.signal });
		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Failed to fetch models: ${response.status} ${response.statusText} - ${errorText}`);
		}

		const data = (await response.json()) as OpenAIModelsResponse;

		// Build map of model ID from API responses (API is source of truth)
		const apiModelContexts = new Map<string, number>();
		for (const model of data.data ?? []) {
			apiModelContexts.set(
				model.id.toLowerCase(),
				model.max_model_len ?? model.contextWindow ?? 0
			);
		}

		console.log(`[Cirthan Provider] API returned ${apiModelContexts.size} enabled models`);

		// Merge API models with hardcoded metadata
		// For each API model, try to find matching config in HARDCODED_MODELS
		const models = data.data ?? [];

		// Try to match each API model by ID (case-insensitive)
		const registered = models.map((apiModel) => {
			const apiId = apiModel.id.toLowerCase();
			const matchedHardcoded = HARDCODED_MODELS.find(
				(hc) => hc.id.toLowerCase() === apiId
			);

			const contextWindow = apiModel.max_model_len ?? apiModel.contextWindow ?? 0;

			// Start with hardcoded metadata if available, otherwise use API values
			const config: ProviderModelConfig = matchedHardcoded
				? {
						...matchedHardcoded,
						contextWindow,
						maxTokens: matchedHardcoded.maxTokens,
					}
				: {
						id: apiModel.id,
						name: apiModel.id,
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow,
						maxTokens: 8192,
					};

			return config;
		});

		// Sort with default model first, then alphabetical
		registered.sort((a, b) => {
			if (a.id === CIRTHAN_DEFAULT_MODEL_ID) return -1;
			if (b.id === CIRTHAN_DEFAULT_MODEL_ID) return 1;
			return a.id.localeCompare(b.id);
		});

		console.log(`[Cirthan Provider] Registered ${registered.length} model configs for provider 'cirthan'`);
		return registered;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === "AbortError" || message.includes("aborted")) {
			console.warn("[Cirthan Provider] Model fetch timed out after 5s");
		} else {
			console.error("[Cirthan Provider] Failed to fetch models:", error);
		}
		// On error, fall back to hardcoded models for stability
		console.log("[Cirthan Provider] Fallback to all hardcoded models");
		return [...HARDCODED_MODELS];
	} finally {
		clearTimeout(timeout);
	}
}

// =============================================================================
// Extension entry point
// =============================================================================

export default function (pi: ExtensionAPI) {
	// Initial registration must happen synchronously (see synthetic provider).
	pi.registerProvider("cirthan", {
		baseUrl: CIRTHAN_API_BASE_URL,
		apiKey: "CIRTHAN_API_KEY",
		api: "openai-completions",
		models: HARDCODED_MODELS,
	});

	pi.on("session_start", async (_event, ctx) => {
		const hasKey = await hasCirthanApiKey(ctx);
		const apiKey = await getCirthanApiKey(ctx);

		if (!hasKey) {
			console.log("[Cirthan Provider] API key not configured.");
			console.log("[Cirthan Provider] Options:");
			console.log("  1. Set CIRTHAN_API_KEY environment variable");
			console.log("  2. Add to ~/.pi/agent/auth.json (provider: \"cirthan\")");
		}

		const models = await fetchAndFilterModels(apiKey);
		ctx.modelRegistry.registerProvider("cirthan", {
			baseUrl: CIRTHAN_API_BASE_URL,
			apiKey: "CIRTHAN_API_KEY",
			api: "openai-completions",
			models,
		});
	});

}
