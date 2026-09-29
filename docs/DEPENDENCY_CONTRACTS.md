# Explicit dependency contracts — behavior-preserving refactor

## Static HTML response boundary (first HTTP extraction)

Input: resolved filesystem path chosen by existing Handler routing; responder implementing send_response, send_header, cors, end_headers, wfile.write, send_error. Output: original status, headers and exact file bytes. No config reads, database, network, credential lookup or routing decisions inside this boundary. Missing file -> existing 404 HTML not found. Other I/O failures retain existing propagation. File descriptor must close before response is emitted (resource-lifetime fix with unchanged user-visible output).

## Existing pure merge boundary

backend/sync_merge.py owns snapshot merge policies, tombstones, clue matching and stage preservation. Inputs and outputs are ordinary dictionaries/arrays/scalars; no database, network or configuration. Original mutation semantics must be retained; do not add copying or change conflict rules as cleanup. Internal constants and helper functions belong to the module.

## Existing storage boundary

backend/storage.py owns connection creation, reads, writes and snapshots. Configuration is still module-scoped DATABASE_URL/SYNC_PATH; no connection on import. Caller contract: get returns JSON string or None on failure; set returns bool. Snapshot occurs before overwrite, existing commit semantics unchanged. Configuration injection and exception-path resource cleanup are remaining debt, not silently fixed by relocation.

## Existing document boundary

backend/documents.py takes filename and bytes and returns (text,error). Optional parser dependencies are module-local; importing never starts server. Errors/encoding fallbacks match original. Parser sandbox/resource limits remain an explicit security follow-up, not claimed fixed by extraction.

## Frontend boundary constraints

frontend/sections.json identifies responsibilities, declarations and top-level effects. These files are ordered concatenation fragments, NOT independently isolated modules. Current runtime depends on shared AUTH/PROJECTS/cur/view/REPORTSTATE and multiple legacy maps. Rendering functions often mutate state, run fetches and timers, so they cannot be imported as pure views without characterization.

First candidate for explicit dependency contract: small pure normalization/format helpers whose only dependencies are parameters and built-ins. Define contracts and compare against original functions using a VM; avoid changing global initialization or emitted page bytes. Any introduced runtime wrapper must preserve global call sites, order and return/error behavior. Broad module wrapper changes require separate behavioral evidence.

## Composition acceptance

Use actual Handler in a local HTTP server with only explicit synthetic dependencies. Never import server.py top level to discover dependencies because that can read model credentials. Cover both HTML routes, health response, invalid sync, successful merge and storage failure. Existing AST unit extraction alone is insufficient to prove composition.

No production security compliance is claimed: old unauthenticated sync, client-side login and health credential metadata remain known security exceptions until separately corrected under compatible user-visible behavior.
