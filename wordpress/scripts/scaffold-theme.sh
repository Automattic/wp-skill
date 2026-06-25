#!/usr/bin/env bash
# scaffold-theme.sh — drop a complete, rigor-correct block-theme skeleton so the agent fills in
# palette/fonts/composition instead of authoring boilerplate from scratch.
#
#   scripts/scaffold-theme.sh <theme-dir> [Theme Name]
#
# Writes into <theme-dir>:
#   theme.json            — rigor defaults pre-filled (root padding, blockGap, paired colors).
#                           Recolor the palette slugs + swap the two font families. Keep slug names.
#   style.css             — theme header + the design-agnostic base CSS (loop utils, equal-cards,
#                           footer reset). Append your design-specific CSS below the marker.
#   functions.php         — requires content-loader.php, enqueues the motion runtime frontend-only,
#                           and an enqueue_block_assets Google Fonts hook (fill the <Family> slots).
#   content-loader.php    — pages self-register from content/pages/*.html; promotes `home` to the
#                           static front page. No temp setup PHP, no front-page wiring by hand.
#   assets/motion/        — motion.css + motion.js (the scroll-reveal/hero-fade/etc runtime).
#   parts/ templates/ content/pages/ patterns/  — empty dirs for the agent to fill.
#
# Idempotent-ish: refuses to overwrite an existing theme.json unless --force is passed.
# Zero dependencies (POSIX bash). Resolve the path against the skill dir.
set -eu

force=0
args=()
for a in "$@"; do
  if [ "$a" = "--force" ]; then force=1; else args+=("$a"); fi
done
set -- "${args[@]:-}"

dir="${1:-}"
if [ -z "$dir" ]; then
  echo "Usage: scaffold-theme.sh <theme-dir> [Theme Name] [--force]" >&2
  exit 2
fi
name="${2:-}"

# Resolve the skill dir from this script's location (scripts/ -> skill root).
script_dir="$(cd "$(dirname "$0")" && pwd)"
skill_dir="$(cd "$script_dir/.." && pwd)"
bp="$skill_dir/boilerplate"
motion="$skill_dir/assets/motion"

for f in "$bp/theme.json" "$bp/style-base.css" "$bp/content-loader.php" "$motion/motion.css" "$motion/motion.js"; do
  [ -f "$f" ] || { echo "missing boilerplate: $f" >&2; exit 1; }
done

slug="$(basename "$dir")"
[ -n "$name" ] || name="$(echo "$slug" | tr '-_' '  ' | awk '{for(i=1;i<=NF;i++){$i=toupper(substr($i,1,1)) substr($i,2)}}1')"
prefix="$(echo "$slug" | tr '-' '_' | tr -cd 'a-z0-9_')"

if [ -f "$dir/theme.json" ] && [ "$force" -ne 1 ]; then
  echo "Refusing to overwrite existing $dir/theme.json (pass --force to replace)." >&2
  exit 1
fi

mkdir -p "$dir/parts" "$dir/templates" "$dir/content/pages" "$dir/patterns" "$dir/assets/motion"

# theme.json (recolor the slugs; keep their names)
cp "$bp/theme.json" "$dir/theme.json"

# style.css = WordPress theme header + base fragment + a marker for the agent's CSS
{
  printf '/*\n'
  printf 'Theme Name: %s\n' "$name"
  printf 'Text Domain: %s\n' "$slug"
  printf 'Version: 1.0.0\n'
  printf 'Requires at least: 6.5\n'
  printf 'Tested up to: 6.9\n'
  printf 'Requires PHP: 7.4\n'
  printf 'License: GNU General Public License v2 or later\n'
  printf 'License URI: http://www.gnu.org/licenses/gpl-2.0.html\n'
  printf '*/\n\n'
  cat "$bp/style-base.css"
  printf '\n/* ===== Design-specific CSS below — author the theme'\''s look here ===== */\n'
} > "$dir/style.css"

# motion runtime + content loader
cp "$motion/motion.css" "$dir/assets/motion/motion.css"
cp "$motion/motion.js"  "$dir/assets/motion/motion.js"
cp "$bp/content-loader.php" "$dir/content-loader.php"

# functions.php — wires the loader, the motion runtime (frontend-only), and a fonts hook
cat > "$dir/functions.php" <<PHP
<?php
/**
 * ${name} — theme setup.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Pages self-register from content/pages/*.html and the home page becomes the front page.
require_once get_theme_file_path( 'content-loader.php' );

// Main stylesheet + motion runtime.
// CRITICAL: block themes do NOT auto-enqueue style.css on the front end — without this the
// theme's entire custom-CSS layer (header positioning, cards, menu, footer) silently does nothing
// while theme.json colors still work. Enqueue it on the front end AND register it as an editor
// style so the Site Editor canvas matches. Motion stays FRONTEND ONLY (never add_editor_style /
// enqueue_block_assets — motion.css sets reveal-on-scroll opacity:0 and would blank the editor).
add_action( 'after_setup_theme', function () { add_editor_style( 'style.css' ); } );
add_action(
	'wp_enqueue_scripts',
	function () {
		\$ver = wp_get_theme()->get( 'Version' );
		wp_enqueue_style( '${prefix}-style', get_stylesheet_uri(), array(), \$ver );
		wp_enqueue_style( '${prefix}-motion', get_theme_file_uri( 'assets/motion/motion.css' ), array( '${prefix}-style' ), \$ver );
		wp_enqueue_script( '${prefix}-motion', get_theme_file_uri( 'assets/motion/motion.js' ), array(), \$ver, true );
	}
);

// Google Fonts — load in BOTH front-end and editor. Replace <DisplayFamily>/<BodyFamily> with the
// distinctive families this theme declares in theme.json (NOT Inter/Roboto/Arial/Open Sans).
add_action(
	'enqueue_block_assets',
	function () {
		wp_enqueue_style(
			'${prefix}-fonts',
			'https://fonts.googleapis.com/css2?family=<DisplayFamily>:wght@400;700&family=<BodyFamily>:wght@400;600&display=swap',
			array(),
			null
		);
	}
);
PHP

cat <<EOF

Scaffolded "${name}" into ${dir}/
  theme.json          recolor the 8 palette slugs + swap the 2 font families (keep slug names)
  style.css           append design CSS below the marker; base utilities already in place
  functions.php       fill the <DisplayFamily>/<BodyFamily> in the fonts URL
  content-loader.php  (leave as-is — it self-registers pages)
  assets/motion/      (leave as-is — enqueued by functions.php)

Next: write content/pages/home.html (+ about/menu/contact…), parts/header.html, parts/footer.html,
templates/ (front-page.html, index.html, page.html, …), and patterns/. Then run the block loop:
  node scripts/checker/fix-blocks.cjs <files>   # auto-repair validity
  node scripts/checker/validate-blocks.cjs <files>
EOF
