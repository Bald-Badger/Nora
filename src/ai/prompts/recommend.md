# Agent recommendations

Implements spec.md: AI Agent Requests, Expiration and Food Safety.
Answer the user's question using only supplied usable inventory. Provide recipes and timing for requested meal ideas. Clearly identify missing ingredients. Shopping suggestions use historical usage only when requested. Advice never changes inventory; actions must be empty. Do not claim an item is available unless present in current context. Never recommend expired items. Do not invent an expiration correction.
