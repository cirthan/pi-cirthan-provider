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

/** Shared compat flags for all Cirthan models (OpenAI-compatible API). */
const CIRTHAN_COMPAT = {
	supportsDeveloperRole: false,
	supportsUsageInStreaming: false,
	supportsStore: false,
	requiresToolResultName: true,
} as const;

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
		maxTokens: 128000,
		compat: CIRTHAN_COMPAT,
	},
	{
		id: "qwen3-vl-8b-instruct",
		name: "qwen3-vl-8b-instruct",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 32768,
		compat: CIRTHAN_COMPAT,
	},
	{
		id: "minimax-m2.5",
		name: "minimax-m2.5",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 128000,
		compat: CIRTHAN_COMPAT,
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
 * Returns hardcoded configs filtered to only include enabled models.
 */
async function fetchAndFilterModels(apiKey?: string): Promise<ProviderModelConfig[]> {
	try {
		const headers: Record<string, string> = {
			Accept: "application/json",
		};
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

		console.log(`[Cirthan Provider] Fetching enabled models from: ${CIRTHAN_MODELS_ENDPOINT}`);
		const response = await fetch(CIRTHAN_MODELS_ENDPOINT, { headers });
		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Failed to fetch models: ${response.status} ${response.statusText} - ${errorText}`);
		}

		const data = (await response.json()) as OpenAIModelsResponse;
		const enabledModelIds = new Set((data.data ?? []).map((m) => m.id));

		console.log(`[Cirthan Provider] API returned ${enabledModelIds.size} enabled models`);

		// Filter: only include models that are enabled in the API
		// Always include default model regardless of API response
		const filtered = HARDCODED_MODELS.filter((model) => {
			if (model.id === CIRTHAN_DEFAULT_MODEL_ID) return true;
			return enabledModelIds.has(model.id);
		});

		// Sort with default model first, then alphabetical
		filtered.sort((a, b) => {
			if (a.id === CIRTHAN_DEFAULT_MODEL_ID) return -1;
			if (b.id === CIRTHAN_DEFAULT_MODEL_ID) return 1;
			return a.id.localeCompare(b.id);
		});

		console.log(`[Cirthan Provider] Registered ${filtered.length} model configs for provider 'cirthan'`);
		return filtered;
	} catch (error) {
		console.error("[Cirthan Provider] Failed to fetch models:", error);
		// On error, return all hardcoded models as fallback
		console.log("[Cirthan Provider] Using all hardcoded models as fallback");
		return [...HARDCODED_MODELS];
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
