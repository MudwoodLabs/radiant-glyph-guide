# Glyph scriptPubKey classifier (vendored reference)

This is the reference implementation and the golden vectors behind the guide's
[Wallet Classifier Patterns](../../README.md#wallet-classifier-patterns) section.
The files were vendored from `MudwoodLabs/radiant-ledger-app`, which has since
been archived and made private.

| File | Origin (commit `d7427359f3a9a3393bf769c43a0a17c84ee1ec92`) | sha256 at origin | sha256 here |
|---|---|---|---|
| `classifier.mjs` | `view-only-ui/classifier.mjs` | `50767ac23cc2ad60ba9be0d6ddb273dfb527fc34daf762f5975b79ddab6b81f6` | `50767ac23cc2ad60ba9be0d6ddb273dfb527fc34daf762f5975b79ddab6b81f6` |
| `fixtures/classifier-vectors.json` | `view-only-ui/fixtures/classifier-vectors.json` | `0c9c45825da1b411a1c5b7f84327e606d10cb79494d32736361d58be31b4e88c` | `0c9c45825da1b411a1c5b7f84327e606d10cb79494d32736361d58be31b4e88c` |
| `fixtures/test_classifier.mjs` | `view-only-ui/fixtures/test_classifier.mjs` | `0dab348976396016e38b4952eacfdd00f6525e34e835c45bc107111f32f186dd` | `32922d9f01be74904a080035481292e5223dd9a73a3964241d0e6afe3b80e3ae` (modified) |

**Modification:** `fixtures/test_classifier.mjs` has had its MIME-allowlist
section removed. That section read the viewer's `index.html`, which is not
vendored. The classifier and the vectors are unchanged.

Run the checks (Node.js, no dependencies):

```
node fixtures/test_classifier.mjs
```

The run prints `22 passed, 0 failed` at the commit above.

These files are licensed under the Apache License 2.0 (see `LICENSE` in this
directory), not under the MIT licence that covers the rest of this repository.
