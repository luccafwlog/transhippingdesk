---
name: writing-skills
description: "Create or refine a reusable skill and its task-specific references."
---

# Writing skills

Maintain this repository's skills in `skills/<name>/`; installation is described
in [the skill catalog](../README.md). Preserve attribution, licenses and existing
invocation policy when editing vendored skills.

Keep `name` and `description` concise: state the capability and the actual task
that benefits from it. Avoid catchall triggers and claims that the skill must
run before every response or edit.

Put purpose, essential invariants and routing in `SKILL.md`. Move substantial
mode-specific examples and procedures to focused references, linked with a clear
reason to read them. Keep a short self-contained skill in one file.

Prefer outcomes and decision criteria over fixed rituals. Keep concrete safety
boundaries and project contracts; remove duplicated advice, unavailable tool
requirements and obsolete paths. A skill cannot grant permission to publish,
change production or expand the request.

Validate frontmatter, links and supporting scripts when changed. Review realistic
routing examples: an intended task should select the skill, an adjacent unrelated
task should not. Behavioral experiments or independent review are useful for
complex workflows when authorized; ordinary prose edits need no mandatory
subagent test loop. Do not turn every hypothetical failure into another rule.
