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
// Types (Cirthan /info compatible)
// =============================================================================

type CirthanModelInfo = {
	id: string;
	max_input_tokens: number | null;
	max_output_tokens: number | null;
	mode: "chat" | "completion" | "embedding" | "audio";
	supports_vision: boolean;
	supports_audio_input: boolean;
	supports_reasoning: boolean;
};

type CirthanInfoResponse = {
	data: CirthanModelInfo[];
};

// =============================================================================
// Configuration
// =============================================================================

const CIRTHAN_API_BASE_URL = (process.env.CIRTHAN_BASE_URL ?? "https://api.cirthan.com/v1").replace(/\/+$/, "");
const CIRTHAN_INFO_ENDPOINT = `${CIRTHAN_API_BASE_URL}/info`;

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
 * Fetch and filter models from authoritative /info endpoint.
 *
 * The /info endpoint is the source of truth for WHAT models exist.
 * HARDCODED_MODELS provide enriched metadata (contextWindow, maxTokens, cost, etc.)
 * that the /info endpoint may not return.
 *
 * For each model in the /info response:
 * - Use supports_vision, supports_audio_input, supports_reasoning directly from API
 * - Use mode to determine input types
 * - Merge with hardcoded entry for contextWindow, maxTokens, cost
 * - Fall back to API values if no hardcoded entry exists
 */
async function fetchAndFilterModels(apiKey?: string): Promise<ProviderModelConfig[]> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5000);

	try {
		const headers: Record<string, string> = {
			Accept: "application/json",
		};
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

		console.log(`[Cirthan Provider] Fetching enabled models from: ${CIRTHAN_INFO_ENDPOINT}`);
		const response = await fetch(CIRTHAN_INFO_ENDPOINT, { headers, signal: controller.signal });
		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Failed to fetch models: ${response.status} ${response.statusText} - ${errorText}`);
		}

		const data = (await response.json()) as CirthanInfoResponse;
		const models = data.data ?? [];

		console.log(`[Cirthan Provider] API returned ${models.length} enabled models`);

		// Map each API model to ProviderModelConfig
		const registered = models.map((apiModel) => {
			// Determine input types based on mode and capabilities
			// Note: ProviderModelConfig.input only supports "text" | "image"
			const inputTypes: ("text" | "image")[] = ["text"];
			if (apiModel.supports_vision) inputTypes.push("image");

			// Try to match with hardcoded metadata
			const matchedHardcoded = HARDCODED_MODELS.find(
				(hc) => hc.id.toLowerCase() === apiModel.id.toLowerCase()
			);

			// Use hardcoded values for contextWindow and maxTokens if available,
			// otherwise use defaults based on mode
			const contextWindow = matchedHardcoded?.contextWindow ?? 128000;
			const maxTokens = matchedHardcoded?.maxTokens ?? 8192;

			const config: ProviderModelConfig = {
				id: apiModel.id,
				name: apiModel.id,
				reasoning: apiModel.supports_reasoning,
				input: inputTypes as any,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow,
				maxTokens,
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
