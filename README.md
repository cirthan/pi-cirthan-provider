# pi-cirthan-provider

Cirthan model provider for [pi](https://github.com/mariozechner/pi). Registers the `cirthan` provider using Cirthan's OpenAI-compatible API.

This package fetches models from Cirthan's `/v1/models` endpoint at session start to filter enabled models.

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
- Use default model: `pi --model cirthan`
- Use a specific model: `pi --model cirthan:glm-4.7-flash`

## Default model

The default model for this provider is:

- `glm-4.7-flash`
