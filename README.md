<img src="./package/logo.svg" alt="Agentation" width="50" />

# Agentation (Kraka Fork)

**[Agentation](https://agentation.dev)** is an agent-agnostic visual feedback tool. Click elements on your page, add notes, and your AI coding agent receives structured annotations with selectors, positions, and context.

This is the Go-Kraka fork, installed as `agentation-monorepo` in kraka-production.

## Setup (for Kraka devs)

### 1. React component (already done)

The `<Agentation />` component is already added in `src/app/layout.tsx`:

```tsx
import { Agentation } from "agentation-monorepo";

// Inside the layout body:
<Agentation endpoint="http://localhost:4747" />
```

> **Important:** The `endpoint` prop is required. Without it, annotations only save to localStorage and never reach the MCP server.

### 2. MCP server for Claude Code

Add the MCP server to your Claude Code config (`~/.claude.json`), under your project's `mcpServers`:

```json
{
  "projects": {
    "/path/to/kraka-production": {
      "mcpServers": {
        "agentation": {
          "command": "node",
          "args": [
            "/path/to/kraka-production/node_modules/agentation-monorepo/mcp/dist/cli.js",
            "server"
          ]
        }
      }
    }
  }
}
```

Or use the CLI:

```bash
claude mcp add agentation -- node ./node_modules/agentation-monorepo/mcp/dist/cli.js server
```

Then **restart Claude Code** to load the MCP server.

### 3. Verify

1. Start the dev server (`npm run dev`)
2. Open the app in your browser — the Agentation toolbar appears in the bottom-right
3. Click an element and add an annotation
4. In Claude Code, the annotation tools (`agentation_get_all_pending`, `agentation_watch_annotations`, etc.) should pick it up

## How it works

1. You click elements in the browser and add feedback via the toolbar
2. The toolbar POSTs annotations to `http://localhost:4747` (the HTTP server)
3. Claude Code connects to the same server via MCP (stdio) and receives the annotations
4. Claude Code can read, acknowledge, resolve, or reply to annotations

## Features

- **Click to annotate** -- click any element with automatic selector identification
- **Text selection** -- select text to annotate specific content
- **Multi-select** -- drag to select multiple elements at once
- **Area selection** -- drag to annotate any region, even empty space
- **Animation pause** -- freeze all animations (CSS, JS, videos) to capture specific states
- **Structured output** -- annotations include selectors, React component names, computed styles, and positions
- **Dark/light mode** -- matches your preference or set manually

## Requirements

- React 18+
- Node.js 18+
- Desktop browser (mobile not supported)

## License

(c) 2026 Benji Taylor -- Licensed under PolyForm Shield 1.0.0
