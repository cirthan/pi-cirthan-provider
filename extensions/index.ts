/**
 * Cirthan Provider Extension
 *
 * Cirthan provider for pi.
 *
 * - Registers a provider using Cirthan's OpenAI-compatible API
 * - Fetches /v1/models on session start to filter which models are enabled
 * - Provides hardcoded model configs with metadata
 * - Provides /cirthan-models command to browse and switch models (interactive UI)
 */

import {
	DynamicBorder,
	type ExtensionAPI,
	type ExtensionContext,
	type ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { Box, Container, type SelectItem, SelectList, type SelectListTheme, Spacer, Text } from "@mariozechner/pi-tui";

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

const AUTH_JSON_PATH = "~/.pi/agent/auth.json";

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
		const filtered = HARDCODED_MODELS.filter((model) => enabledModelIds.has(model.id));

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
// UI helpers (/cirthan-models)
// =============================================================================

const CATALOG_MODEL_COL = 38;
const CATALOG_INPUT_COL = 9;
const CATALOG_REASON_COL = 9;

function truncateWithEllipsis(text: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";
	if (text.length <= maxWidth) return text;
	if (maxWidth === 1) return "…";
	return `${text.slice(0, maxWidth - 1)}…`;
}

function formatCatalogHeader(): string {
	const model = "Model".padEnd(CATALOG_MODEL_COL);
	const input = "Input".padEnd(CATALOG_INPUT_COL);
	const reason = "Reason".padEnd(CATALOG_REASON_COL);
	return `${model} ${input} ${reason}`;
}

function formatCatalogRow(model: ProviderModelConfig): string {
	const id = truncateWithEllipsis(model.id, CATALOG_MODEL_COL).padEnd(CATALOG_MODEL_COL);
	const input = (model.input ?? ["text"]).join("+").padEnd(CATALOG_INPUT_COL);
	const reason = (model.reasoning ? "yes" : "no").padEnd(CATALOG_REASON_COL);
	return `${id} ${input} ${reason}`;
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
			console.log(`  2. Add to ${AUTH_JSON_PATH} (provider: "cirthan")`);
		}

		const models = await fetchAndFilterModels(apiKey);
		ctx.modelRegistry.registerProvider("cirthan", {
			baseUrl: CIRTHAN_API_BASE_URL,
			apiKey: "CIRTHAN_API_KEY",
			api: "openai-completions",
			models,
		});
	});

	pi.on("model_select", async (event, ctx) => {
		if (event.model.provider === "cirthan") {
			const modelName = event.model.name || event.model.id;
			ctx.ui.notify(`Using Cirthan model: ${modelName}`, "info");
		}
	});

	pi.registerCommand("cirthan-models", {
		description: "Display all available Cirthan models and switch the active model",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				console.log("[Cirthan Provider] /cirthan-models requires interactive mode");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current response to finish before switching models", "warning");
				return;
			}

			ctx.ui.notify("Fetching model list from Cirthan API...", "info");

			try {
				const apiKey = await getCirthanApiKey(ctx);
				const models = await fetchAndFilterModels(apiKey);

				if (models.length === 0) {
					ctx.ui.notify("No models returned by Cirthan API", "warning");
					return;
				}

				const items: SelectItem[] = models.map((m) => ({
					value: m.id,
					label: formatCatalogRow(m),
				}));

				let overlayRows = 44;
				let overlayCols = 120;

				await ctx.ui.custom<void>(
					(tui, theme, _keybindings, done) => {
						overlayRows = tui.terminal.rows;
						overlayCols = tui.terminal.columns;

						const selectTheme: SelectListTheme = {
							selectedPrefix: (text) => theme.fg("accent", text),
							selectedText: (text) => theme.fg("accent", text),
							description: (text) => theme.fg("muted", text),
							scrollInfo: (text) => theme.fg("dim", text),
							noMatch: (text) => theme.fg("warning", text),
						};

						const listMaxVisible = Math.max(6, Math.min(14, overlayRows - 18));
						const selectList = new SelectList(items, Math.min(items.length, listMaxVisible), selectTheme);
						const detailsText = new Text("", 1, 0);

						const updateDetails = (modelId: string | undefined) => {
							if (!modelId) {
								detailsText.setText(theme.fg("muted", "No model selected"));
								return;
							}

							const m = models.find((x) => x.id === modelId);
							if (!m) {
								detailsText.setText(theme.fg("muted", "No model selected"));
								return;
							}

							const lines = [
								theme.fg("accent", theme.bold("Selected model")),
								`${theme.fg("muted", "ID:")} ${m.id}`,
								`${theme.fg("muted", "Input:")} ${(m.input ?? ["text"]).join("+")}`,
								`${theme.fg("muted", "Reasoning:")} ${m.reasoning ? "yes" : "no"}`,
								"",
								`${theme.fg("muted", "Use with:")} cirthan:${m.id}`,
							];
							detailsText.setText(lines.join("\n"));
						};

						const initial = items[0];
						updateDetails(initial?.value);

						selectList.onSelectionChange = (item) => {
							updateDetails(item.value);
							tui.requestRender();
						};

						selectList.onSelect = (item) => {
							void (async () => {
								const registryModel = ctx.modelRegistry.find("cirthan", item.value);
								if (!registryModel) {
									ctx.ui.notify(`Model cirthan:${item.value} is not registered in pi`, "warning");
									return;
								}

								const switched = await pi.setModel(registryModel);
								if (!switched) {
									ctx.ui.notify(`No API key available for cirthan:${item.value}`, "error");
									return;
								}

								ctx.ui.notify(`Switched model to cirthan:${item.value}`, "info");
								done(undefined);
							})();
						};

						selectList.onCancel = () => done(undefined);

						const container = new Container();
						container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
						container.addChild(new Text(theme.fg("accent", theme.bold("Cirthan Model Catalog")), 1, 0));
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", formatCatalogHeader()), 1, 0));
						container.addChild(new DynamicBorder((s: string) => theme.fg("muted", s)));
						container.addChild(selectList);
						container.addChild(new DynamicBorder((s: string) => theme.fg("muted", s)));
						container.addChild(new Spacer(1));
						container.addChild(detailsText);
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", "↑↓ navigate · Enter switches · Esc closes"), 1, 0));
						container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

						const panel = new Box(0, 0, (s: string) => theme.bg("customMessageBg", s));
						panel.addChild(container);

						return {
							render: (width) => panel.render(width),
							invalidate: () => panel.invalidate(),
							handleInput: (data) => {
								selectList.handleInput(data);
								tui.requestRender();
							},
						};
					},
					{
						overlay: true,
						overlayOptions: () => {
							const width = overlayCols < 100 ? "98%" : "90%";
							if (overlayRows < 34) {
								return { width: "100%", maxHeight: "94%", anchor: "center" as const, margin: 0 };
							}
							return { width, maxHeight: "80%", anchor: "bottom-center" as const, offsetY: -4, margin: 1 };
						},
					},
				);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to fetch models: ${errorMessage}`, "error");
				console.error("[Cirthan Provider] Model listing failed:", error);
			}
		},
	});
}
