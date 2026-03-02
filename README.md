# pi-cirthan-provider

Cirthan model provider for [pi](https://github.com/mariozechner/pi). Registers the `cirthan` provider using Cirthan's OpenAI-compatible API.

## Models

- `breglan` (default): snappy, great for everyday use
- `saelorn`: deliberate, great for complex tasks

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
- Use a specific model: `pi --model cirthan:saelorn`

## Default model

The default model for this provider is:

- `breglan`
