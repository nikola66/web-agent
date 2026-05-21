---
name: Chart
description: Use when a visual would clarify a plan, flow, or report — ```mermaid fences plus artifact_present View popup for SVG (GitHub-style).
version: 1.0.0
category: bundled
tags: [chart, mermaid, diagram, visual, flowchart, sequence, gantt, mindmap, artifact]
triggers: [chart, diagram, mermaid, flowchart, sequence diagram, gantt, mindmap, draw, visualize, show the flow, architecture diagram, state machine, artifact_present, show diagram, render diagram]
---

## Tool contract (read first)

Mermaid **only renders as SVG** in the **`artifact_present` View popup** — like GitHub. Chat text and bare code blocks stay plain text.

| To get a rendered diagram | Do this |
|---------------------------|---------|
| Markdown report/plan with diagram | `artifact_present` with inline `markdown` or `.md` `path`; body contains a ` ```mermaid ` fence |
| Standalone diagram file | `write_file` as `*.mmd` / `*.mermaid`, then `artifact_present` with that `path` |
| User asked to show/see the diagram | Call `artifact_present` **in the same turn** — do not paste the diagram source in chat and stop |

**Fence rule (non-negotiable):** opening fence info-string must be exactly `mermaid` (lowercase). ` ```mermaid ` → SVG in preview. ` ``` `, ` ```text `, or raw unfenced source → literal text, no diagram.

**After present:** one-line chat summary + pointer to View/Download — never dump the full artifact body again. Delivery mechanics: **`artifact-delivery`**.

## When to Use

- Any plan, multi-step workflow, system architecture, decision tree, or sequence of interactions — pair it with a diagram.
- Comparisons, state machines, timelines, dependency graphs, or hierarchies.
- Drafting **any markdown document** (reports, RFCs, vault pages, run reports) — **default to including at least one chart** when a flow, structure, or comparison is described in prose.
- User says "draw", "diagram", "visualize", "flowchart", "show me the flow".

## Why it matters

Humans absorb structure faster from a diagram than from prose. Even a 4-node flowchart cuts onboarding time and reveals gaps the text hides. Defaulting to **include a chart** when one fits is a quality signal, not decoration.

## Relation to other skills (canonical handoffs)

- Called by **`task-planning`** to render the proposed plan as a flowchart before execution.
- Called by **`task-execution`** to embed a step-status diagram inside the final run report.
- Called by **`systematic-debugging`** to draw the fault tree / hypothesis lattice.
- Called by **`project-scaffold`** to show the new folder tree as a `graph` or file-tree diagram.
- Called by **`memory-layers`** wiki flows for PARA / topic-map vault pages.
- Delivery surface owned by **`artifact-delivery`** — always **`artifact_present`** so the host View popup can render Mermaid as SVG (see **Host preview contract** above).

## Diagram types and when to pick each

| Need | Mermaid type | Header |
|------|--------------|--------|
| Process / branching flow | flowchart | ` ```mermaid\nflowchart TD` |
| Time-ordered interaction between actors | sequenceDiagram | ` ```mermaid\nsequenceDiagram` |
| Lifecycle / states | stateDiagram-v2 | ` ```mermaid\nstateDiagram-v2` |
| Plan or timeline | gantt | ` ```mermaid\ngantt` |
| Concept map / hierarchy | mindmap | ` ```mermaid\nmindmap` |
| Comparison / quadrant | quadrantChart | ` ```mermaid\nquadrantChart` |
| Class / data model | classDiagram | ` ```mermaid\nclassDiagram` |
| Entity relationships | erDiagram | ` ```mermaid\nerDiagram` |
| Trend over discrete points | xychart-beta | ` ```mermaid\nxychart-beta` |
| Pie share | pie | ` ```mermaid\npie` |

When in doubt → **flowchart TD** with 4–8 labeled nodes.

## Authoring rules

1. **Fence with `mermaid`.** Info-string exactly `mermaid` (lowercase) — required for SVG in the View popup; any other tag stays a code listing.
2. **Keep it scannable.** 4–12 nodes is the sweet spot. If you need more, split into two diagrams or use a hierarchical subgraph.
3. **Label every edge** that carries semantic weight (`-->|approved|`, `-->|fails|`). Unlabeled arrows are fine for trivial linear flows.
4. **Quote labels with special chars.** Wrap labels containing `()`, `:`, `/`, `&`, or quotes in `["…"]` so Mermaid does not choke on the parse.
5. **Direction first.** Flowcharts: `TD` (top-down) for plans, `LR` (left-right) for pipelines. Be consistent inside one document.
6. **Avoid styling unless asked.** Default theme is fine; bespoke `classDef` colors usually do more harm than good in a quick draft.
7. **Present before done** — when the user should see the diagram, call `artifact_present` and open View; do not rely on chat paste alone.

## Embedding pattern

Always embed the chart in the markdown deliverable, then **`artifact_present`** that body or `.md` path:

````markdown
## Approval flow

```mermaid
flowchart LR
  A[Draft] --> B{Owner approves?}
  B -->|yes| C[Merge]
  B -->|no| D[Revise]
  D --> A
```

The flow is: …
````

For multi-step run reports (see **`task-execution`**), put the chart **above** the step-breakdown table — readers see structure first, detail second.

## Pitfalls

- Forgetting ` ```mermaid ` or skipping `artifact_present` — user sees plain text, not a diagram.
- Unclosed brackets / mismatched arrow syntax — parser errors. Keep diagrams small enough to spot the issue.
- Inlining a 40-node diagram — unreadable; split or summarize.
- Using HTML inside labels — Mermaid in `securityLevel: "strict"` (host config) will strip or refuse.
- Treating a chart as a *substitute* for prose — it is a **complement**; keep the surrounding sentences.

## Anti-patterns

- Pasting an ASCII-art box diagram when Mermaid would render properly.
- Generating a chart "for completeness" when one box plus an arrow says nothing the sentence above did not.
- Coloring nodes manually to convey status when status icons in a sibling table already do the job (see **`task-execution`** report shape).

## Quick recipes

**Plan as flowchart (pair with `task-planning`):**

````markdown
```mermaid
flowchart TD
  S([Start]) --> P1[Step 1: gather inputs]
  P1 --> P2[Step 2: transform]
  P2 --> P3{Validation passes?}
  P3 -->|yes| D([Deliver])
  P3 -->|no| P1
```
````

**Step status (pair with `task-execution` report):**

````markdown
```mermaid
flowchart LR
  s1([✅ fetch]) --> s2([✅ parse]) --> s3([❌ typecheck]) --> s4([⏭️ deploy])
```
````

**Sequence diagram for a tool-use round-trip:**

````markdown
```mermaid
sequenceDiagram
  User->>Agent: goal
  Agent->>web_fetch: GET url
  web_fetch-->>Agent: 200 + body
  Agent->>artifact_present: report.md
  Agent-->>User: link + summary
```
````
