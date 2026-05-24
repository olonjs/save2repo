---
name: olonjs-tenant
description: Use when working on a OlonJS tenant, transforming the base tenant DNA into a branded tenant, adding or modifying tenant sections, maintaining schema-driven editability, or reasoning about what belongs to @olonjs/core versus the tenant.
---

# OlonJS Tenant

Use this skill for work on the OlonJS ecosystem when the task involves:

- a tenant generated from the OlonJS CLI
- `@olonjs/core`
- tenant sections/capsules
- `src/data/pages/**/*.json` or `src/data/config/*.json`
- schema-driven editing and inspector compatibility
- generator scripts that turn a base tenant into a branded tenant

Read code first. Treat documents as secondary unless they help interpret code that is otherwise ambiguous.

## Architecture Specifications

**Normative:** OlonJS Architecture Specifications **v1.6** (`olonjsSpecs_V_1_6.md`).

Use this document as the architectural law for each tenant; compliance is judged against it:

- `\\wsl.localhost\Ubuntu\home\dev\npm-jpcore\specs\olonjsSpecs_V_1_6.md`

Key v1.6 laws that agents must not ignore:

- `@olonjs/core` is a **token transporter/publisher**, not the semantic authority for tenant theme vocabulary
- Theme flattening is explicit and normative (`tokens.colors.primary` → `--theme-colors-primary`)
- Tenant theme sovereignty is explicit: tenant owns all semantic naming
- `menu.json` is the source of truth for menu structures
- `site.json` owns shell structure and shell instance declaration
- `header` and `footer` are **ordinary shell-scoped section instances**, not conceptually reserved types
- Path-based selection uses `SelectionPath` / `SelectionPathSegment` — not legacy flat fields like `itemPath` or `itemField`

## Core Model

OlonJS has a hard split between `core` and `tenant`.

- `@olonjs/core` owns routing, `/admin`, `/admin/preview`, preview stage, studio state, inspector/form factory, and shared engine behavior.
- The tenant owns sections, schemas, type augmentation, page/config JSON, theme/design layer, and local workflow scripts.
- The tenant does not implement the CMS. It implements the tenant protocol consumed by the engine.

In this ecosystem, code is the source of truth.

Compliance priority:

1. Data is bound correctly.
2. Schemas describe fields correctly.
3. Content is editable without breaking the inspector.
4. Theme chain is compliant (`theme.json → runtime vars → tenant bridge → --local-* → JSX`).
5. Tenant structure stays standardized.
6. Context-aware focus/highlight in the admin is desirable but secondary.

## Canonical References

Use these local references when available:

- Base tenant DNA: `\\wsl.localhost\Ubuntu\home\dev\temp\alpha`
- Core engine: `\\wsl.localhost\Ubuntu\home\dev\npm-jpcore\packages\core`

If these paths are missing, infer the same roles from the current workspace:

- base CLI-generated tenant
- core package

## Tenant Anatomy

Expect these files to move together:

- `src/components/<section>/View.tsx`
- `src/components/<section>/schema.ts`
- `src/components/<section>/types.ts`
- `src/components/<section>/index.ts`
- `src/lib/ComponentRegistry.tsx`
- `src/lib/schemas.ts`
- `src/lib/addSectionConfig.ts`
- `src/types.ts`
- `src/data/pages/**/*.json`
- `src/data/config/site.json`
- `src/data/config/theme.json`
- `src/data/config/menu.json`

MANDATORY: if a section type changes, check all of the files above before concluding the task is done.

## Theme Chain (CIP v1.7 — Architectural Law)

The normative chain is **4 layers**. Never skip or shortcut any layer:

```
theme.json → published runtime vars → tenant semantic bridge → section --local-* → JSX classes
```

| Layer | Where | Role |
|---|---|---|
| 0 | Core engine | Flattens `theme.json` → publishes `--theme-*` CSS vars |
| 1 | `index.css` `:root` block | Maps `--theme-*` → tenant semantic names (`--background`, `--primary`, etc.) |
| 2 | `index.css` `@theme` block | Exposes semantic names to Tailwind utilities |
| 3 | Section root element | Scopes owned concerns via `--local-bg`, `--local-text`, etc. |

**Flattening rule:** `tokens.colors.primary` → `--theme-colors-primary` (kebab-case, full path)

**Minimal compliant section pattern:**
```tsx
<section
  style={{
    '--local-bg': 'var(--background)',
    '--local-text': 'var(--foreground)',
    '--local-primary': 'var(--primary)',
    '--local-radius': 'var(--theme-border-radius-md)',
  } as React.CSSProperties}
  className="bg-[var(--local-bg)] text-[var(--local-text)]"
>
```

Layer 3 (`--local-*`) is **mandatory** when the section owns background, text color, border, accent, or radius concerns.

## Menu Binding (JSP v1.9 — Architectural Law)

`menu.json` is the source of truth for all menu data. Shell instances bind to it by reference — they do not own the menu.

**Authored pattern in `site.json`:**
```json
{
  "header": {
    "id": "header",
    "type": "header",
    "data": {
      "menu": { "$ref": "../config/menu.json#/main" }
    }
  }
}
```

**Runtime:** Core resolves the `$ref` and passes concrete `MenuItem[]` to the component props.

**Studio persistence rule:** edits to a resolved menu must persist into `menu.json`, never into `site.json`.

`header` and `footer` are ordinary section types with shell scope — same component model, same schema-driven contract, same capsule structure. They differ only in data placement (`site.json` instead of page JSON) and rendering scope.

## IDAC Data Attributes (IDAC v1.2)

Every View must attach these attributes on editable elements:

| Attribute | On | Value |
|---|---|---|
| `data-jp-field="<fieldKey>"` | Every editable scalar | Schema field key (e.g. `"title"`) |
| `data-jp-item-id="<id>"` | Every editable array item | `item.id` — never index |
| `data-jp-item-field="<arrayKey>"` | Same array item element | Array key in data schema |

`data-section-id` and `data-jp-section-overlay` are injected by Core — not by the tenant.

## Path-Based Selection (ECIP v1.6 / JAP v1.3)

Nested targeting uses `SelectionPath` — an array of `SelectionPathSegment`:

```typescript
type SelectionPathSegment = { fieldKey: string; itemId?: string };
type SelectionPath = SelectionPathSegment[];
```

Legacy flat fields (`itemPath`, `itemField`, `itemId` as top-level) are **transitional adapters**, not the normative nested protocol. Do not introduce them in new code.

## Form Factory UI Vocabulary (ECIP v1.6)

`ui:*` descriptors in `.describe()` are the **only** mechanism to tell the Form Factory which widget to render. Use exactly the keys below — do not invent new ones. Unknown keys fall back to `ui:text`.

| Descriptor | Zod type | Widget | When to use |
|---|---|---|---|
| `ui:text` | `z.string()` | Single-line text input | Short strings: titles, labels, hrefs, names |
| `ui:textarea` | `z.string()` | Multi-line text | Long strings: descriptions, body copy, HTML snippets |
| `ui:select` | `z.enum([...])` | Dropdown | Any enum field — always pair with `z.enum` |
| `ui:number` | `z.number()` | Numeric input | Counts, durations, pixel values |
| `ui:list` | `z.array(...)` | Array editor with add/remove/reorder | Repeating items (cards, links, features) — items must extend `BaseArrayItem` |
| `ui:image-picker` | `z.object({ url, alt? })` | Image picker + upload | Any image field — always use `ImageSelectionSchema` from `base-schemas.ts` |
| `ui:icon-picker` | `z.string()` | Icon selector | Icon name fields |

**Rules:**
- `.describe('ui:...')` goes on the **field**, not on the parent object
- `z.enum` fields must always have `ui:select` — omitting it will render a text input instead of a dropdown
- Image fields must use `ImageSelectionSchema` (not a bare `z.string()`) so the picker and upload flow work correctly
- Array fields with `ui:list` must have items that extend `BaseArrayItem` — without a stable `id`, React reconciliation and Inspector reorder/delete break
- Do not add `.describe()` to optional wrapper objects — only to leaf fields or arrays

**Examples:**
```typescript
// ✅ correct
title: z.string().describe('ui:text'),
body: z.string().describe('ui:textarea'),
variant: z.enum(['primary', 'secondary']).default('primary').describe('ui:select'),
image: ImageSelectionSchema,                         // already has ui:image-picker
items: z.array(
  BaseArrayItem.extend({
    label: z.string().describe('ui:text'),
    icon: z.string().optional().describe('ui:icon-picker'),
  })
).describe('ui:list'),

// ❌ wrong — invented descriptor
subtitle: z.string().describe('ui:rich-text'),       // does not exist
count: z.number().describe('ui:slider'),             // does not exist
image: z.string().describe('ui:image'),              // wrong — use ImageSelectionSchema
```

## What Good Work Looks Like

A good tenant change:

- stays inside tenant boundaries unless the issue is truly in `@olonjs/core`
- keeps schema, defaults, registry, and type augmentation aligned
- preserves editability for strings, lists, nested objects, CTAs, and image fields
- uses `ImageSelectionSchema`-style image fields when the content is image-driven
- keeps page content JSON-first
- routes all themed values through the 4-layer theme chain
- uses `$ref` for menu binding in shell instances — never inlines menu data in `site.json`
- uses stable `item.id` for all array items, never index fallback

A suspicious tenant change:

- patches the core to fix a tenant modeling problem
- adds visual complexity without data bindings (`data-jp-field`, `data-jp-item-id`)
- introduces fields into JSON that are not represented in schema
- changes a section view without updating defaults or types
- hardcodes themed values as literals (`bg-blue-500`, `text-zinc-100`, `rounded-[7px]`) as primary styled contract
- reads `theme.json` directly inside a View component
- inlines menu arrays in `site.json` instead of using `$ref`
- uses index as array item identity instead of stable `id`
- treats `header`/`footer` as a separate component system rather than ordinary shell-scoped capsules
- optimizes legacy context awareness at the expense of simpler, reliable editability

## Workflow 1: Base Tenant → Branded Tenant

This is the primary workflow.

Goal:

- transform a CLI-generated base tenant into a branded tenant through a single generator script

Treat the generator script as procedural source of truth for the green build workflow.

When maintaining or authoring a generator:

1. Separate non-deterministic bootstrap from deterministic sync.
2. Make explicit which files are managed output.
3. Keep the script aligned with the current tenant code, not with stale docs.
4. Preserve tenant protocol files: sections, schemas, registries, type augmentation, config JSON, assets, shims.
5. Prefer deterministic local writes after any remote/bootstrap step.

Typical structure of a good generator:

- preflight checks
- remote/bootstrap steps such as `shadcn` or external registries
- deterministic creation/sync of tenant files
- compatibility patches for known unstable upstream payloads
- final validation commands

When asked to update a branded tenant generator:

1. Diff base tenant against branded tenant.
2. Classify differences into:
   - intended branded output
   - reusable generator logic
   - accidental drift
3. Encode only the reusable intended differences into the script.
4. Keep the output reproducible from a fresh base tenant.

## Workflow 2: Add Or Change A Section

When adding a new section type:

1. Create `View.tsx`, `schema.ts`, `types.ts`, `index.ts`.
2. Register the section in `src/lib/ComponentRegistry.tsx`.
3. Register the schema in `src/lib/schemas.ts`.
4. Add defaults and label in `src/lib/addSectionConfig.ts`.
5. Extend `SectionComponentPropsMap` and module augmentation in `src/types.ts`.
6. Add `data-jp-field` on every editable scalar and `data-jp-item-id` / `data-jp-item-field` on every array item in the View.
7. Add or update page JSON (or `site.json` for shell-scoped sections) using the new section type.

When changing an existing section:

1. Read the section schema first.
2. Read the page JSON (or `site.json`) using it.
3. Check the view for `data-jp-field` usage and binding shape.
4. Update defaults if the data shape changed.
5. Verify the inspector still has a path to edit the content.
6. If the section is themed, verify the 4-layer theme chain is intact.

## Workflow 3: Images, Rich Content, Nested Routes

Images:

- Prefer structured image objects compatible with tenant base schemas (`ImageSelectionSchema`).
- Assume the core supports image picking and upload flows.
- The tenant is responsible for declaring image fields in schema and rendering them coherently.

Rich editorial content:

- Tiptap-style sections are tenant-level integrations.
- Treat page JSON using `type: "tiptap"` as runtime usage examples, and section code as the real source of truth.

Nested routes:

- Files under `src/data/pages/**/*.json` may represent nested slugs.
- Preserve slug/path consistency and do not replace file-based routing with manual lists.

## Default Operating Procedure

When you receive a OlonJS tenant task:

1. Identify whether the problem belongs to `core`, tenant, or generator.
2. Read the smallest code surface that proves it.
3. Prefer fixing the tenant contract before touching visual polish.
4. Keep generated and deterministic workflows reproducible.
5. State assumptions when inferring intended branded output from examples.
6. When in doubt about a theme, menu, or selection pattern, consult `specs/olonjsSpecs_V_1_6.md`.
