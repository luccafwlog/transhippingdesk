---
name: verification-before-completion
description: "Assess whether validation evidence supports a completion claim."
---

# Verification evidence

Match each claim to actual evidence for the changed behavior. Read command exit
status and failures; distinguish a static check, unit test, integration test,
and observed runtime result. Passing lint alone does not prove compilation or
end-to-end behavior.

Use the repository's impact-based checks. Results remain valid while the tested
code and relevant environment are unchanged. Rerun affected checks after edits,
failures, or new concerns; repeating a passing suite for a status message adds
no evidence.

Fix failures caused by the requested change. Report unrelated failures and
unavailable environments accurately. Review the final diff against the request
and state unverified requirements without calling them complete.
