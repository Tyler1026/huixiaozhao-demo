# Frontend build and publication

- Edit frontend source parts under frontend/ and the ordered parts lists in frontend/manifest.json. Root index.html and ops.html are generated artifacts.
- Run python scripts/build_frontend.py after every frontend change. It updates both pages and their manifest checksums together; never edit checksums manually.
- Run python scripts/build_frontend.py --check before creating a commit, PR, or deployment. A failed check must be repaired before publication.
- Publish generated files by reading their exact bytes from disk. Do not reconstruct HTML with string replacements, normalize line endings, or reinterpret JavaScript replacement tokens such as $&.
- Git/API uploads bypass local hooks, so they must perform the same build and check explicitly.
- For normal Git commits, python scripts/install_frontend_hooks.py enables index-based frontend synchronization for that checkout. Preserve existing custom hooks and unrelated unstaged changes.
- Keep the CI consistency check and the Docker source rebuild plus JavaScript syntax gate.
