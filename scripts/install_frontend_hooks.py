"""Install the repository's frontend pre-commit hook with the current Python interpreter."""
from pathlib import Path
import subprocess
import sys


def install(root):
    root = Path(root).resolve()
    def git(*arguments):
        return subprocess.check_output(['git', *arguments], cwd=root, text=True).strip()
    top = Path(git('rev-parse', '--show-toplevel')).resolve()
    if top != root or not (root / '.githooks/pre-commit').is_file():
        raise ValueError('run this script from the repository containing .githooks/pre-commit')
    current = subprocess.run(['git', 'config', '--get', 'core.hooksPath'],
                             cwd=root, capture_output=True, text=True)
    hooks_path = current.stdout.strip()
    if hooks_path and hooks_path != '.githooks':
        raise ValueError('existing core.hooksPath preserved: ' + hooks_path)
    subprocess.run(['git', 'config', '--local', 'hxz.python', sys.executable], cwd=root, check=True)
    subprocess.run(['git', 'config', '--local', 'core.hooksPath', '.githooks'], cwd=root, check=True)
    print('Frontend pre-commit synchronization enabled for this checkout.')


if __name__ == '__main__':
    try:
        install(Path(__file__).resolve().parents[1])
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print('Hook setup failed: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
