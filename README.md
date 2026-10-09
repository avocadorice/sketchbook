# Sketchbook

A dark Excalidraw workspace for working through system designs. Keep numbered attempts, edit ordered checkpoints, and ask an AI tutor about a specific part of your diagram without scattering the conversation across providers.

- **Attempts and Tutor stay visible together**, with independent show/hide controls.
- **Search** drawing titles and text inside any saved checkpoint or draft.
- **Checkpoints** have inline titles, reorder controls, deletion with immediate undo, and incremental or clean-slate starts.
- **Focus area** draws a temporary overlay, separate from the drawing. The tutor receives a cropped image and scene content within the region.
- **One conversation per attempt** survives agent switches and device changes. A question at checkpoint 3 includes checkpoints 1–2; later checkpoint scenes and conversations are excluded. The full transcript remains visible.
- **Native macOS app**, or use a browser over your Tailscale network.

## Run

Requires Node 20.19+ or 22.12+, Python 3.10+, and macOS for the native wrapper and subscription CLI adapters.

```sh
npm ci
npm run build
python3 scripts/practice_server.py --host 127.0.0.1
```

Open http://localhost:8095/static/practice/index.html. For access across devices, run one host and proxy port 8095 through Tailscale Serve. Point every device at that same HTTPS address. The host must stay awake. Do not expose this personal server to the public internet: it has no application sign-in and trusts network access.

```sh
tailscale serve --bg http://localhost:8095
```

The server defaults to listening on all interfaces for LAN compatibility; `--host 127.0.0.1` limits access to loopback and the Tailscale proxy. It accepts loopback, private-network and tailnet clients. JSON mutations require a custom header and do not allow cross-origin access.

## macOS app

```sh
SKETCHBOOK_URL='https://your-host.your-tailnet.ts.net/static/practice/index.html' bash mac/build.sh
open ~/Applications/Sketchbook.app
```

The wrapper uses WKWebView, native file dialogs, dark appearance and normal Mac keyboard shortcuts. Build with Xcode Command Line Tools. It connects to your host; it does not start a second library. The application is locally signed, not notarized. An installed app's URL can be changed with:

```sh
defaults write com.barney.sketchbook.app SketchbookURL 'https://your-host.your-tailnet.ts.net/static/practice/index.html'
```

## Subscription tutors

Install and sign in to the providers' official CLIs **on the host Mac**:

- ChatGPT: `codex login`, using a ChatGPT plan. Default model: GPT-5.6 Luna, low or medium reasoning.
- Claude: `claude auth login`, using a Claude subscription. Default: Sonnet, low or medium effort.
- Gemini: `agy`, using a Google AI subscription. Default: Gemini 3.6 Flash, low or medium. Google's Antigravity CLI replaces the retired personal Gemini CLI.

The adapters invoke these signed-in clients with an environment that excludes API keys. There is no fallback to separately configured API credentials. Provider plan limits and any account-level extra-usage settings still apply. Model availability changes; defaults live in `scripts/tutor.py`. Only the selected provider receives each submitted question and its relevant conversation/diagram context. Existing conversations in provider websites are not imported automatically, and hidden model reasoning is not transferred.

ChatGPT and Claude tools are disabled. Gemini uses Antigravity's sandbox and reads the request's conversation/image files in a dedicated working directory. Antigravity's own permissions still apply; use this as a personal trusted workspace, not a multi-user agent service.

References: [Codex authentication](https://learn.chatgpt.com/docs/auth), [Claude subscription usage](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), [Antigravity authentication](https://www.antigravity.google/docs/cli/install/), [Antigravity headless mode](https://www.antigravity.google/docs/cli/headless/).

## Data and behavior

Personal data stays in `.local/`, excluded from Git:

- `.local/practice/project.json`: drawings, embedded images, checkpoint deltas and drafts.
- `.local/practice/backups/`: first pre-save snapshot each day.
- `.local/tutor/conversations.sqlite`: shared conversations, checkpoint context and job status.
- `.local/tutor/`: submitted PNGs and local provider diagnostics.

Back up **all of `.local/`**, preferably while the server is stopped. Export whole library includes drawing data; Tutor's Export downloads the visible conversation. A complete migration, including images attached to chats, requires copying `.local/`. Imports get new attempt IDs, so importing a duplicate never mixes its tutor conversation with the original.

Saves use optimistic revisions. Two devices can read the same library; a stale editor cannot overwrite another device's changes. Reload a stale editor after exporting any unsaved draft.

Deleting a checkpoint removes its changes and rebuilds later incremental checkpoints. A clean-slate checkpoint creates an explicit boundary, so earlier edits cannot reappear through it. Switching checkpoints retains unsaved drafts. Undo restores the most recent deletion until another drawing mutation or navigation; daily backups provide additional recovery. Removed attempt conversations remain on disk for recovery. Legacy notes and timing data are preserved in storage/import/export, though their controls are no longer shown.

The historical `/static/practice/` URL and browser storage IDs remain for compatibility. Source is independent of its original interview-practice workspace.

## Development

```sh
npm run dev
npm run check
npm test
npm run build
python3 -m pip install pytest
python3 -m pytest tests -q
```

Frontend tests cover checkpoint replay, clean-slate boundaries, draft preservation, storage revisions, imports, search and tutor context. Server tests cover persistence, conflicts, input validation, cancellation/retry, cross-provider history and exclusion of future checkpoint conversations. Provider smoke tests require your own signed-in subscriptions.
