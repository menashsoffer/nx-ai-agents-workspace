#!/usr/bin/env bash
# Publishes static files to the gh-pages branch (GitHub Pages source:
# "Deploy from a branch: gh-pages / (root)").
#
#   gh-pages-publish.sh root <src-dir>     site at /, keeps every pr-*/ preview
#   gh-pages-publish.sh dir <name> <src>   replace /<name>/ (PR previews)
#   gh-pages-publish.sh remove <name>      delete /<name>/
#
# Needs GH_TOKEN (contents: write) and GITHUB_REPOSITORY. Retries on
# concurrent pushes from other PRs; they touch disjoint paths.
set -euo pipefail
mode=$1
: "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}"
url="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
work=$(mktemp -d)

if git ls-remote --exit-code --heads "$url" gh-pages >/dev/null 2>&1; then
  git clone --quiet --depth 1 --branch gh-pages "$url" "$work"
else
  git init --quiet -b gh-pages "$work"
  git -C "$work" remote add origin "$url"
fi
cd "$work"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

apply() {
  case "$mode" in
    root)
      find . -mindepth 1 -maxdepth 1 ! -name .git ! -name 'pr-*' -exec rm -rf {} +
      cp -r "$2/." .
      ;;
    dir)
      [[ "$2" =~ ^pr-[0-9]+$ ]] || { echo "bad dir name: $2" >&2; exit 1; }
      rm -rf "./$2" && mkdir -p "./$2" && cp -r "$3/." "./$2/"
      ;;
    remove)
      [[ "$2" =~ ^pr-[0-9]+$ ]] || { echo "bad dir name: $2" >&2; exit 1; }
      rm -rf "./$2"
      ;;
    *) echo "unknown mode $mode" >&2; exit 1 ;;
  esac
  touch .nojekyll
}

# Resolve source dirs to absolute paths before we cd'd.
args=("$@")
for i in "${!args[@]}"; do
  if [[ $i -gt 0 && -d "$OLDPWD/${args[$i]}" ]]; then args[i]="$OLDPWD/${args[$i]}"; fi
done

for attempt in 1 2 3 4 5; do
  apply "${args[@]}"
  git add -A
  if git diff --cached --quiet; then echo "gh-pages: nothing to change"; exit 0; fi
  git commit --quiet -m "gh-pages: $mode ${2:-}"
  if git push --quiet origin gh-pages; then echo "gh-pages: pushed"; exit 0; fi
  echo "push rejected (attempt $attempt); rebuilding on the new tip"
  sleep $((attempt * 3))
  git fetch --quiet --depth 1 origin gh-pages
  git reset --quiet --hard origin/gh-pages
done
echo "gh-pages: giving up after 5 attempts" >&2
exit 1
