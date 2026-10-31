"""Read a user-selected Codex session as reference data, without resuming or running it."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

THREAD_ID = r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"
LINK = re.compile(rf"codex://threads/({THREAD_ID})/?", re.IGNORECASE)
MAX_SESSION_BYTES = 32_000_000
MAX_CONTEXT_BYTES = 800_000


def session_links(question):
    links = []
    for candidate in re.findall(r"codex://[^\s<>\"']+", question, re.IGNORECASE):
        candidate = candidate.rstrip('.,;!?)]}')
        match = LINK.fullmatch(candidate)
        if not match:
            raise ValueError('Use a Codex session link like codex://threads/<thread-id>.')
        link = 'codex://threads/' + match[1].lower()
        if link not in links:
            links.append(link)
    if len(links) > 1:
        raise ValueError('Attach one Codex session per question.')
    return links


def load_session(link, codex_home=None):
    match = LINK.fullmatch(link)
    if not match:
        raise ValueError('Invalid Codex session link.')
    ident = match[1].lower()
    home = Path(codex_home) if codex_home is not None else Path(os.environ.get('CODEX_HOME') or Path.home() / '.codex')
    matches = []
    # Only the requested rollout is opened. No database, credentials, workspace files,
    # or paths mentioned by the transcript are read.
    for directory in ('sessions', 'archived_sessions'):
        root = home / directory
        if not root.is_dir():
            continue
        for path in root.rglob(f'rollout-*-{ident}.jsonl'):
            if not path.is_symlink() and path.resolve().is_relative_to(root.resolve()):
                matches.append(path)
    if not matches:
        raise ValueError('This Codex session is not saved on the host Mac. Open it in Codex on that Mac, or paste the conversation text into the tutor.')
    if len(matches) != 1:
        raise ValueError('More than one saved copy of this Codex session was found. Paste the conversation text instead.')
    path = matches[0]
    if path.stat().st_size > MAX_SESSION_BYTES:
        raise ValueError('This Codex session is too large to attach intact. Paste the relevant conversation text instead.')

    history = []
    events = []
    session_id = None
    missing_images = 0

    def reference(value):
        nonlocal missing_images
        if isinstance(value, dict):
            if value.get('type') in ('input_image', 'output_image', 'image'):
                missing_images += 1
                return {'type': 'text', 'text': '[Codex image attachment: attach this image separately in the tutor to discuss it.]'}
            return {key: reference(item) for key, item in value.items()}
        if isinstance(value, list):
            return [reference(item) for item in value]
        return value

    try:
        with path.open(encoding='utf-8') as source:
            for line in source:
                if not line.strip():
                    continue
                record = json.loads(line)
                if not isinstance(record, dict) or not isinstance(record.get('payload'), dict):
                    raise ValueError('Invalid session record.')
                kind, item = record.get('type'), record['payload']
                if kind == 'session_meta':
                    session_id = item.get('id')
                elif kind == 'response_item':
                    if item.get('type') == 'message' and item.get('role') in ('system', 'developer'):
                        continue
                    history.append(reference(item))
                elif kind == 'compacted':
                    history.append({'type': 'compaction', 'summary': item.get('message', ''),
                                    'replacementHistory': reference(item.get('replacement_history', []))})
                elif kind == 'event_msg' and item.get('type') in ('user_message', 'agent_message'):
                    event = {'type': 'message', 'role': 'user' if item['type'] == 'user_message' else 'assistant',
                             'content': item.get('message', '')}
                    events.append(event)
                    history.append(event)
    except (OSError, UnicodeError, ValueError) as error:
        raise ValueError('The saved Codex session could not be read completely. Retry after Codex finishes saving, or paste the conversation text.') from error
    if session_id != ident:
        raise ValueError('The saved Codex session does not match this link.')
    def message_key(item):
        content = item.get('content', '')
        if isinstance(content, list):
            content = '\n'.join(part.get('text', '') for part in content if isinstance(part, dict))
        return item.get('role'), content
    # Event records often mirror response messages. Keep event-only messages in their
    # original position, including a just-saved user question, without duplicating mirrors.
    event_ids = {id(event) for event in events}
    canonical = {message_key(item) for item in history if id(item) not in event_ids and item.get('type') == 'message'}
    history = [item for item in history if id(item) not in event_ids or message_key(item) not in canonical]
    if not history:
        raise ValueError('This Codex session has no saved conversation yet.')
    snapshot = {'source': 'codex-desktop', 'threadId': ident, 'link': 'codex://threads/' + ident,
                'history': history, 'recordCount': len(history), 'missingImages': missing_images}
    if len(json.dumps(snapshot).encode()) > MAX_CONTEXT_BYTES:
        raise ValueError('This Codex conversation is too large to attach intact. Paste the relevant conversation text instead.')
    return snapshot
