# pi-cirthan-provider

Cirthan model provider for [pi](https://github.com/earendil-works/pi). Registers the `cirthan` provider using Cirthan's OpenAI-compatible API.

## Models

Models are discovered from Cirthan's `/v1/models` endpoint and cached by pi. The bundled fallback includes:

- `qwen3.6-35b-a3b`
- `qwen3.6-27b`
- `deepseek-v4-flash-0731`

Both Qwen 3.6 models support `off`, `low`, `medium`, `high`, and `xhigh` reasoning efforts.
DeepSeek V4 Flash 0731 supports `off`, `low`, and `high`. `medium`, `xhigh`, and `max` are
disabled because the served context window is limited to 180,000 tokens and the native
model exposes only low/high/max effort levels.

## Setup

Provide an API key via environment variable or `~/.pi/agent/auth.json`.

### Option 1: Environment variable

```bash
export CIRTHAN_API_KEY="..."
# optional
export CIRTHAN_BASE_URL="https://api.cirthan.com/v1"
```

### Option 2: auth.json (recommended)

Add to `~/.pi/agent/auth.json`:

```json
{
  "cirthan": {
    "type": "api_key",
    "key": "your_key_here"
  }
}
```

## Usage

- List/switch models: `pi /model`
- Use the recommended model: `pi --model cirthan/qwen3.6-35b-a3b`
- Use the other Qwen model: `pi --model cirthan/qwen3.6-27b`
