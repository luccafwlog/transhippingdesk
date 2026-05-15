#!/bin/bash
set -euo pipefail

mkdir -p ~/.claude/skills/grill-me

cat > ~/.claude/skills/grill-me/SKILL.md << 'EOF'
---
name: grill-me
description: Interview me relentlessly about every aspect of a plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. Ask the questions one at a time. If a question can be answered by exploring the codebase, explore the codebase instead.
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer. Ask the questions one at a time. If a question can be answered by exploring the codebase, explore the codebase instead.
EOF
