# Behavior-preserving architecture refactor

## Scope

Preserve current HTML output, interactions, API paths and business decisions. No replacement UI, no tenant migration, no production deployment in this increment. Earlier identity experiments remain untouched in a different worktree.

Baseline: 21baa54c943d5b04d654aafe6ab5a06a323376cd (previously verified published reliability release). Current remote production was not re-inspected; verify drift before any deployment.

## Source ownership

- `frontend/index/` and `frontend/ops/`: ordered HTML fragments, CSS and JavaScript sources.
- `frontend/manifest.json`: exact source order and original output hashes.
- `scripts/build_frontend.py`: deterministic assembly. `--check` refuses drift between sources and committed delivery HTML.
- Root `index.html` and `ops.html`: generated wire-format artifacts, intentionally still inline to avoid changing browser load order, global semantics or timing. Do not edit both independently.
- `backend/documents.py`: independently importable document parsing boundary. Function AST matches the baseline exactly; optional dependencies and user-visible errors unchanged.
- `backend/storage.py`: six original persistence functions relocated unchanged; AST matches baseline. Importing does not connect to the database. Server imports the compatibility names.
- `frontend/sections.json`: top-level AST-checked responsibility sections, original declaration order and side effects. These are concatenated source sections, not isolated ES modules; shared globals still require work.
- `server.py`: compatibility composition entrypoint; imports parser and persistence. HTTP/business separation remains incomplete.

## Verified

- index SHA256 7c7163768ba4fd6976daf36fe64347a834262abe2c4800fb551b31545fc91c18.
- ops SHA256 80e5254eecaf1300f30e71f29ca4ecac012e0bf9c3342b98b7f565676b4b7ce5.
- Reassembled pages match baseline byte for byte. CSS, DOM and script ordering untouched.
- 18 Python tests pass including baseline reliability, build equivalence, parser and persistence AST equivalence; original 10 Node demand tests passed (frontend output unchanged).
- Existing inline syntax gate and git diff --check pass.
- Docker packaging includes backend and frontend sources, with build-equivalence gate; CI checkout keeps baseline history for equivalence tests.

## Remaining work / not claimed

Resource separation is not sufficient module architecture. JavaScript still has legacy global state and coupling. Responsibility-level source sections now exist; explicit dependency interfaces still need implementation without changing execution behavior. HTTP routing, persistence and external providers still need independent boundaries and characterization tests. Full interaction regression and clean-container build have not run. Existing browser-side password comparison/security weaknesses remain; preserving behavior does not certify security or compliance. Any security correction that changes permissions or business semantics must be separately identified.

No customer data accessed, model calls made, production modified, or main merged.
