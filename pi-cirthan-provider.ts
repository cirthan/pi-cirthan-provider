/**
 * Cirthan Provider Extension
 *
 * Cirthan provider for pi.
 *
 * - Registers a provider using Cirthan's OpenAI-compatible API
 * - Uses hardcoded model configs for full control
 */

import {
	type ExtensionAPI,
	type ExtensionContext,
	type ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";

import {
	type Model,
	type Api,
	type Context,
	type SimpleStreamOptions,
	type AssistantMessageEventStream,
	streamSimpleOpenAICompletions,
} from "@mariozechner/pi-ai";

/** Request extensions for models supporting reasoning traces */
interface ReasoningRequest {
	extra_body?: {
		chat_template_kwargs?: {
			enable_thinking?: boolean;
		};
	};
	thinking_token_budget?: number;
}

// =============================================================================
// Configuration
// =============================================================================

const CIRTHAN_API_BASE_URL = (process.env.CIRTHAN_BASE_URL ?? "https://api.cirthan.com/v1").replace(/\/+$/, "");

/** Default model for this provider. */
const CIRTHAN_DEFAULT_MODEL_ID = "breglan";

/** Default sampling parameters for precise coding tasks. */
const CIRTHAN_SAMPLING_PARAMS = {
	temperature: 0.6,
	top_p: 0.95,
	top_k: 20,
	min_p: 0.0,
	presence_penalty: 0.0,
	repetition_penalty: 1.0,
};

const DEFAULT_THINKING_BUDGETS = {
	minimal: 512,
	low: 1024,
	medium: 2048,
	high: 4096,
	xhigh: 8192,
} as const;

// =============================================================================
// Hardcoded model configs
// =============================================================================

/** Hardcoded model configurations. */
const HARDCODED_MODELS: ProviderModelConfig[] = [
	{
		id: CIRTHAN_DEFAULT_MODEL_ID,
		name: CIRTHAN_DEFAULT_MODEL_ID,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 32768,
	},
	{
		id: "saelorn",
		name: "saelorn",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 32768,
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

/** Return hardcoded models. */
function getModels(): ProviderModelConfig[] {
	return [...HARDCODED_MODELS];
}

// =============================================================================
// Custom stream function with sampling params
// =============================================================================

function modelSupportsThinking(modelId: string): boolean {
	return HARDCODED_MODELS.some((model) => model.id === modelId && model.reasoning);
}

function normalizeThinkingLevel(
	level: unknown,
): keyof typeof DEFAULT_THINKING_BUDGETS | "off" {
	if (
		level === "minimal" ||
		level === "low" ||
		level === "medium" ||
		level === "high" ||
		level === "xhigh" ||
		level === "off"
	) {
		return level;
	}
	return "medium";
}

function getThinkingTokenBudget(
	level: keyof typeof DEFAULT_THINKING_BUDGETS,
	customBudgets?: Partial<Record<keyof typeof DEFAULT_THINKING_BUDGETS, number>>,
): number {
	return customBudgets?.[level] ?? DEFAULT_THINKING_BUDGETS[level];
}

function cirthanStreamSimple(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const existingOnPayload = options?.onPayload;

	return streamSimpleOpenAICompletions(model as Model<"openai-completions">, context, {
		...options,
		temperature: CIRTHAN_SAMPLING_PARAMS.temperature,
		onPayload: (payload: unknown, modelArg: Model<Api>) => {
			if (payload && typeof payload === "object") {
				const p = payload as Record<string, unknown> & ReasoningRequest;
				p.top_p = CIRTHAN_SAMPLING_PARAMS.top_p;
				p.top_k = CIRTHAN_SAMPLING_PARAMS.top_k;
				p.min_p = CIRTHAN_SAMPLING_PARAMS.min_p;
				p.presence_penalty = CIRTHAN_SAMPLING_PARAMS.presence_penalty;
				p.repetition_penalty = CIRTHAN_SAMPLING_PARAMS.repetition_penalty;

				if (modelSupportsThinking(model.id)) {
					const thinkingLevel = normalizeThinkingLevel(options?.reasoning);
					const enableThinking = thinkingLevel !== "off";
					p.extra_body = {
						...(p.extra_body ?? {}),
						chat_template_kwargs: {
							...(p.extra_body?.chat_template_kwargs ?? {}),
							enable_thinking: enableThinking,
						},
					};
					if (thinkingLevel !== "off") {
						p.thinking_token_budget = getThinkingTokenBudget(
							thinkingLevel,
							options?.thinkingBudgets,
						);
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

export default function (pi: ExtensionAPI) {
	// Initial registration must happen synchronously (see synthetic provider).
	pi.registerProvider("cirthan", {
		baseUrl: CIRTHAN_API_BASE_URL,
		apiKey: "CIRTHAN_API_KEY",
		api: "openai-completions",
		streamSimple: cirthanStreamSimple,
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

		const models = getModels();
		ctx.modelRegistry.registerProvider("cirthan", {
			baseUrl: CIRTHAN_API_BASE_URL,
			apiKey: "CIRTHAN_API_KEY",
			api: "openai-completions",
			streamSimple: cirthanStreamSimple,
			models,
		});
	});

}
