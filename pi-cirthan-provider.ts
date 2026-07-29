import {
	type ExtensionAPI,
	type ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	type Api,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type RefreshModelsContext,
	type SimpleStreamOptions,
	clampThinkingLevel,
} from "@earendil-works/pi-ai";
import { streamSimple as streamSimpleOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";

const CIRTHAN_API_BASE_URL = (process.env.CIRTHAN_BASE_URL ?? "https://api.cirthan.com/v1").replace(/\/+$/, "");
const REASONING_MODELS = [
	{
		id: "qwen3.6-35b-a3b",
		cost: { input: 0.10, output: 0.90, cacheRead: 0, cacheWrite: 0 },
	},
	{
		id: "qwen3.6-27b",
		cost: { input: 0.25, output: 1.90, cacheRead: 0, cacheWrite: 0 },
	},
] satisfies ReadonlyArray<{ id: string; cost: ProviderModelConfig["cost"] }>;
const DEPRECATED_MODEL_IDS = new Set(["saelorn", "breglan"]);

const HIDDEN_THINKING_LEVELS = {
	minimal: null,
	low: null,
	medium: null,
	high: null,
	xhigh: null,
	max: null,
} satisfies NonNullable<ProviderModelConfig["thinkingLevelMap"]>;

const REASONING_MODEL_CONFIG = {
	reasoning: true,
	thinkingLevelMap: {
		off: "none",
		minimal: null,
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: "xhigh",
		max: null,
	},
	compat: {
		thinkingFormat: "chat-template",
		supportsReasoningEffort: true,
		chatTemplateKwargs: {
			enable_thinking: { $var: "thinking.enabled" },
			preserve_thinking: true,
		},
	},
} satisfies Pick<ProviderModelConfig, "reasoning" | "thinkingLevelMap" | "compat">;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function getReasoningModel(id: string) {
	return REASONING_MODELS.find((model) => model.id === id);
}

function configureModel(model: ProviderModelConfig): ProviderModelConfig {
	const reasoningModel = getReasoningModel(model.id);
	if (reasoningModel) return { ...model, ...REASONING_MODEL_CONFIG, cost: reasoningModel.cost };
	return model.reasoning ? { ...model, thinkingLevelMap: HIDDEN_THINKING_LEVELS } : model;
}

function orderModels(models: readonly ProviderModelConfig[]): ProviderModelConfig[] {
	return [...models].sort((left, right) => {
		const leftIndex = REASONING_MODELS.findIndex((model) => model.id === left.id);
		const rightIndex = REASONING_MODELS.findIndex((model) => model.id === right.id);
		const fallback = REASONING_MODELS.length;
		return (leftIndex < 0 ? fallback : leftIndex) - (rightIndex < 0 ? fallback : rightIndex);
	});
}

function modelFromCatalogEntry(value: unknown): ProviderModelConfig | undefined {
	if (!isRecord(value)) return undefined;

	const { id, reasoning, input_modalities: inputModalities } = value;
	if (
		typeof id !== "string"
		|| id.length === 0
		|| id.trim() !== id
		|| typeof reasoning !== "boolean"
		|| !Array.isArray(inputModalities)
		|| !inputModalities.every((item): item is string => typeof item === "string")
		|| !inputModalities.includes("text")
		|| DEPRECATED_MODEL_IDS.has(id)
	) {
		return undefined;
	}

	return configureModel({
		id,
		name: id,
		reasoning,
		input: inputModalities.filter((modality): modality is "text" | "image" => modality === "text" || modality === "image"),
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: isPositiveSafeInteger(value.context_window) ? value.context_window : 200_000,
		maxTokens: isPositiveSafeInteger(value.max_tokens) ? value.max_tokens : 32_768,
	});
}

function modelsFromCatalog(value: unknown): ProviderModelConfig[] {
	if (!isRecord(value) || value.object !== "list" || !Array.isArray(value.data)) {
		throw new Error("Cirthan returned an invalid model catalog");
	}

	const models: ProviderModelConfig[] = [];
	const seenIds = new Set<string>();
	for (const entry of value.data) {
		const model = modelFromCatalogEntry(entry);
		if (!model || seenIds.has(model.id)) continue;
		seenIds.add(model.id);
		models.push(model);
	}

	if (models.length === 0) throw new Error("Cirthan model catalog contains no valid text models");
	return orderModels(models);
}

function restoreModels(models: readonly Model<Api>[]): ProviderModelConfig[] {
	return orderModels(models
		.filter((model) => !DEPRECATED_MODEL_IDS.has(model.id) && model.input.includes("text"))
		.map((model) => configureModel({
			id: model.id,
			name: model.name,
			reasoning: model.reasoning,
			input: model.input,
			cost: model.cost,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
		})));
}

const BUNDLED_MODELS = REASONING_MODELS.map(({ id, cost }) => configureModel({
	id,
	name: id,
	reasoning: true,
	input: ["text", "image"],
	cost,
	contextWindow: 262_144,
	maxTokens: 32_768,
}));

async function refreshModels(
	{ credential, store, allowNetwork, signal }: RefreshModelsContext,
): Promise<ProviderModelConfig[]> {
	const stored = await store.read();
	const storedModels = stored ? restoreModels(stored.models) : [];
	const fallback = storedModels.length > 0 ? storedModels : BUNDLED_MODELS;
	if (!allowNetwork || signal?.aborted) return fallback;

	const apiKey = credential?.type === "api_key" ? credential.key : undefined;
	if (!apiKey) throw new Error("Cirthan API key is not configured");

	const response = await fetch(`${CIRTHAN_API_BASE_URL}/models`, {
		headers: { Authorization: `Bearer ${apiKey}` },
		signal,
	});
	if (!response.ok) throw new Error(`Cirthan model catalog request failed: ${response.status}`);

	const refreshed = modelsFromCatalog(await response.json());
	if (signal?.aborted) return fallback;
	await store.write({
		models: refreshed.map((model) => ({
			...model,
			api: "openai-completions",
			provider: "cirthan",
			baseUrl: CIRTHAN_API_BASE_URL,
		})),
		checkedAt: Date.now(),
	});
	return refreshed;
}

function cirthanStreamSimple(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	return streamSimpleOpenAICompletions(model as Model<"openai-completions">, context, {
		...options,
		onPayload: (payload: unknown, modelArg: Model<Api>) => {
			if (getReasoningModel(modelArg.id) && isRecord(payload)) {
				const level = clampThinkingLevel(modelArg, options?.reasoning ?? "off");
				const effort = modelArg.thinkingLevelMap?.[level];
				if (typeof effort === "string") payload.reasoning_effort = effort;
			}
			return options?.onPayload?.(payload, modelArg);
		},
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider("cirthan", {
		baseUrl: CIRTHAN_API_BASE_URL,
		apiKey: "$CIRTHAN_API_KEY",
		api: "openai-completions",
		streamSimple: cirthanStreamSimple,
		models: BUNDLED_MODELS,
		refreshModels,
	});
}
