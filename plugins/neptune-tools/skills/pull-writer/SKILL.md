---
name: pull-writer
description: Use when persisting build or refine output to a WordPress site via Haydi. Provides the canonical PHP snippets for reading and writing wp_template, wp_template_part, page, and post records, plus the kses-lift and wp_theme term-binding rules those snippets enforce. Loaded by build-content, build-template, refine-content, and refine-template subagents.
---

# Pull writer — Haydi persistence recipes

Persistence layer for Neptune build / refine subagents. You write to the WordPress site via Haydi MCP. You read project context (code.tsx, theme.json, design assets) from the local filesystem via the Read / Edit / Glob / Grep / Bash tools.

## Tool surface

Haydi MCP tools you will use:

- `mcp__haydi__run_php(code, reason)` — execute PHP in the WordPress context. Use for every wp_post mutation, every cache flush, and any read that needs WordPress's hydrated object shape rather than raw row bytes.
- `mcp__haydi__run_query(sql, reason)` — raw SQL via `$wpdb`. Use sparingly, for reads only. Never write post_content via SQL.
- `mcp__haydi__read_file`, `mcp__haydi__write_file`, `mcp__haydi__edit_file` — filesystem writes against allowed roots on the WordPress side. Use for files that live inside the site's `wp-content/themes/<theme>/` and that the project checkout does NOT mirror, or when you need backup semantics.
- `mcp__haydi__list_files`, `mcp__haydi__search_files`, `mcp__haydi__list_backups`, `mcp__haydi__restore_backup` — read-side filesystem inspection on the WP side.

Local host tools you will use:

- `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Bash` — for the project checkout (theme files mirrored at `wordpress/wp-content/themes/<theme>/`, design pulls under `design/<slug>/`, variables under `variables/`). The checkout is the source of truth for code; the running site is the source of truth for data.

You will not have access to the `Task` tool. You are a single-shot subagent — do the job and report.

## Decision rules — which tool for what

- Reading a `wp_template`, `wp_template_part`, `page`, or `post` post → **run_php** (recipe below). Do not read these via SQL; the recipes pass through WordPress's hydration so callers see what WP serves.
- Writing post_content for any of the above → **run_php** (recipe below). Never write post_content via raw SQL; kses-lift and the `wp_theme` term-binding for templates must happen in the same request.
- Editing `theme.json`, `styles/blocks/*.json`, `parts/*.html`, or any other file under `wp-content/themes/<theme>/` → **Edit / Write** against the local checkout. These are file-resident; the running site picks them up on the next request (after a cache flush, see next rule).
- After any change to `theme.json` or `styles/blocks/*.json` → **run_php** with `wp_cache_flush();`. Studio's PHP caches the resolved theme.json across requests, so without this the site renders stale styles.
- Reading SVG or non-WP files inside the running site (e.g. uploads/) → **mcp__haydi__read_file**.

## Recipes

Treat these as the only correct shape for the given operation. The placeholders in `{{double-braces}}` are values the host passes you in the task brief; never invent them.

### Important: how run_php returns values

`mcp__haydi__run_php` surfaces what your snippet **echoes**, not what it `return`s. A bare `return [...]` is invisible — Haydi reports "(no output)" and the host can't read the result. Every recipe below ends in `echo json_encode([...]);` for that reason. If you fork these recipes, keep that contract: emit results via `echo json_encode(...)`, never a top-level `return`. The host parses the echoed JSON to confirm success.

### Recipe 1 — Template read

Use to fetch a template's current post_content. Returns `{found, id, content}` (id and content omitted when `found` is false).

```php
$posts = get_posts([
    'post_type'   => '{{TYPE}}',           // 'wp_template' or 'wp_template_part'
    'post_status' => 'publish',
    'name'        => '{{SLUG}}',           // template slug, e.g. 'single' or 'page'
    'numberposts' => 1,
    'tax_query'   => [[
        'taxonomy' => 'wp_theme',
        'field'    => 'name',
        'terms'    => get_stylesheet(),
    ]],
]);
$post = $posts[0] ?? null;
echo json_encode($post
    ? ['found' => true, 'id' => (int) $post->ID, 'content' => $post->post_content]
    : ['found' => false]);
```

### Recipe 2 — Template write

Use to set a template's post_content. Idempotent: inserts on first call, updates on subsequent calls. Binds the new post to the active theme in the same request — never split this into two Haydi calls, or the post will exist without a theme term and WP will silently ignore it.

```php
kses_remove_filters();

$posts = get_posts([
    'post_type'   => '{{TYPE}}',
    'post_status' => 'publish',
    'name'        => '{{SLUG}}',
    'numberposts' => 1,
    'tax_query'   => [[
        'taxonomy' => 'wp_theme',
        'field'    => 'name',
        'terms'    => get_stylesheet(),
    ]],
]);
$post = $posts[0] ?? null;

if ($post) {
    $r = wp_update_post([
        'ID'           => $post->ID,
        'post_content' => $content, // pass via Haydi's `code` param, NOT interpolated
    ], true);
    if (is_wp_error($r)) {
        echo json_encode(['error' => $r->get_error_message()]);
        return;
    }
    echo json_encode(['created' => false, 'id' => (int) $post->ID]);
    return;
}

$id = wp_insert_post([
    'post_type'    => '{{TYPE}}',
    'post_status'  => 'publish',
    'post_name'    => '{{SLUG}}',
    'post_title'   => '{{TITLE}}',
    'post_content' => $content,
], true);
if (is_wp_error($id)) {
    echo json_encode(['error' => $id->get_error_message()]);
    return;
}

wp_set_object_terms($id, get_stylesheet(), 'wp_theme', false);
echo json_encode(['created' => true, 'id' => (int) $id]);
```

### Recipe 3 — Page / post read

Use to fetch a `page` or `post` post by slug. `{{POST_TYPE}}` is `'page'` or `'post'` — never hardcode `'page'`, because canonical surfaces like `single.html` write to `'post'` (the seed Hello World post, id 1).

```php
$post = get_page_by_path('{{SLUG}}', OBJECT, '{{POST_TYPE}}');
echo json_encode($post
    ? ['found' => true, 'id' => (int) $post->ID, 'content' => $post->post_content]
    : ['found' => false]);
```

### Recipe 4 — Page / post write

Use to set a `page` or `post` post's content. Pages do not need a theme term — they are not theme-scoped.

```php
kses_remove_filters();

$existing = get_page_by_path('{{SLUG}}', OBJECT, '{{POST_TYPE}}');

if ($existing) {
    $r = wp_update_post([
        'ID'           => $existing->ID,
        'post_content' => $content,
    ], true);
    if (is_wp_error($r)) {
        echo json_encode(['error' => $r->get_error_message()]);
        return;
    }
    echo json_encode(['created' => false, 'id' => (int) $existing->ID]);
    return;
}

$id = wp_insert_post([
    'post_type'    => '{{POST_TYPE}}',
    'post_status'  => 'publish',
    'post_name'    => '{{SLUG}}',
    'post_title'   => '{{TITLE}}',
    'post_content' => $content,
], true);
if (is_wp_error($id)) {
    echo json_encode(['error' => $id->get_error_message()]);
    return;
}
echo json_encode(['created' => true, 'id' => (int) $id]);
```

### Recipe 5 — Cache flush

Use after any change to `theme.json` or `styles/blocks/*.json`. Single-line snippet.

```php
wp_cache_flush();
echo json_encode(['flushed' => true]);
```

### Recipe 6 — theme.json patch (Read + Write on disk)

Use to extend the active theme's `theme.json` with new structured properties registered by a template, content body, or pattern.

theme.json is a local file at `wordpress/wp-content/themes/<themeSlug>/theme.json`. Edit it freeform with the host's Read + Write tools — Haydi is NOT involved for the file itself, only for the cache flush at the end via Recipe 5.

Steps:

1. **Read** the current `theme.json` from disk with the Read tool. Parse it mentally as JSON.
2. Extend the two **allowed** subtrees:
   - `styles.blocks["core/<x>"]` — block-scoped structured properties + CSS. Your patch DEEP-MERGES into whatever's already there.
   - `settings.custom` — free-form key/value tree exposed as `--wp--custom--<path>` CSS vars.
3. **Preserve everything else byte-for-byte.** `settings.color` / `settings.typography` / `settings.spacing` / `settings.layout` / `customTemplates` / `templateParts` / `version` / `$schema` are owned by the variables build and the theme scaffold — do NOT modify them in a build/refine run unless the user has explicitly asked you to.
4. **Write** the full new file content with the Write tool. Indent with tabs, end with a single trailing newline (matches the variables build's output).
5. After writing theme.json, call Recipe 5 (cache flush).

Hard rule: NEVER put a `variations` field under `styles.blocks["core/<x>"]`. Editor-pickable block style variations live in their own files (Recipe 7), not under `theme.json.styles.blocks`. WP merges `variations` keys under there silently with no registration — a dead-write path.

### Recipe 7 — Block style variation file

Use to register an editor-pickable block style variation (e.g. an alternate button style, a callout card variation). Each variation becomes one file at `wordpress/wp-content/themes/<themeSlug>/styles/blocks/<slug>.json`. WP 6.6+ auto-registers them at theme init.

Use the host's Write tool. The file shape:

```json
{
  "$schema": "https://schemas.wp.org/trunk/theme.json",
  "version": 3,
  "title": "Fill Small",
  "slug": "neptune-fill-small",
  "blockTypes": ["core/button"],
  "styles": {
    "spacing": {
      "padding": {"top": "8px", "right": "16px", "bottom": "8px", "left": "16px"}
    },
    "typography": {"fontSize": "14px"}
  }
}
```

Hard rules:

- `slug` MUST be `neptune-` prefixed kebab-case (e.g. `neptune-callout-dark`). The class WP generates is `is-style-<slug>`; the prefix prevents collisions with theme defaults.
- `blockTypes` is a non-empty array of block names (`core/x` or `vendor/x`); one variation can apply to multiple blocks.
- `styles` is the theme.json `styles` shape — color / typography / spacing / border / elements / blocks / css. Settings / patterns / templates are NOT allowed inside.
- Tab-indented, single trailing newline.
- Reuse an existing variation when one matches — check the `=== existing block style variations ===` context section before registering a new one. Apply the matching `is-style-<slug>` class on the relevant block instead.
- After writing one or more variation files, call Recipe 5 (cache flush).

### Recipe 8 — Seed posts for query loops

Use after persisting markup that contains a `wp:query` block with `inherit:false` and `postType:"post"`, when the running site has fewer published posts than the loop's `perPage`. A `wp:query` over an empty (or near-empty) DB renders a near-empty grid during preview / refine — the design checks against the screenshot then fail for the wrong reason.

The recipe clones post ID 1 (the WP seed "Hello world" post) enough times to reach the target count. Each clone carries over:

- `post_content`, `post_excerpt`, `post_author`
- All taxonomy terms attached to the source (`category`, `post_tag`, plus any custom taxonomies registered for `post`)
- All non-internal `post_meta`, including `_thumbnail_id` (featured image) — the WP-internal keys `_edit_lock`, `_edit_last`, `_pingme`, `_encloseme`, `_wp_old_slug`, `_wp_old_date` are skipped because copying them confuses the editor

Each clone gets a distinct `post_title` (`"Hello world (2)"`, `(3)`, …) and slug (`hello-world-2`, `-3`, …) so the loop doesn't visually duplicate, and a `post_date` staggered one day earlier per clone so date-ordered loops don't tie.

Idempotent: counts published posts of post type `post` first; if the existing count already meets or exceeds `target`, the recipe is a no-op. Safe to re-run.

Skip this recipe entirely when the loop's `postType` is a CPT — post 1 is type `post`, and cloning it as a CPT entry would create a malformed row. Log one line to the conversation (`skipped seed: query loop over CPT 'products', site has 0 — author manually or via wp-cli`) so the human knows.

```php
$target = {{COUNT}};   // perPage from the wp:query block
$source_id = 1;        // WP seed "Hello world" post

$source = get_post($source_id);
if (!$source || $source->post_type !== 'post') {
    echo json_encode(['error' => 'source post 1 missing or not type=post']);
    return;
}

$existing = (int) wp_count_posts('post')->publish;
$needed = max(0, $target - $existing);
if ($needed === 0) {
    echo json_encode(['seeded' => 0, 'existing' => $existing, 'target' => $target]);
    return;
}

kses_remove_filters();

$source_meta = get_post_meta($source_id);
$skip_meta = [
    '_edit_lock', '_edit_last', '_pingme', '_encloseme',
    '_wp_old_slug', '_wp_old_date',
];

$source_taxonomies = get_object_taxonomies('post', 'names');
$source_terms = [];
foreach ($source_taxonomies as $taxonomy) {
    $term_ids = wp_get_object_terms($source_id, $taxonomy, ['fields' => 'ids']);
    if (!is_wp_error($term_ids) && !empty($term_ids)) {
        $source_terms[$taxonomy] = array_map('intval', $term_ids);
    }
}

$created = [];
$base_time = strtotime($source->post_date_gmt . ' UTC');

for ($i = 1; $i <= $needed; $i++) {
    $n = $existing + $i;
    $date_gmt = gmdate('Y-m-d H:i:s', $base_time - ($i * 86400));
    $id = wp_insert_post([
        'post_type'     => 'post',
        'post_status'   => 'publish',
        'post_name'     => $source->post_name . '-' . $n,
        'post_title'    => $source->post_title . ' (' . $n . ')',
        'post_content'  => $source->post_content,
        'post_excerpt'  => $source->post_excerpt,
        'post_author'   => $source->post_author,
        'post_date'     => get_date_from_gmt($date_gmt),
        'post_date_gmt' => $date_gmt,
    ], true);

    if (is_wp_error($id)) {
        echo json_encode(['error' => $id->get_error_message(), 'after' => count($created)]);
        return;
    }

    foreach ($source_terms as $taxonomy => $term_ids) {
        wp_set_object_terms($id, $term_ids, $taxonomy, false);
    }

    foreach ($source_meta as $meta_key => $meta_values) {
        if (in_array($meta_key, $skip_meta, true)) continue;
        foreach ($meta_values as $value) {
            add_post_meta($id, $meta_key, maybe_unserialize($value));
        }
    }

    $created[] = (int) $id;
}

echo json_encode([
    'seeded' => count($created),
    'ids' => $created,
    'existing_before' => $existing,
    'total_after' => $existing + count($created),
]);
```

### Recipe 9 — Set featured image on a post

Use when the converted post / page body contains `<!-- wp:post-featured-image /-->` (emitted from a `data-neptune-annotations="post-featured-image"` annotation). The dynamic block renders whatever `_thumbnail_id` meta the post carries — if you don't set it, the block renders empty during preview and the visual diff fails for the wrong reason.

How to resolve the attachment id: look up the `imgFoo` constant that lived inside the annotated subtree in the `=== media library mappings ===` context section. The mapping's `id` is the WP attachment ID to use as the featured image.

Call Recipe 9 **after** Recipe 4 (so the post exists), pass the post id you just wrote and the attachment id you resolved.

```php
$post_id       = {{POST_ID}};        // id returned by Recipe 4
$attachment_id = {{ATTACHMENT_ID}};  // from media library mappings

if (!get_post($post_id) || !get_post($attachment_id)) {
    echo json_encode(['error' => 'post or attachment missing']);
    return;
}
if (get_post($attachment_id)->post_type !== 'attachment') {
    echo json_encode(['error' => 'attachment id is not an attachment']);
    return;
}

$ok = set_post_thumbnail($post_id, $attachment_id);
echo json_encode([
    'set'           => (bool) $ok,
    'post_id'       => (int) $post_id,
    'attachment_id' => (int) $attachment_id,
]);
```

Skip when the annotated subtree contains no resolvable image — for example, the designer marked a placeholder div with no `<img>` inside, or the inner `imgFoo` was a discarded SVG (no media library mapping). Log one line (`skipped featured image: no resolvable attachment for post:hello-world`) so the human knows the dynamic block will render empty until they set one manually.

### Recipe 10 — Set site logo

Use when the converted markup contains `<!-- wp:site-logo /-->` (emitted from a `data-neptune-annotations="site-logo"` annotation). The block renders the site-wide logo — without setting it, the block renders an empty placeholder on every template that uses it.

How to resolve the attachment id: look up the `imgFoo` constant that lived inside the annotated subtree in the `=== media library mappings ===` context section. The mapping's `id` is the attachment to use.

Unlike Recipe 9, this is SITE-wide, not per-post. The agent persists nothing else here — there is no template / page / post target; the logo lives in `wp_options` and `theme_mods`. Recipe 10 sets both, because `wp:site-logo`'s render path falls through `get_custom_logo()` → `get_theme_mod('custom_logo')`, while the `site_logo` option is the theme-agnostic source synced on theme switch (WP 5.9+). Setting both keeps the block resolving correctly across edge cases.

Idempotent: if the option already points at the same attachment, the recipe is a no-op. Safe to call from multiple template builds in the same run.

```php
$attachment_id = {{ATTACHMENT_ID}};   // from media library mappings

if (!get_post($attachment_id)) {
    echo json_encode(['error' => 'attachment missing']);
    return;
}
if (get_post($attachment_id)->post_type !== 'attachment') {
    echo json_encode(['error' => 'attachment id is not an attachment']);
    return;
}

$current = (int) get_option('site_logo');
if ($current === (int) $attachment_id) {
    echo json_encode([
        'set'           => false,
        'reason'        => 'already set',
        'attachment_id' => (int) $attachment_id,
    ]);
    return;
}

update_option('site_logo', (int) $attachment_id);
set_theme_mod('custom_logo', (int) $attachment_id);

echo json_encode([
    'set'           => true,
    'attachment_id' => (int) $attachment_id,
    'previous'      => $current,
]);
```

Skip Recipe 10 when the annotated subtree carries no resolvable image (no `<img>`, or the inner `imgFoo` was a discarded SVG). Log one line (`skipped site logo: no resolvable attachment`) so the human knows the block will render empty until they upload a logo manually.

## Hard rules

1. `kses_remove_filters()` precedes every `wp_insert_post` / `wp_update_post` carrying block markup. Block attributes (`{"className":"…","style":{…}}`) are kses-stripped without it, even under Bearer-token auth. Skipping this strips block attributes silently — the post saves, but the editor refuses to render the row.
2. Template inserts pair `wp_insert_post` with `wp_set_object_terms($id, get_stylesheet(), 'wp_theme', false)` **in the same run_php request**. Splitting across two Haydi calls leaves a window where the post exists without the theme term — WP serves it as orphaned.
3. Never write post_content via `mcp__haydi__run_query` with an `UPDATE wp_posts SET …`. You bypass kses-lift, the `save_post` hook chain, and revisioning. The row loads, but the editor refuses to render it.
4. Pass `$content` (and any other multi-line user-content value) as a normal PHP variable inside your run_php snippet, not by string-interpolating it into the PHP source. Long block markup with quotes and braces will tokenise unpredictably; let PHP heredoc / single-quote handle the escaping.
5. The host has already decided canonical targets for `single.html` (post type `post`, slug `hello-world`) and `page.html` (post type `page`, slug `sample-page`). These come from the task brief — never re-derive them from the template name.
6. After any write that touches `theme.json` or `styles/blocks/*.json`, call Recipe 5. Studio's PHP caches the resolved theme.json across requests; without this, the next preview render uses stale styles.

## Reporting

When you finish, write one terse summary line per persisted artifact to the conversation, e.g.:

```
wrote wp_template:single (id 42, 1289 bytes)
wrote page:hello-world (id 1, 832 bytes)
edited wp-content/themes/<slug>/theme.json (+12 lines)
flushed theme.json cache
```

The host parses these for the run log. No JSON envelope, no markdown fences around the markup, no narration.
