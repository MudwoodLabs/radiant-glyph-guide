# Radiant Blockchain Glyph NFT Implementation Guide

**Complete Technical Documentation for Building NFT Applications on Radiant**

> **Guide version:** see the [Changelog](#changelog) at the bottom.
> **Protocol baseline:** Radiant V2 (block 410,000) + post-V2 fees (block 415,000).
> **Last on-chain verification:** see the [Verified Working Transactions](#verified-working-transactions-january-2026) section for mainnet txids that back the claims in this document.
> **Integrity (read BEFORE pasting into an AI agent):** the canonical source is `Zyrtnin-org/radiant-glyph-guide` on GitHub. Before pasting into an agent session that has file-write or network access, clone the repo (`git clone https://github.com/Zyrtnin-org/radiant-glyph-guide`), run `git log --oneline` to see the commit history, and diff the current `README.md` against an earlier commit you recognize (e.g. `git diff <known-good-commit>..HEAD README.md`). A compromised fork or a commit injected by an attacker could add instructions that exfiltrate keys or insert backdoors into signing code — and you will not see the injection just by reading the rendered markdown.

This guide provides everything you need to implement Glyph NFTs on the Radiant blockchain, updated for **V2** (block 410,000+). It includes critical discoveries from real-world implementation, all 11 Glyph protocol types, V2 opcode reference, and updated fee calculations for the post-V2 fee increase.

Designed to be used as context for AI coding agents (Claude, Cursor, etc.) — paste the README into your session and start building. See [BUILDING_WITH_CLAUDE.md](BUILDING_WITH_CLAUDE.md) for MCP server setup and AI-assisted workflow tips.

> **FOR AI AGENTS — Start Here:**
> - **First NFT mint?** → Read sections 2 (Critical Requirements), 5 (On-Chain Images), 9 (CBOR Payload), then 10-12 (Commit/Reveal/Signing)
> - **First FT integration?** → Read section 7 (Fungible Tokens) for the 75-byte template + wallet classifier patterns
> - **First dMint deploy or mint?** → Read [section 8 (Decentralized Mint)](#decentralized-mint-dmint) for the V1 contract layout, deploy commit/reveal shape, [V1 mint tx mechanics](#v1-mint-tx-mechanics-mainnet-verified) (4-output shape, 72-byte mint scriptSig, PoW preimage layout), and Photonic-master divergences. See also the [byte-decoded GLYPH reference deploy and snk/PXD mint txs](#verified-working-transactions-january-2026).
> - **Debugging a failed mint?** → Jump to section 15 (Common Errors) and the Appendix (opcodes, hex values)
> - **Upgrading to V2?** → Read section 19 (What's New in V2) and the Fee Calculations section for updated costs
> - **Hardware wallet (Ledger) support?** → See [`radiant-ledger-guide`](https://github.com/Zyrtnin-org/radiant-ledger-guide). Minting still requires software signing; receiving + spending Glyph UTXOs works with the community Ledger app
> - **Using Claude with MCP?** → See [BUILDING_WITH_CLAUDE.md](BUILDING_WITH_CLAUDE.md) for MCP setup and workflow tips

---

## Table of Contents

1. [Overview](#overview)
2. [Critical Requirements (Read First!)](#critical-requirements-read-first)
3. [Prerequisites](#prerequisites)
4. [Infrastructure Setup](#infrastructure-setup)
   - [Getting a Working Radiant Node](#getting-a-working-radiant-node)
   - [Networking the Node](#networking-the-node)
   - [Calling the Signer from PHP](#calling-the-signer-from-php)
5. [On-Chain Images: The `main` Field](#on-chain-images-the-main-field)
6. [Architecture](#architecture)
7. [Fungible Tokens (FTs)](#fungible-tokens-fts--the-other-half-of-glyph)
   - [NFT vs FT Output Script Comparison](#nft-vs-ft-output-script-comparison)
   - [FT Holder Template (75 bytes)](#ft-holder-template-75-bytes)
   - [Wallet Classifier Patterns](#wallet-classifier-patterns)
8. [Decentralized Mint (dMint)](#decentralized-mint-dmint)
   - [Reference mainnet artifacts](#reference-mainnet-artifacts-use-these-to-test-your-decoder)
   - [V1 vs V2: critical warning](#v1-vs-v2-critical-warning)
   - [V1 contract UTXO byte layout (241 B)](#v1-contract-utxo-byte-layout-241-b--state96--epilogue145)
   - [dMint deploy: commit-tx output shape](#dmint-deploy-commit-tx-output-shape)
   - [dMint deploy: reveal-tx I/O shape](#dmint-deploy-reveal-tx-io-shape)
   - [V1 mint tx mechanics (mainnet-verified)](#v1-mint-tx-mechanics-mainnet-verified)
   - [dMint CBOR token body](#dmint-cbor-token-body-revealed-in-vin0)
   - [Photonic Wallet divergences](#photonic-wallet-divergences-v1-dmint)
   - [Finding the deploy reveal from a commit txid](#finding-the-deploy-reveal-from-a-commit-txid-scripthash-history-gotcha)
   - [Known gotchas](#dmint-deploy-known-gotchas)
9. [CBOR Payload Format](#cbor-payload-format)
10. [Commit Transaction](#commit-transaction)
11. [Reveal Transaction](#reveal-transaction)
12. [Signing Challenge](#signing-challenge)
13. [Fee Calculations & Cost Analysis](#fee-calculations--cost-analysis)
14. [IPFS Integration](#ipfs-integration)
15. [Validating Your Builder Against Mainnet](#validating-your-builder-against-mainnet)
16. [Common Errors & Solutions](#common-errors--solutions)
17. [Complete Implementation Example](#complete-implementation-example)
18. [Testing & Verification](#testing--verification)
19. [Security Best Practices](#security-best-practices)
20. [What's New in V2](#whats-new-in-v2)
21. [Appendix: Quick Reference](#appendix-quick-reference)
22. [Disclaimer & Warranty](#disclaimer--warranty)
23. [Changelog](#changelog)

---

## Overview

### What are Glyph NFTs?

Glyph NFTs are a protocol for creating non-fungible tokens on the Radiant blockchain. They support:

- **True NFTs** - Transferable, unique, visible in explorers and wallets
- **Singleton Ref Technology** - Uses `OP_PUSHINPUTREFSINGLETON` for uniqueness
- **CBOR Encoding** - Binary encoding for metadata (REQUIRED - see below)
- **On-Chain Images** - Embedded thumbnails for wallet display (REQUIRED - see below)
- **Container/Author Refs** - Organize NFTs into collections with provenance

### Two-Transaction Pattern

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   Funding    │      │   Commit     │      │   Reveal     │
│    UTXO      │ ───► │     TX       │ ───► │     TX       │
│  (P2PKH)     │      │(nftCommit)   │      │(singleton)   │
└──────────────┘      └──────────────┘      └──────────────┘
                            │                      │
                            ▼                      ▼
                      Custom script          Singleton ref
                      validates glyph        NFT output
```

**Why Two Transactions?**

1. **Commit TX** - Creates an output with custom script that validates the glyph data
2. **Reveal TX** - Spends the commit output, embedding glyph data in scriptSig and creating the final NFT

This pattern ensures the NFT data is validated before the NFT is created.

### Container Organization: Commit vs Reveal Addresses

**IMPORTANT:** The commit address determines which container your NFTs belong to, while the reveal destination address determines who owns the NFT.

```
┌─────────────────────────────────────────────────────────┐
│ COMMIT TRANSACTION                                       │
│ - Address: Admin/Platform wallet                        │
│ - Purpose: Groups all NFTs into platform container      │
│ - Result: UTXOs and change stay with platform          │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ REVEAL TRANSACTION                                       │
│ - destAddress: Player wallet OR admin wallet            │
│ - Purpose: Determines who owns the NFT                  │
│ - Result: NFT singleton output to owner's address       │
└─────────────────────────────────────────────────────────┘
```

**Best Practice for Platform NFTs:**
- **Commit address:** Always use your platform's wallet (keeps all NFTs in one container)
- **Reveal destAddress:** Use player's wallet if available, otherwise your platform wallet

This design ensures:
1. All NFTs are organized in your platform's container (easy to browse in explorers)
2. Players own their NFTs (can transfer and manage them)
3. Clean fund management (UTXOs stay with platform wallet)

### Glossary

Terms you'll see throughout this guide. If you've worked with Bitcoin-style
chains before, most will be familiar; a few are Radiant/Glyph-specific.

- **Photon** — Radiant's smallest unit. 1 RXD = 100,000,000 photons (same
  ratio as BTC : satoshi). Fee rates in this guide are in photons/byte.
- **Commit TX** — First of the two-transaction mint. Creates an output locked
  by a custom `nftCommitScript` that validates the glyph payload hash.
- **Reveal TX** — Second transaction. Spends the commit output, embeds the
  glyph payload in the scriptSig, and produces the final singleton-ref NFT
  output.
- **Singleton ref** — A 36-byte reference (commit_txid_reversed + commit_vout_LE)
  pushed by `OP_PUSHINPUTREFSINGLETON` (opcode `0xd8`). Enforces uniqueness —
  the same ref can never appear in two different outputs.
- **`nftCommitScript`** — The custom locking script on the commit output.
  Encodes the hash of the CBOR payload; the reveal tx must present a payload
  that hashes to the same value.
- **`"gly"` marker** — The three ASCII bytes `676c79` that prefix every glyph
  payload in a scriptSig. Used by wallets and explorers to detect Glyph NFTs.
- **Container / Author ref** — Optional 36-byte refs in the payload's `in` /
  `by` fields that group NFTs into collections and attribute authorship. Must
  be **extracted from the singleton output script** of the referenced NFT, not
  derived from its txid. See the Container and Author Refs section.
- **CBOR** — Concise Binary Object Representation (RFC 8949). The binary
  encoding used for Glyph payloads. Every wallet expects CBOR; JSON won't parse.
- **`main` field** — The on-chain thumbnail embedded in the CBOR payload.
  Wallet displays come from here, not from IPFS. Without it, your NFT is
  invisible in Glyphium.
- **`destAddress`** — The address the reveal tx sends the NFT output to. May
  differ from the commit address — typical pattern is commit = platform
  wallet, destAddress = player wallet.
- **Photonic Wallet / radiantjs** — The canonical browser wallet for Radiant
  and its underlying JS library. This guide uses radiantjs (via
  `require('@radiantblockchain/radiantjs')`) as the server-side signer.
- **Glyphium / Glyph Explorer** — Community wallets and block explorers that
  render Glyph-protocol NFTs. `https://glyph-explorer.rxd-radiant.com` is the
  usual explorer URL.
- **`OP_PUSHINPUTREF` (`0xd0`)** — Creates a non-unique (fungible) token
  reference. Compare with `OP_PUSHINPUTREFSINGLETON` (`0xd8`) for NFTs.
  FT holder outputs use `d0`; NFT singleton outputs use `d8`.
- **`OP_STATESEPARATOR` (`0xbd`)** — Splits a script into prologue and
  epilogue. During execution it's a NOP (no stack effect), but its position
  determines the boundary between "what the signer proves" (prologue) and
  "what the network enforces" (epilogue). Used in every FT holder script.
- **codeScript / codeScript hash** — The portion of a scriptPubKey after
  `OP_STATESEPARATOR` (the epilogue). Radiant hashes this portion and uses
  it to group UTXOs by "token type" for conservation checks. Two UTXOs with
  the same codeScript hash belong to the same token.
- **Block heights that matter.** V2 activated at **410,000**; the grace period
  for the new fee floor ended at **415,000**. As of April 2026, mainnet is
  past both heights.

---

## Critical Requirements (Read First!)

> **These three requirements are essential. Missing any of them will result in broken or invisible NFTs.**

### 1. CBOR Encoding is MANDATORY

**Problem:** If you encode NFT metadata with JSON instead of CBOR, your NFT will appear as "Unknown NFT" in Glyph wallets with no metadata visible.

**Solution:** Always use CBOR encoding. Verify the library is loaded before minting:

```javascript
if (typeof CBOR === 'undefined') {
    throw new Error('CBOR library not loaded! NFT would be unreadable.');
}
```

### 2. On-Chain Thumbnail is MANDATORY

**Problem:** If you only include an IPFS link (`loc` field), your NFT will display as a blank card in Glyph Explorer and Glyphium wallet.

**Solution:** Embed a thumbnail image in the `main` field:

```javascript
payload.main = {
    t: 'image/webp',    // MIME type (must match thumbnail format)
    b: thumbnailBytes   // Uint8Array of image data
};
```

### 3. Correct Script Construction

**Problem:** The singleton output script must NOT include a push opcode before the 36-byte ref.

```
CORRECT: d8<ref>7576a914...
WRONG:   d824<ref>7576a914...  // The 24 breaks it
```

---

## Prerequisites

> **Two GitHub orgs host Radiant code.** Both `github.com/RadiantBlockchain/*`
> and `github.com/Radiant-Core/*` are real and active as of 2026-04. This guide
> uses specific-path links (e.g. `RadiantBlockchain/radiant-node` for the node
> itself, `Radiant-Core/radiant-mcp-server` for the MCP server). **Before
> cloning or installing any dependency this guide links to, verify on
> [radiantblockchain.org](https://radiantblockchain.org) or in the
> `#dev` / `#announcements` channels of the Radiant Discord that you are
> pulling from the intended org** — an attacker forking the less-canonical
> path could insert compromised builds. Pinning SHAs (as shown below for
> radiantjs) is the durable defense.

### Photonic as Reference, Not as Truth

Photonic Wallet's TypeScript source is the most widely-deployed Radiant
wallet codebase and the de-facto reference for Glyph/dMint payload
shape. Most readers of this guide will (correctly) consult Photonic
when a question isn't answered here.

**Photonic is not infallible.** Treat it as a reference, not as a
specification:

- **Photonic encodes; Photonic does not always validate.** Photonic
  wraps `main.b` in CBOR tag 64 on emit (see "Decoding `main.b`"
  above) but accepts both wrapped and unwrapped forms on decode.
  Following the emit side blindly produces tokens that decode in
  Photonic but TypeError in cbor2-based or strict decoders.
- **Photonic targets V2; the chain runs V1.** Photonic's dMint UI
  builds V2 deploy shapes. Every dMint contract observable on
  mainnet is V1. Mirroring Photonic for dMint will silently produce
  unmineable tokens. (See the V2 footgun section.)
- **Photonic has security-questionable patterns of its own.** Don't
  copy `eval`-adjacent CBOR parsing tricks, ad-hoc PRNG seeding for
  ref-seeds, or signing flows that round-trip private keys through
  the renderer thread. Each pattern needs to clear your own threat
  model.

**Divergence-tracking discipline.** When you deviate from Photonic
intentionally — to follow this guide's mainnet-verified shapes, to
fix a bug, or to harden a code path — record the deviation in a
`docs/divergence-from-photonic.md` file at the root of your wallet
project. Each entry: (a) the Photonic source file + commit + line
range, (b) the divergent path in your code, (c) a one-paragraph
justification, (d) the mainnet txid or test fixture that validates
the divergent shape. This is how you keep Photonic as a reference
without inheriting every Photonic-shaped bug.

### Software Requirements

1. **Radiant Node** (v2.3.0 or newer, wallet-enabled build).

   The wallet-capability story is not obvious from release titles:
   - **v2.1.2**: prebuilt linux-x64 tarballs on GitHub releases are actually ARM64
     binaries mislabeled as x64. On an Intel/AMD host you'll hit "Exec format error".
     Build from source or upgrade.
   - **v2.2.0**: prebuilt linux-x64 runs on x86_64 but **ships without wallet support**
     compiled in. `listwallets`, `listunspent`, `dumpprivkey`, and
     `signrawtransactionwithwallet` all return `-32601 Method not found`. Every
     minting flow in this guide depends on wallet RPCs, so v2.2.0 is unusable here.
   - **v2.3.0+**: prebuilt linux-x64, wallet-enabled. This is the first release
     the guide's examples have been verified against.

   Verify your binary actually has the wallet before proceeding:
   ```bash
   # Expected: [""] (default wallet loaded) or ["<wallet-name>", ...].
   # If you get error code -32601 "Method not found", you're on a
   # node-only build — upgrade.
   radiant-cli -datadir=/home/radiant/.radiant listwallets
   ```

   Docker: avoid `:latest`, pin the version, and rebuild with `--no-cache` on
   version bumps (Docker layer caching will happily serve an old binary otherwise).
   ```bash
   # Example — rebuild explicitly from a v2.3.0 Dockerfile against the official tarball
   docker build --no-cache -t radiant-core:2.3.0 -f Dockerfile.mainnet.v2 .
   docker run -d --name radiant-node \
     -p 127.0.0.1:7332:7332 \
     -p 7333:7333 \
     -v radiant-data:/home/radiant/.radiant \
     radiant-core:2.3.0
   ```

   **Verify the tarball SHA256 before you RUN it.** Your Dockerfile should
   contain an explicit checksum step so a swapped release asset fails the
   build rather than silently producing a malicious node. Copy the published
   SHA from the GitHub release page, then:

   ```dockerfile
   ARG RADIANT_VERSION=2.3.0
   ARG RADIANT_SHA256=<paste-from-release-page>
   RUN curl -fsSLO "https://github.com/RadiantBlockchain/radiant-node/releases/download/v${RADIANT_VERSION}/radiant-core-${RADIANT_VERSION}-linux-x64.tar.gz" && \
       echo "${RADIANT_SHA256}  radiant-core-${RADIANT_VERSION}-linux-x64.tar.gz" | sha256sum -c - && \
       tar xzf "radiant-core-${RADIANT_VERSION}-linux-x64.tar.gz"
   ```

   If upstream releases change archive layout between minor versions
   (v2.2.0 nested under `radiant-core-linux-x64/`, v2.3.0 at archive root),
   inspect with `tar tzf` before updating your `cp` paths — but never skip
   the checksum step.

   **Bind RPC to `127.0.0.1:` on the host.** The P2P port 7333 is the only port
   that should face the public internet. See "Networking the Node" below for the
   matching `radiant.conf` settings when the node and your PHP backend run in
   separate Docker containers.

2. **Node.js** - v20+ for signing scripts (v18 EOL, v24 works for our needs).
   ```bash
   node --version  # Should be 20.x or higher
   ```

3. **radiantjs Library** - For transaction signing.

   `@radiantblockchain/radiantjs` is **not published on the npm registry.**
   Install the `chainbow` fork from GitHub — ideally pinned to a commit SHA
   you've reviewed, since this library sits directly in your signing path:
   ```bash
   # Pin to a specific commit for reproducibility + supply-chain safety
   npm install github:chainbow/radiantjs#<commit-sha>
   # Or, less safely, follow master
   npm install github:chainbow/radiantjs
   ```
   Commit a `package-lock.json` alongside so the exact resolved tarball is
   frozen across machines.

   The signing script does `require('@radiantblockchain/radiantjs')` because the
   package's own `package.json` declares the scoped name. **npm's resolved
   install path depends on npm version:** recent npm (10+) often places the tree
   at `node_modules/radiantjs/` (following the dependency key you used), not
   `node_modules/@radiantblockchain/radiantjs/`. If the scoped require path
   doesn't resolve after `npm install`, bridge them with a symlink:

   ```bash
   mkdir -p node_modules/@radiantblockchain
   ln -sfn ../radiantjs node_modules/@radiantblockchain/radiantjs
   ```

   The Dockerfile pattern in "Calling the Signer from PHP" below does this
   automatically — you don't need to do it by hand if you're installing into
   `/opt/signing-deps/`.

   In a `package.json`:
   ```json
   "dependencies": {
     "radiantjs": "github:chainbow/radiantjs#<commit-sha>"
   }
   ```

4. **CBOR Library** - For metadata encoding

   **For Node.js/backend:**
   ```bash
   npm install cbor
   ```

   **For browser/frontend - Download and include in HTML:**
   ```bash
   # Pin to a specific 40-char commit SHA from https://github.com/paroga/cbor-js/commits/master
   # (no release tags exist). Review the diff from whatever commit you pick back
   # to the oldest commit you trust before vendoring.
   COMMIT="<40-hex-char-commit-sha>"

   # The `-f` flag makes curl fail loudly on HTTP errors instead of silently
   # writing the HTML error page as your "CBOR library."
   curl -fo js/cbor.min.js "https://raw.githubusercontent.com/paroga/cbor-js/${COMMIT}/cbor.js"

   # Record the hash in your deploy manifest, then check it on every deploy:
   sha256sum js/cbor.min.js
   ```

   > **A sha256 check is not a trust anchor on first fetch.** If a MITM poisons
   > the first download, the hash you record is the attacker's. True integrity
   > requires either (a) comparing against a hash from an independent channel
   > (e.g. hash published in a Radiant Discord pinned message + in the guide
   > maintainer's signed commit), or (b) reviewing the downloaded JS diff
   > yourself before committing it. Once vendored and committed, subsequent
   > builds verify against your own record — which is what matters operationally.

   > ⚠️  **Beware of ecosystem drift: multiple CBOR libraries exist.** `paroga/cbor-js`
   > is the reference implementation this guide recommends. However, some Radiant
   > projects vendor a **custom minimal CBOR encoder** instead (smaller file size,
   > subset of RFC 8949). The custom encoder may handle `Uint8Array` vs `Array`
   > for CBOR major-type-2 byte strings **differently** — which is precisely
   > the "Uint8Array trap" documented below. If you copy CBOR code from a
   > different Radiant codebase, diff against `paroga/cbor-js` first or you may
   > mint permanently broken NFTs on-chain. Record the SHA256 of your chosen
   > library in your deploy manifest.
   >
   > **Pin a version you've reviewed.** Fetching from `master` at build time
   > is a supply-chain hazard — a repo takeover or network MITM can swap the CBOR
   > library and silently corrupt every glyph payload you mint. Either:
   > - Vendor the file into your repo and commit a SHA256-pinned copy, or
   > - Use an `<script integrity="sha384-...">` subresource-integrity tag when
   >   loading from a CDN.
   >
   > Be aware also of **Cloudflare / CDN caching** on unversioned JS/CSS. If your
   > nginx sends `Cache-Control: public, immutable` with a 7-day expiry, CDNs
   > will hold the stale file for a week — code fixes won't reach users. For
   > unversioned JS/CSS, use short TTL + `must-revalidate`, or embed a version
   > query string / content hash in the filename. Reserve `immutable` for
   > content-addressed assets.

   **Load in HTML (BEFORE blockchain scripts):**
   ```html
   <!-- CBOR must load FIRST -->
   <script src="js/cbor.min.js"></script>
   <!-- Then blockchain code -->
   <script src="js/radiant_chain.js"></script>
   <script src="js/glyph_minter.js"></script>
   ```

   **Verify it's loaded:**
   ```javascript
   console.log(typeof CBOR);  // Must output "object", NOT "undefined"
   ```

### Knowledge Requirements

- Basic understanding of Bitcoin-style transactions
- Familiarity with hex encoding and byte manipulation
- JavaScript or PHP programming
- Understanding of public/private key cryptography

### Funding Your First Wallet — Start on Regtest

**Do not mint with real RXD until you have completed at least one full
commit → reveal → wallet-recognition cycle on regtest.** The two-transaction
commit/reveal pattern has three independent failure modes (commit-script
mismatch, fee miscalculation, reveal-tx malleation) that all look the same
from the outside: your NFT is gone and your coins are gone. Regtest gives you
unlimited free retries.

**Regtest bring-up:**

```bash
# Start a node in regtest mode
radiantd -regtest -daemon

# Generate an address and fund it (101 blocks so first coinbase matures)
ADDR=$(radiant-cli -regtest getnewaddress)
radiant-cli -regtest generatetoaddress 101 "$ADDR"

# Verify balance
radiant-cli -regtest getbalance
# Expected: 50.00000000 (first coinbase, matured)
```

Point your minter's RPC config at the regtest node (default port `18332`,
separate datadir from mainnet). Run your full mint flow end to end and
confirm:

1. The reveal transaction confirms in a block you generate.
2. `listunspent` on the destination wallet shows the Glyph UTXO.
3. A view-only classifier (e.g. `radiant-ledger-app/view-only-ui/`)
   recognises the scriptPubKey shape.

Only after all three check out should you touch mainnet. Mainnet funding —
acquiring real RXD — is outside this guide; see the Radiant community
resources at https://radiantblockchain.org and the `#mining` / `#general`
channels on the Radiant Discord.

---

## Infrastructure Setup

Most of the real pain in getting a Glyph NFT to mint comes from infrastructure,
not protocol — missing wallet RPCs on the node, the web container not being able
to reach the node, Node.js not being installed where your signing script runs,
deploy pipelines that drop `node_modules` on the floor. These three sections
walk through the setup that the example code later in this guide assumes.

### Getting a Working Radiant Node

**1. Version & wallet verification.** See the Prerequisites note on the v2.1.2 /
v2.2.0 / v2.3.0 landmines. After your container starts, run:

```bash
docker exec radiant-node radiant-cli -datadir=/home/radiant/.radiant listwallets
# Expected: [""] (default wallet loaded) or ["<wallet-name>", ...].
# If you get error code -32601 "Method not found", your binary is node-only.
# Rebuild from a v2.3.0 wallet-enabled source.
```

If you built the image from source, confirm the wallet compiled in:

```bash
docker run --rm --entrypoint=sh <image> -c 'strings /usr/local/bin/radiantd | grep -iE "^listunspent$"'
# Should print: listunspent
```

**2. Protect `wallet.dat` at upgrade time.** The wallet lives in your node's
datadir volume — e.g. `/home/radiant/.radiant/wallet.dat` inside the container.
Persisting the volume is necessary but **not sufficient** across version jumps:

- A node-only binary leaves `wallet.dat` untouched (no wallet code = nothing
  that would touch the file).
- A wallet-enabled binary loaded against an older or unexpected wallet format
  can auto-initialize a fresh `wallet.dat` at startup, silently hiding the
  original behind a blank keypool. The symptom is `getaddressinfo <addr>`
  returning `ismine: false` for an address you know you funded.

**Always copy `wallet.dat` out before upgrading or rebuilding the image.**

**Multi-wallet and named-wallet RPC.** If you run more than one wallet on
the node (e.g. a hot mint wallet plus a separate change wallet), you must
address them explicitly — the default wallet is only `""` when there is
exactly one loaded. Relevant commands:

```bash
# Create a named wallet (one time)
radiant-cli createwallet "mint-hot"

# Load it on restart if it isn't auto-loaded (check listwallets)
radiant-cli loadwallet "mint-hot"

# Target a specific wallet for an RPC call
radiant-cli -rpcwallet=mint-hot getbalance
radiant-cli -rpcwallet=mint-hot listunspent
```

PHP code that builds transactions should either (a) always pass
`-rpcwallet=<name>` by using the per-wallet HTTP endpoint
`http://node:7332/wallet/mint-hot` in its RPC URL, or (b) ensure only one
wallet is loaded at a time. Mixing unqualified calls with multiple loaded
wallets produces "Wallet file not specified" errors that look transient but
are deterministic.

```bash
# Before the upgrade
docker cp radiant-node:/home/radiant/.radiant/wallet.dat ./wallet.dat.backup.$(date +%Y%m%d-%H%M%S)
sha256sum ./wallet.dat.backup.*

# If the post-upgrade wallet looks blank, stop the container, swap the backup
# into the volume, and restart:
docker stop radiant-node
cp ./wallet.dat.backup.<timestamp> \
   /var/lib/docker/volumes/<your-volume>/_data/wallet.dat
chmod 600 /var/lib/docker/volumes/<your-volume>/_data/wallet.dat
docker start radiant-node
```

After the upgrade, verify the expected address is still yours:

```bash
docker exec radiant-node radiant-cli -datadir=/home/radiant/.radiant \
  getaddressinfo <your-hot-wallet-address>
# Expect: "ismine": true, "iswatchonly": false

docker exec radiant-node radiant-cli -datadir=/home/radiant/.radiant \
  listunspent 0 9999999 '["<your-hot-wallet-address>"]' | head -20
```

**3. Rebuild with `--no-cache` on version bumps.** Docker's layer cache will
happily reuse an old binary layer even when the Dockerfile now points to a new
release. A rebuild that appears to succeed can silently keep you on the
wallet-less v2.2.0 binary. Always:

```bash
docker build --no-cache -f Dockerfile.mainnet.v2 -t radiant-core:2.3.0 .
```

…and re-check `radiant-cli --version` inside the running container to confirm.

### Networking the Node

If the node and your PHP backend run in the **same** container (unusual), you
can leave `rpcbind=127.0.0.1`. Everywhere else — separate containers, or
containers on separate Docker networks — that default breaks RPC access silently.

**In `radiant.conf`:**

```ini
# Bind to all interfaces so containers on the same Docker network can reach us.
rpcbind=0.0.0.0

# Restrict who's allowed to talk to RPC. Tighten this as much as you can —
# find your app network's actual CIDR with:
#   docker network inspect <app-network> --format '{{(index .IPAM.Config 0).Subnet}}'
# and replace the broad 172.16.0.0/12 fallback below with that CIDR.
rpcallowip=127.0.0.1
rpcallowip=172.20.0.0/16           # example: tighten to your app network
# rpcallowip=172.16.0.0/12         # broad Docker-default fallback — AVOID on
#                                  # multi-tenant hosts; any other container in
#                                  # the 172.16-31.x range can reach your RPC
#                                  # with only the rpcpassword for auth.

# Standard RPC auth — override these in an environment file, not in-repo.
rpcuser=your_rpc_user
rpcpassword=CHANGE_ME_IN_YOUR_ENV_FILE
```

**On the host, never bind RPC to `0.0.0.0:7332`.** An exposed RPC port + weak
password = drained wallet:

```yaml
# docker-compose.yml — correct
ports:
  - "127.0.0.1:7332:7332"   # RPC — host-local only
  - "7333:7333"              # P2P — public is fine
  - "127.0.0.1:9100:9100"    # Prometheus metrics — host-local
```

**Connecting from another container.** If your PHP backend lives in a separate
compose file / network, attach the Radiant container to that network with an
alias so app code can use a stable hostname:

```bash
docker network connect --alias radiant-rpc <app-network> radiant-node
```

Then in your app's env: `RADIANT_RPC_HOST=radiant-rpc`. DNS resolves to the
container's IP on the shared network; `rpcallowip=172.16.0.0/12` covers both
sides of the bridge.

### Calling the Signer from PHP

The Signing Challenge section later in this guide shows a Node.js script
(`scripts/sign_reveal.js`) that builds and signs the reveal transaction. It has
to be a subprocess because PHP's wallet RPCs can't sign the non-standard
`nftCommitScript`. Getting PHP to actually *invoke* it reliably in a Dockerized
deployment has a few sharp edges.

**1. Node.js has to be inside the web container.** The default
`php:8.2-fpm-alpine` image does not include Node. `sh: node: not found` is the
symptom. In your Dockerfile:

```dockerfile
RUN apk add --no-cache nodejs npm git
```

**2. Install signing deps OUTSIDE the volume mount.** If your `scripts/`
directory is bind-mounted from the host (common for rapid iteration), any
`node_modules` you install at `/var/www/html/your-app/scripts/node_modules`
gets *hidden* by the mount the moment the container starts. Install at an
image-local path and expose via `NODE_PATH`:

```dockerfile
# Pin a specific commit SHA. Treat chainbow/radiantjs as an untrusted
# dependency (see Supply-Chain section below) — a moving ref lets a
# compromised upstream swap in a malicious build on your next rebuild.
# Replace <pinned-sha> with a reviewed commit from the repo.
RUN mkdir -p /opt/signing-deps && cd /opt/signing-deps && \
    echo '{"name":"signing","version":"1.0.0","dependencies":{"radiantjs":"github:chainbow/radiantjs#<pinned-sha>"}}' > package.json && \
    echo '{}' > package-lock.json && \
    npm ci --omit=dev 2>/dev/null || npm install --omit=dev --no-package-lock && \
    mkdir -p node_modules/@radiantblockchain && \
    ln -sfn ../radiantjs node_modules/@radiantblockchain/radiantjs

ENV NODE_PATH=/opt/signing-deps/node_modules
```

**Never use an unpinned `github:chainbow/radiantjs` dependency in a production
image.** GitHub tarball installs resolve the default branch at image-build
time — a compromised upstream or a branch rename could silently substitute
code that signs transactions with attacker-controlled values. Use a SHA you
have reviewed, and update the pin through a deliberate PR, not a rebuild.

The symlink exists because npm installs the package using its declared name
(`radiantjs` top-level, despite the package's own `package.json` declaring
`@radiantblockchain/radiantjs`). The signing script requires the scoped path;
the symlink makes both resolve.

Also check your deploy pipeline: `rsync --exclude node_modules/` matches
*every* `node_modules` directory, so scripts-level deps never reach the server
that way. Either allow-list the specific path or install inside the image at
build time as above.

**3. `proc_close()` can lie about exit codes.** When PHP shells out to Node and
polls `proc_get_status()` in a loop to detect completion, `proc_get_status()`
reaps the process and consumes the exit code. The subsequent `proc_close()`
then returns `-1` forever, so code that does `success = ($returnCode === 0)`
treats every call as failed — even when Node exited 0 with a valid signed
transaction in stdout.

**Correct pattern**: capture the exit code the moment the status transitions
to `running=false`, and fall back to that if `proc_close()` returns `-1`.
Additionally, trust the parsed stdout JSON when it's well-formed — the signed
transaction itself is the artifact you care about, and the blockchain will
reject it if it's malformed regardless of any process exit code:

```php
function signRevealViaNode(array $params, string $scriptPath): array {
    $descriptors = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    $proc = proc_open(['node', $scriptPath], $descriptors, $pipes);
    if (!is_resource($proc)) {
        throw new RuntimeException('failed to spawn node');
    }

    fwrite($pipes[0], json_encode($params));
    fclose($pipes[0]);

    $stdout = '';
    $stderr = '';
    $capturedExitCode = null;
    stream_set_blocking($pipes[1], false);
    stream_set_blocking($pipes[2], false);

    $start = time();
    $timedOut = false;
    while (true) {
        $status = proc_get_status($proc);
        $stdout .= (string) stream_get_contents($pipes[1]);
        $stderr .= (string) stream_get_contents($pipes[2]);
        if (!$status['running']) {
            $capturedExitCode = $status['exitcode']; // capture BEFORE proc_close
            break;
        }
        if (time() - $start >= 60) {
            // Timeout — stop the Node child so it doesn't become a zombie
            // and hold the wallet WIF in memory longer than necessary.
            // SIGTERM first, then SIGKILL after 2s grace.
            proc_terminate($proc, 15);
            usleep(2_000_000);
            if (proc_get_status($proc)['running']) {
                proc_terminate($proc, 9);
            }
            $timedOut = true;
            break;
        }
        usleep(50_000);
    }
    $stdout .= (string) stream_get_contents($pipes[1]);
    $stderr .= (string) stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);

    $closeCode = proc_close($proc);
    if ($timedOut) {
        throw new RuntimeException("sign timed out after 60s: $stderr");
    }
    $exit = ($closeCode === -1 && $capturedExitCode !== null)
        ? $capturedExitCode
        : $closeCode;

    // Trust parsed JSON over exit code — the signed tx is the binding artifact.
    $parsed = json_decode($stdout, true);
    if (is_array($parsed) && !empty($parsed['success']) && !empty($parsed['signedTx'])) {
        return $parsed;
    }

    throw new RuntimeException("sign failed (exit=$exit): $stderr");
}
```

**4. Pass WIF via stdin JSON, never argv or env.** argv is visible in
`/proc/<pid>/cmdline`, env is visible in `/proc/<pid>/environ`. The stdin pipe
is the only channel that doesn't leave the key in the process table.

**5. Verify the signed tx before broadcasting.** The stdout-JSON-trust pattern
above accepts any well-formed `{success:true, signedTx}` and broadcasts it.
That's convenient but not enough on its own: a compromised signing script (or
a future supply-chain swap of `chainbow/radiantjs`) could emit a structurally
valid tx that *pays an attacker address*. The blockchain won't reject a valid
tx just because it wasn't the one you expected — it only rejects malformed
ones.

Before `sendrawtransaction`, decode the returned raw tx and assert the
**entire** output set matches what you asked for. Checking only `vout[0]`
is insufficient — a compromised signer can keep output 0 correct and smuggle
an attacker-funding output 2, quietly skimming RXD per mint.

```php
// After $parsed['signedTx'] comes back:
$decoded = $rpc->call('decoderawtransaction', [$parsed['signedTx']]);

// 1. Output count must match what you built. Typical NFT mint: 2 outputs
//    (singleton at vout[0] + change at vout[1]). No extra outputs allowed.
if (count($decoded['vout']) !== $expectedOutputCount) {
    throw new RuntimeException('unexpected output count — refusing to broadcast');
}

// 2. Output 0 must be the singleton script with the expected destination.
//    Compare in integer photons (NOT float RXD — IEEE-754 drift will reject
//    legitimate txs at 8-decimal precision).
$out0 = $decoded['vout'][0];
$out0Sats = intval(round(floatval($out0['value']) * 100_000_000));
if ($out0Sats !== $expectedNftOutputSats) {
    throw new RuntimeException('signed tx NFT output value mismatch');
}
$expectedScript = 'd8' . $ref . '7576a914' . $expectedDestPubkeyhash . '88ac';
if (strtolower($out0['scriptPubKey']['hex']) !== $expectedScript) {
    throw new RuntimeException('signed tx NFT output script mismatch');
}

// 3. Every non-NFT output (change, if present) must be a plain P2PKH to a
//    pubkeyhash from your own allow-list. Reject any novel destination —
//    that's where a compromised signer would drain to.
$allowedChangeHashes = array_map('strtolower', $yourAllowedChangePubkeyhashes);
for ($i = 1; $i < count($decoded['vout']); $i++) {
    $o = $decoded['vout'][$i];
    $spk = strtolower($o['scriptPubKey']['hex']);
    // Expect exactly 76a914<pkh20>88ac, 25 bytes = 50 hex chars
    if (strlen($spk) !== 50 || substr($spk, 0, 6) !== '76a914' || substr($spk, -4) !== '88ac') {
        throw new RuntimeException("vout[$i] is not a plain P2PKH");
    }
    $pkh = substr($spk, 6, 40);
    if (!in_array($pkh, $allowedChangeHashes, true)) {
        throw new RuntimeException("vout[$i] pays an unexpected address — refusing to broadcast");
    }
}

// 4. Value conservation: Σ outputs + expected fee == Σ inputs (within 1%).
//    Use decoderawtransaction on each prevout to get the input values.
$inSats = array_sum(array_map(function($vin) use ($rpc) {
    $prev = $rpc->call('getrawtransaction', [$vin['txid'], true]);
    return intval(round(floatval($prev['vout'][$vin['vout']]['value']) * 100_000_000));
}, $decoded['vin']));
$outSats = array_sum(array_map(fn($o) => intval(round(floatval($o['value']) * 100_000_000)), $decoded['vout']));
$actualFee = $inSats - $outSats;
// Zero tolerance: you constructed the tx above, so its fee is deterministic.
// Any drift means the signer or an intermediary changed the structure. A loose
// tolerance (`max(1000, fee * 0.01)`) lets a compromised signer skim up to
// ~0.001 RXD per mint — small per-mint but real money at volume.
if ($actualFee !== $expectedFeeSats) {
    throw new RuntimeException("fee mismatch: signer used $actualFee, expected $expectedFeeSats");
}
```

This full gate — output-count + NFT output + change allow-list + value
conservation — is the defense against a compromised `chainbow/radiantjs` or
signer. Do not skip any of the four checks. A compromised signer that splits
outputs to smuggle a skim-drain is the primary documented attack surface
here; partial validation catches the easy attacks but misses the
output-splitting variant.

**6. RPC creds never touch the browser.** Wrap every blockchain call behind a
PHP endpoint that:
- Authenticates the caller (session cookie + CSRF token for state-changing calls)
- Rate-limits by IP and by session
- Allow-lists *which* RPC methods are callable. `dumpprivkey`, `dumpwallet`,
  `walletpassphrase`, `sendtoaddress`, and related privileged methods must
  never be reachable from a browser-initiated request, ever. A single
  mis-routed `dumpprivkey` call drains the wallet in one request.

---

## On-Chain Images: The `main` Field

> **This is the most commonly missed requirement.** Without on-chain image data, your NFT will be invisible in wallets.

### Why On-Chain Images Are Required

Glyph wallets (Glyphium, Glyph Explorer) look for the `main` field to display NFT images. If this field is missing or empty:
- The NFT appears as a blank card
- No image preview is shown
- Only the NFT name (if readable) appears

IPFS links in the `loc` field are for **full-resolution backup**, not wallet display.

### The `main` Field Structure

```javascript
{
    p: [2],
    name: "My NFT",
    main: {
        t: 'image/webp',           // MIME type (must match thumbnail format)
        b: thumbnailUint8Array     // Image data as Uint8Array
    },
    loc: 'ipfs://Qm...',           // Full-res backup (optional)
    loc_hash: 'sha256:abcd…'       // RECOMMENDED — sha256 of the loc asset's raw bytes
}
```

> **Bind off-chain content to the NFT with `loc_hash`.** IPFS (and any other
> off-chain pointer) guarantees retrievability, not authenticity once the
> pinning service is out of your control. Recording `sha256:<hex>` of the
> full-resolution file's raw bytes inside the CBOR payload gives viewers a
> way to detect substitution: compute `sha256(bytes)` of whatever the
> gateway returns, compare, reject mismatches. Without this field,
> "`ipfs://…` points at content of the same CID" is the only check anyone
> downstream can make — and CIDs can be swapped at the application layer
> (pinata config, wallet renderer, custom gateway) before the user sees
> them. `loc_hash` costs ~40 bytes on chain; the integrity guarantee is
> disproportionate.

**Consumer-side verification** — the whole point of `loc_hash` is that the
*renderer* checks it. Minimal viewer code (browser-side, matching the
renderer in `radiant-ledger-app/view-only-ui/`):

```javascript
async function renderLoc(payload, gatewayUrl) {
    if (!payload.loc || !payload.loc_hash) {
        return { ok: false, reason: 'no loc/loc_hash on this NFT — cannot verify' };
    }
    const m = /^sha256:([0-9a-f]{64})$/i.exec(payload.loc_hash);
    if (!m) return { ok: false, reason: 'loc_hash format must be sha256:<64 hex>' };
    const expected = m[1].toLowerCase();

    const res = await fetch(gatewayUrl);
    if (!res.ok) return { ok: false, reason: `gateway returned HTTP ${res.status}` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const got = Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0')).join('');

    if (got !== expected) {
        return { ok: false, reason: `hash mismatch: chain says ${expected}, gateway served ${got}` };
    }
    return { ok: true, bytes };
}
```

Renderers that don't implement this check can still display the NFT — but
they cannot claim the `loc` content is authentic. If your renderer is
public-facing, document this contract: "we verify loc_hash when present;
we render `main.b` (on-chain) always."

### Thumbnail Size vs Cost Tradeoffs

| Format | Dimensions | Quality | Approx. Bytes | Pre-V2 Cost | Post-V2 Cost (10x) |
|--------|------------|---------|---------------|-------------|---------------------|
| JPEG   | 150px      | 65%     | 5-8 KB        | ~0.07 RXD   | ~0.7 RXD            |
| JPEG   | 200px      | 75%     | 14-18 KB      | ~0.15 RXD   | ~1.5 RXD            |
| WebP   | 200px      | 85%     | 15-17 KB      | ~0.17 RXD   | ~1.7 RXD            |
| **WebP** | **225px** | **90%** | **20-25 KB** | **~0.22 RXD** | **~2.2 RXD**      |
| PNG    | 200px      | lossless| 70-85 KB      | ~0.85 RXD   | ~8.5 RXD            |

**Recommendation:** Use **WebP format** at 225px max dimension with 90% quality. This provides:
- Sharp, clear images with excellent detail retention
- Best quality-to-size ratio of any format
- Good balance between quality and transaction costs
- Full compatibility with Glyphium wallet and Glyph Explorer

**Why WebP over JPEG?**
- WebP produces fewer compression artifacts at equivalent file sizes
- Single lossy compression step (capture as PNG, compress to WebP) vs double (JPEG capture → JPEG thumbnail)
- Supported by all modern browsers and Glyph wallets
- At 90% quality, produces noticeably sharper images than JPEG at similar file sizes

### JavaScript Thumbnail Creation

```javascript
async createThumbnail(dataUrl, maxSize = 225, quality = 0.90) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            // Calculate dimensions maintaining aspect ratio
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxSize) {
                    height = Math.round((height * maxSize) / width);
                    width = maxSize;
                }
            } else {
                if (height > maxSize) {
                    width = Math.round((width * maxSize) / height);
                    height = maxSize;
                }
            }

            // Create canvas and draw scaled image
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to WebP for best quality/size ratio
            canvas.toBlob((blob) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const uint8Array = new Uint8Array(reader.result);
                    console.log(`Thumbnail: ${width}x${height}, ${uint8Array.length} bytes (WebP)`);
                    resolve(uint8Array);
                };
                reader.onerror = reject;
                reader.readAsArrayBuffer(blob);
            }, 'image/webp', quality);
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}
```

### Adding `main` Field to Payload

```javascript
function createGlyphPayload(photoData, metadata) {
    const payload = {
        p: [2],  // NFT protocol
        name: metadata.name,
        type: metadata.type || 'photo',
        attrs: metadata.attrs || {}
    };

    // CRITICAL: Add thumbnail for wallet display
    if (photoData.thumbnailData instanceof Uint8Array) {
        payload.main = {
            t: 'image/webp',  // WebP for best quality/size
            b: photoData.thumbnailData
        };
    }

    // Add IPFS for full resolution (optional)
    if (photoData.ipfsUrl) {
        payload.loc = photoData.ipfsUrl;
    }

    return payload;
}
```

> ⚠️  **`paroga/cbor-js` Uint8Array trap.** The `b` field above works only if
> `photoData.thumbnailData` is a real `Uint8Array`. If it's a plain `Array` of
> numbers (e.g. `Array.from(uint8)`), `paroga/cbor-js` encodes it as a CBOR
> **array of integers (major type 4)**, not a **byte string (major type 2)**.
> The bytes land on chain, but Glyph wallets look for major type 2 and render
> your NFT as a blank card. Two checks save you:
>
> 1. **At payload-build time**, assert the type: `if (!(thumbnailData instanceof Uint8Array)) throw new Error('thumbnail must be Uint8Array');`
> 2. **After encoding**, round-trip the CBOR and confirm `main.b` comes back
>    as bytes. The `in` and `by` ref fields are a good positive control —
>    they're 36-byte buffers and render correctly on existing NFTs; if
>    `main.b` decodes differently than they do, you have the trap.
>
> Common ways to end up with a plain Array instead of Uint8Array: JSON
> round-trips (`JSON.parse(JSON.stringify(payload))` converts `Uint8Array` to
> a numeric `Array`), shallow copies via `{ ...obj }` into a new plain object,
> and anything that crosses a `postMessage` / `structuredClone` boundary
> configured incorrectly. Handle `Uint8Array` as the last step before CBOR
> encoding.

### Decoding `main.b`: Handle CBORTag 64 (Uint8 array)

Photonic Wallet — the canonical Radiant browser wallet — wraps embedded
binary blobs in **CBOR tag 64** (RFC 8746 "uint8 typed array"). The
on-chain GLYPH dMint deploy and every Photonic-built NFT mint with
embedded media use this encoding. If your decoder does not unwrap the
tag, calling `bytes(payload['main']['b'])` (or the JS equivalent) raises
a `TypeError` and your wallet either crashes or silently renders a
blank card.

**Defensive pattern (Python with cbor2):**

```python
import cbor2

def decode_main_blob(main_field):
    blob = main_field["b"]
    if isinstance(blob, cbor2.CBORTag):
        blob = blob.value
    return bytes(blob)
```

**Defensive pattern (JavaScript):**

```javascript
function decodeMainBlob(main) {
    let blob = main.b;
    // cbor-js represents tags as { tag: N, value: ... }
    if (blob && typeof blob === 'object' && 'tag' in blob && 'value' in blob) {
        blob = blob.value;
    }
    return new Uint8Array(blob);
}
```

When building (not decoding), follow the convention: emit raw bytes
without a tag wrapper for new mints — the unwrap is purely a decode-side
compatibility shim for Photonic-built tokens already on chain.
Implementation reference: pyrxd `src/pyrxd/glyph/payload.py`
`decode_payload`'s CBORTag-64 unwrap (lines 115–122).

---

## Architecture

### Transaction Components

#### Commit Transaction
```
Inputs:  [Funding UTXO(s)]
Outputs: [nftCommitScript Output, Change Output (optional)]

nftCommitScript validates:
  1. Glyph payload hash (double SHA256 of CBOR)
  2. "gly" marker presence
  3. Singleton ref in reveal transaction outputs
  4. P2PKH signature
```

#### Reveal Transaction
```
Inputs:  [Commit Output]
         ScriptSig: <signature> <pubkey> <"gly"> <CBOR payload>

Outputs: [Singleton NFT Output]
         Script: OP_PUSHINPUTREFSINGLETON <36-byte ref> OP_DROP <P2PKH>
```

### Key Data Structures

**36-Byte Ref Format:**
```
ref = reversed(commitTxid) + littleEndian(commitVout)
    = 32 bytes              + 4 bytes
```

**Example:**
```javascript
Commit TXID: 6afb402d085b2214b44853dad42499b5a02b823153e2789bb2bfb0e522693c26
Reversed:    263c6922e5b0bfb29b78e25331823ba0b59924d4da5348b414225b082d40fb6a
Vout: 0
Vout LE:     00000000
Ref:         263c6922e5b0bfb29b78e25331823ba0b59924d4da5348b414225b082d40fb6a00000000
```

---

## Fungible Tokens (FTs) — The Other Half of Glyph

The earlier sections focus on NFTs (protocol `p: [2]`), which use the
`OP_PUSHINPUTREFSINGLETON` (`0xd8`) wrapper around P2PKH. Fungible tokens
(protocol `p: [1]`) use a **different** wrapper — and understanding both shapes
is critical for wallets, explorers, and anyone building on top of the Glyph
protocol.

### NFT vs FT Output Script Comparison

| | NFT (singleton, 63 B) | FT (holder, 75 B) |
|---|---|---|
| **Layout** | `d8 <ref36> 75 76a914 <pkh20> 88ac` | `76a914 <pkh20> 88ac bd d0 <ref36> dec0e9aa76e378e4a269e69d` |
| **P2PKH position** | Suffix (after ref + OP_DROP) | Prefix (before the FT machinery) |
| **Ref opcode** | `d8` OP_PUSHINPUTREFSINGLETON | `d0` OP_PUSHINPUTREF (non-unique) |
| **Spend scriptSig** | `<sig> <pubkey>` (identical to P2PKH) | `<sig> <pubkey>` (identical to P2PKH) |
| **Token amount** | N/A (unique token, not a quantity) | UTXO photon value = token balance. No separate amount field. |
| **Key separator** | `75` OP_DROP between ref and P2PKH | `bd` OP_STATESEPARATOR between P2PKH and FT conservation |

### FT Holder Template (75 bytes)

Verified against **2,309 FT holder samples across 6 distinct tokens, 500
mainnet blocks** (tip 420,968 → 420,469). Zero template drift — the 14-byte
opcode/suffix frame (`bd d0 … dec0e9aa76e378e4a269e69d`) is identical across
every token observed. The 36-byte ref in the middle varies per token (it
identifies *which* token), but the surrounding structure is invariant.

```
Byte layout:
  76 a9 14 <pkh:20> 88 ac    ← standard P2PKH (25 bytes) — spendable portion
  bd                          ← OP_STATESEPARATOR (see note below)
  d0 <ref:36>                 ← OP_PUSHINPUTREF + token's 36-byte ref
  de c0 e9 aa 76 e3 78 e4    ← FT conservation epilogue (12 bytes, invariant)
  a2 69 e6 9d
```

**What the epilogue does** (source: [`interpreter.cpp:2167-2204`](https://github.com/RadiantBlockchain/radiant-node/blob/master/src/script/interpreter.cpp#L2167)):

The 12-byte suffix encodes the FT conservation law. The two key introspection
opcodes in the sequence are:

- `e3` = `OP_CODESCRIPTHASHVALUESUM_UTXOS` — sum the photon values of all
  inputs whose `codeScript` hash matches the current script's hash
- `e4` = `OP_CODESCRIPTHASHVALUESUM_OUTPUTS` — same, for outputs

The remaining bytes in the epilogue (`de`, `c0`, `aa`, `76`, `78`, `a2`,
`69`, `9d`) are a mix of BCH-lineage opcodes retained by Radiant (stack
manipulation, comparison, hashing — e.g. `76 = OP_DUP`, `a2 = OP_GREATERTHANOREQUAL`,
`9d = OP_EQUALVERIFY`) and Radiant-specific introspection opcodes (`de`, `c0`,
`aa`, `78`) that feed the state-aware values into the comparison. Calling
them "standard Bitcoin" would be misleading — several are Radiant additions.
Together they wire the two sums into the conservation check. A full opcode-by-opcode decode is available in
[`radiant-ledger-app/docs/solutions/integration-issues/radiant-glyph-ft-template-and-view-only-renderer.md`](https://github.com/Zyrtnin-org/radiant-ledger-app) — for this guide, the important
takeaway is that together they enforce **Σ input photons ≥ Σ output photons**
per codeScript hash — tokens cannot be inflated by a normal spend. Only the
mint-authority script (241 bytes, not documented here) can create new supply.

**`OP_STATESEPARATOR` (`0xbd`)** has consensus-level significance: it splits
the script into a **prologue** (P2PKH, evaluated against the scriptSig for
signature verification) and an **epilogue** (FT conservation, evaluated by
consensus for token-supply invariants). During script *execution*
([`interpreter.cpp:1946`](https://github.com/RadiantBlockchain/radiant-node/blob/master/src/script/interpreter.cpp#L1946))
it acts as a NOP — it doesn't push, pop, or branch — but its *position* in
the script is what determines the boundary between "what the signer proves"
and "what the network enforces." Don't omit it; don't move it. The scriptSig
only needs to satisfy the prologue — which is why FT spends use the same
`<sig> <pubkey>` as plain P2PKH. Ledger apps handle this without modification.

### FT Token Amount

There is no separate "amount" field in the script or CBOR — token balance is
the UTXO's photon value itself. To compute a holder's balance for a given token:

1. Find all UTXOs matching the 75-byte FT holder template for the token's
   36-byte ref AND the holder's 20-byte pubkeyhash.
2. Sum the photon values of those UTXOs.

A holder's total balance can be spread across many UTXOs (similar to RXD coin
fragmentation). A transfer creates new FT UTXOs at the destination with
matching conservation — the sum of output values must not exceed the sum of
input values for that token.

### FT Transaction Output Shapes

Two distinct 241-byte shapes exist; do not confuse them:

| Shape | Where it appears | Spendable? |
|---|---|---|
| **V1 dMint contract UTXO** (241 B = 96-byte state + 145-byte epilogue) | `vout[0]` of every mint tx (recreated each mint), and `vout[0..N-1]` of a V1 dMint deploy reveal (one per parallel contract slot) | Only by a valid PoW-bearing mint input. Not a wallet-spendable shape. |
| **75-byte FT holder** | `vout[1+]` of every mint tx; every output of a plain FT transfer | Spendable with the holder's P2PKH key. |

A plain FT *transfer* (one user sending FT to another) has **no** 241-byte
output — only 75-byte holder outputs. A 241-byte output at `vout[0]` is a
signal that the transaction is a **dMint mint** (or a deploy reveal),
not a plain transfer. See the [Decentralized Mint (dMint)](#decentralized-mint-dmint)
section for the contract layout.

Wallets must skip 241-byte dMint contract outputs — attempting to spend
one without the correct PoW preimage will fail at consensus.

### FT CBOR Metadata

FT reveal transactions embed CBOR metadata using the same extraction pattern
as NFTs. The `vin[0].scriptSig` contains push elements:
`<sig> <pubkey> <"gly" 3B marker> <CBOR payload>`.

Example from the **Glyph Protocol token** (mainnet reveal `b965b32d…` at height
228,604, 65,569-byte payload):

```json
{
  "p": [1, 4],
  "ticker": "GLYPH",
  "name": "Glyph Protocol",
  "desc": "The first of its kind",
  "main": { "t": "image/png", "b": "<65,430-byte PNG>" }
}
```

Key differences from NFT CBOR:
- `p: [1]` or `p: [1, 4]` (FT, or FT + dMint) instead of `p: [2]`
- `ticker` field — short symbol for the token
- `desc` instead of `type`/`attrs`
- `main` can be very large (65 KB+ for a full PNG) — the on-chain image
  represents the token's brand/logo, not a per-unit photo

### Wallet Classifier Patterns

For wallet developers integrating Glyph support — three regex patterns
that classify every mainnet-observed spendable script shape. Tested against
13 golden vectors from real mainnet (2,309 samples, 6 tokens, 500 blocks)
in [`radiant-ledger-app/view-only-ui/fixtures/classifier-vectors.json`](https://github.com/Zyrtnin-org/radiant-ledger-app).

```
Plain P2PKH (25B):   ^76a914[0-9a-f]{40}88ac$
NFT singleton (63B): ^d8[0-9a-f]{72}7576a914[0-9a-f]{40}88ac$
FT holder (75B):     ^76a914[0-9a-f]{40}88acbdd0[0-9a-f]{72}dec0e9aa76e378e4a269e69d$
```

**Cross-language note:** always use whole-string anchoring. Regex flavors differ:

- Python: **`re.fullmatch(pattern, script_hex)`** — do NOT use `re.match` (anchors only to start) or `re.search` (unanchored). Python's `$` matches before a trailing `\n` even in default mode (not only `re.MULTILINE`), so a hex blob with a stray newline appended could sneak garbage past a `re.match(pattern + '$', …)` check.
- Go: `regexp.MustCompile(pattern).MatchString(script_hex)` — `^` and `$` are ASCII-anchored by default, safe.
- Rust: `regex::Regex::new(pattern).unwrap().is_match(script_hex)` — whole-string by the anchors, safe.
- JavaScript: `new RegExp(pattern).test(script_hex)` — `^`/`$` are line anchors only in `m` flag mode; without `m`, they anchor to string boundaries, safe.
- PHP: `preg_match('/' . $pattern . '/', $hex)` — `$` can match before a trailing newline unless you use the `D` flag: `'/' . $pattern . '/D'`.

Lowercase the input first (`hex.toLowerCase()` / `.lower()`) since the patterns above assume lowercase hex.

On match:
- Extract the 20-byte `pkh` portion → this is the owning address.
- For NFT/FT: extract the 36-byte `ref` → this identifies the specific token.
- Group FT UTXOs by ref to compute per-token balance (sum photon values).

The 241-byte FT control/authority scripts intentionally do NOT match any of
these patterns — they correctly classify as `unknown` and should not be surfaced
to users as spendable outputs.

Reference implementation: [`classifier.mjs`](https://github.com/Zyrtnin-org/radiant-ledger-app/blob/main/view-only-ui/classifier.mjs) (pure ES module, 83 lines, no dependencies).

**dMint contract outputs** (241 bytes, V1 shape) do not match any of the three patterns above
and will classify as `unknown`. This is correct for wallet display — they are not user-spendable.
However, an explorer or dMint-aware tool must NOT silently discard them. Detect them by parsing
the script as an opcode stream and looking for `OP_STATESEPARATOR` (`0xbd`) at byte 96 (preceded
by exactly 6 state-item pushes in V1, or 10 in V2). A bare-byte search for `0xbd` is NOT
sufficient — the byte can appear in push-data payloads. See [§8 — Decentralized Mint](#decentralized-mint-dmint)
for the V1/V2 dispatch logic and the canonical opcode walker below.

### Token-Burn Defense: Coin Selection Must Reject Token-Bearing UTXOs

When a wallet picks UTXOs for an ordinary RXD send (or a mint funding
input), spending an FT, NFT, or dMint UTXO into a plain P2PKH change
output **silently and irreversibly destroys the token**. The 36-byte
ref disappears from the chain; the token holder is debited; no error,
no warning. This has burned tokens in the wild.

Every wallet's coin selector must exclude token-bearing scripts. The
deny-list is any `OP_PUSHINPUTREF`-family opcode in **opcode position**:

| Hex  | Opcode                          | Where it appears       |
|------|---------------------------------|------------------------|
| `d0` | `OP_PUSHINPUTREF`               | FT holders, dMint refs |
| `d1` | `OP_REQUIREINPUTREF`            | covenants              |
| `d2` | `OP_DISALLOWPUSHINPUTREF`       | covenants              |
| `d3` | `OP_DISALLOWPUSHINPUTREFSIBLING`| covenants              |
| `d4`–`d7` | reserved / related         | future opcodes         |
| `d8` | `OP_PUSHINPUTREFSINGLETON`      | NFT singletons         |

**Do not implement this as a substring scan.** A bare `if any(b in
range(0xd0, 0xd9) for b in script)` rejects ~51% of legitimate P2PKH
funding UTXOs as a false positive (a random 20-byte pubkey hash has a
1 - (247/256)^20 ≈ 51% chance of containing at least one byte in
`0xd0`–`0xd8` *as payload*, not as an opcode). The classifier must
walk the script as an opcode stream and inspect only the opcode
positions.

**Canonical walker:**

```python
def is_token_bearing(script: bytes) -> bool:
    DENY = range(0xD0, 0xD9)
    pos, n = 0, len(script)
    while pos < n:
        op = script[pos]
        if op in DENY:
            return True
        if 0x01 <= op <= 0x4B:          # direct push N bytes
            new_pos = 1 + pos + op
        elif op == 0x4C:                 # OP_PUSHDATA1
            if pos + 1 >= n: return True
            new_pos = pos + 2 + script[pos + 1]
        elif op == 0x4D:                 # OP_PUSHDATA2 (LE)
            if pos + 2 >= n: return True
            new_pos = pos + 3 + int.from_bytes(script[pos+1:pos+3], "little")
        elif op == 0x4E:                 # OP_PUSHDATA4 (LE)
            if pos + 4 >= n: return True
            new_pos = pos + 5 + int.from_bytes(script[pos+1:pos+5], "little")
        else:
            new_pos = pos + 1
        if new_pos > n:
            return True                  # truncated push → refuse
        pos = new_pos
    return False
```

```javascript
function isTokenBearing(scriptHex) {
    const s = Buffer.from(scriptHex, 'hex');
    let pos = 0;
    while (pos < s.length) {
        const op = s[pos];
        if (op >= 0xd0 && op <= 0xd8) return true;
        let next;
        if (op >= 0x01 && op <= 0x4b) next = 1 + pos + op;
        else if (op === 0x4c) { if (pos+1 >= s.length) return true; next = pos+2 + s[pos+1]; }
        else if (op === 0x4d) { if (pos+2 >= s.length) return true; next = pos+3 + s.readUInt16LE(pos+1); }
        else if (op === 0x4e) { if (pos+4 >= s.length) return true; next = pos+5 + s.readUInt32LE(pos+1); }
        else next = pos + 1;
        if (next > s.length) return true;  // truncated push
        pos = next;
    }
    return false;
}
```

Canonical pyrxd implementation: `src/pyrxd/glyph/dmint.py`
`is_token_bearing_script` (lines 1549–1610) and its load-bearing call
site in `find_dmint_funding_utxo` (lines 2157–2246).

**Treat truncated push fields as token-bearing.** A malformed script of
ambiguous length should not be admitted as funding — refuse it. This
turns one class of script-parser confusion into a "skip this UTXO"
rather than a token burn.

**Adversarial test you must keep in your suite.** Construct a P2PKH
whose 20-byte pubkey hash is `[0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6,
0xd7, 0xd8] * 3` truncated to 20 bytes — every payload byte is in the
deny range. A correct opcode-aware walker classifies this as plain
P2PKH (because `0x14` push-20 announces the payload). A bare-byte scan
rejects it. If your test passes for the buggy classifier, your test is
not exercising the false-positive case — fix the test first, then the
classifier.

### Constructing an FT Holder Output (Sending)

When building a transfer, **do not try to derive** the 36-byte ref from the
holder's address or pubkeyhash — the ref identifies the *token*, not the
*holder*, and it is only discoverable by reading an existing FT UTXO of
that token from the chain.

Procedure for building a send:

1. Identify the sender's existing FT UTXOs for the token (scantxoutset with
   `raw(...)` descriptors, or index the chain). Pull the 75-byte
   scriptPubKey hex.
2. Extract the 36-byte ref: bytes `[27..63]` of the script (offset 54..126
   in hex) — the `ref` field returned by the classifier.
3. Build the destination holder output with the **same ref** and the
   recipient's pubkeyhash:

   ```
   76 a914 <dest_pkh:20> 88ac bd d0 <ref:36> dec0e9aa76e378e4a269e69d
   ```

   The recipient's scriptPubKey must match this exact 75-byte template,
   swapping only the 20-byte pubkeyhash. Any other structural change
   (reordered bytes, missing `bd`, truncated epilogue) will fail the
   conservation check at consensus.

4. Conserve value: Σ input photons for this ref ≥ Σ output photons for this
   ref. Surplus becomes the sender's own FT change output (same template,
   sender's pkh, residual value).

The `buildFtSpk(pkhHex, refHex)` helper in `classifier.mjs` produces the
output script given a validated `(pkh, ref)` pair.

---

## Decentralized Mint (dMint)

> **AI agents:** this section covers deploying a new mineable FT token (protocol `p: [1, 4]`).
> It is NOT the mint path (claiming tokens from an existing contract). For the single-contract
> mint flow, see the FT Holder Template above and the pyrxd `build_dmint_v1_mint_tx`
> reference implementation.

dMint is a Glyph protocol extension (`p: [1, 4]`) that distributes a
fungible token via on-chain Proof-of-Work mining instead of a single
minter signing every issuance. The deployment is split into:

1. A **deploy** transaction pair (commit + reveal) that emits N parallel
   contract UTXOs.
2. **Mint** transactions (one per successful PoW hash) that spend a
   contract UTXO, recreate it with `height` incremented, and pay the
   miner a 75-byte FT-wrapped reward.

### Reference mainnet artifacts (use these to test your decoder)

| Artifact | Txid | Notes |
|---|---|---|
| GLYPH deploy commit | `a443d9df469692306f7a2566536b19ed7909d8bf264f5a01f5a9b171c7c3878b` | h=228,604. 35 outputs (1 FT-commit + 32 ref-seeds + 1 NFT-commit + change). 1,448 bytes. |
| GLYPH deploy reveal | `b965b32dba8628c339bc39a3369d0c46d645a77828aeb941904c77323bb99dd6` | h=228,604. 36×35 in/out. 79,141 bytes (carries a 65,569-byte CBOR with embedded PNG). |
| GLYPH `tokenRef` | `8b87c3c771b1a9f5015a4f26bfd80979ed196b5366257a6f30929646dfd943a4 00000000` | The shared 36-byte ref in every contract and every mint reward — LE-reversed commit txid + 4-byte LE vout 0. |
| Example mint tx | `146a4d688ba3fc1ea9588e406cc6104be2c9321738ea093d6db8e1b83581af3c` | h=422,865. 2 inputs (contract + funding), 4 outputs (contract recreate + 75-byte FT reward + OP_RETURN + change). |
| GLYPH params | num_contracts=32, max_height=625,000, reward=50,000 sats, target=`0x00da740da740da74`, algorithm=SHA256D, no DAA | Total supply 1e12 sats = 10,000 GLYPH @ 8 decimals |

### V1 vs V2: critical warning

There are two on-chain layouts for dMint contracts:

| | V1 (mainnet reality) | V2 (Photonic-master spec, no mainnet deploys found) |
|---|---|---|
| State items | 6 (height, contractRef, tokenRef, maxHeight, reward, target) | 10 (adds algo, daa_mode, target_time, last_time) |
| State size | 96 bytes | varies (~120 B) |
| Epilogue | 145-byte fixed template | parameterised |
| Total | **241 bytes** | varies |
| Algorithm | byte at offset 19 of epilogue (`0xaa`=SHA256D, `0xee`=BLAKE3, `0xef`=K12) | dedicated state push |
| DAA | none (FIXED difficulty only) | ASERT / LWMA available |
| CBOR | `p: [1, 4]`, no `v` field | `v: 1, p: [2, 4]` |
| Mint scriptSig nonce width | 4 bytes (`0x04` push) | 8 bytes (`0x08` push) |
| Mint reward output (vout[1]) | **75-byte FT-wrapped** (P2PKH prologue + `bd` + `d0 <tokenRef>` + `dec0e9aa76e378e4a269e69d`) | **byte-identical to V1** — same 75-byte FT-wrapped output, same 12-byte fingerprint |
| Output-validation epilogue (covenant bytecode) | 107-byte block enforcing the vout[1] reward shape (in pyrxd: `_PART_C`, equal to `_V1_EPILOGUE_SUFFIX[18:]`) | **byte-identical to V1** — the entire 107-byte output-validation block is shared, not just the 12-byte fingerprint |

**Every dMint deploy found on Radiant mainnet to date is V1.** The
canonical reference is the GLYPH (Glyph Protocol) deploy at:

- Commit: `a443d9df469692306f7a2566536b19ed7909d8bf264f5a01f5a9b171c7c3878b` (h=228,604)
- Reveal: `b965b32dba8628c339bc39a3369d0c46d645a77828aeb941904c77323bb99dd6` (h=228,604)
- Params: 32 parallel contracts, max_height=625,000, reward=50,000 sats per mint, target=`0x00da740da740da74`, SHA256D, no DAA. Total supply = 32 × 625,000 × 50,000 = 1,000,000,000,000 sats = 10,000 GLYPH @ 8 decimals.

The current `master` branch of Photonic Wallet's `dMintScript()`
(`packages/lib/src/script.ts` lines 704–766) emits the V2 10-state-item
layout **only** — it cannot produce a deploy that interoperates with
existing miners. Builders must implement V1 explicitly or borrow a V1
reference implementation (e.g. pyrxd's `build_dmint_v1_contract_script`
in `src/pyrxd/glyph/dmint.py`).

### V1 contract UTXO byte layout (241 B = state[96] + epilogue[145])

Decoded byte-by-byte against GLYPH reveal vout 0 and the seven sampled
mainnet contract UTXOs (every byte from offset 79 onward is bit-identical
across all 32 contracts of a single deploy):

```
[ 0..  4]  04 <height:4-LE>                              4-byte LE push of current mint count
[ 5.. 41]  d8 <contractRef:36>                           contractRef singleton (commit_txid:i+1 LE)
[42.. 78]  d0 <tokenRef:36>                              tokenRef (commit_txid:0 LE)  — shared across all N contracts
[79.. 82]  03 <maxHeight:3-LE>                           supply cap (max mints per contract)
[83.. 86]  03 <reward:3-LE>                              sats per successful mint
[87.. 95]  08 <target:8-LE>                              difficulty target
[   96  ]  bd                                            OP_STATESEPARATOR (V1 epilogue starts here)
[97..241]  <145-byte fixed V1 epilogue>                  contains algo byte at offset 19 of this section
```

`contractRef[i]` is the LE-reversed 32-byte txid of the deploy commit
followed by a 4-byte LE `vout` index `i+1` for the i-th of N parallel
contracts. `tokenRef` is always `commit_txid:0` (the FT-commit hashlock
outpoint), shared by every mint and every contract.

The 12-byte fingerprint `de c0 e9 aa 76 e3 78 e4 a2 69 e6 9d` appears
both inside the V1 contract epilogue and as the suffix of every 75-byte
FT holder output (it is the codescript-hash preimage that links a mint
reward to its token). It is the cheapest substring to detect a
"Glyph FT-related output" by, but **do not classify scripts by
byte-substring scan alone** — see "Opcode-aware classification" above.

### dMint deploy: commit-tx output shape

A V1 dMint deploy commit has **N+3 outputs** (where N = num_contracts):

| vout | bytes | role |
|---|---|---|
| 0 | 75 | FT-commit hashlock (Photonic `ftCommitScript`, `OP_HASH256` + payload-hash + "gly" check + `OP_1 OP_NUMEQUALVERIFY` + P2PKH) |
| 1..N | 25 each | N ref-seed P2PKHs at 1 sat each, all to the deployer's PKH — each becomes `contractRef[i]` |
| N+1 | 75 | NFT-commit hashlock (same shape as FT-commit but with `OP_2 OP_NUMEQUALVERIFY`) |
| N+2 | 25 | change P2PKH |

For GLYPH (N=32): 1+32+1+1 = 35 outputs total, 1448 raw bytes.

### dMint deploy: reveal-tx I/O shape

Inputs (N+3 typical, or N+4 if forwarding a prior auth-NFT singleton):

| vin | spends | role |
|---|---|---|
| 0 | `commit:0` (FT-commit hashlock) | scriptSig carries `<sig> <pubkey> "gly" <PUSHDATA4 length> <CBOR FT body>` — can be **very large** (the GLYPH FT body is 65,569 bytes) |
| 1..N | `commit:1..N` (ref-seeds) | scriptSig is plain `<sig> <pubkey>` (P2PKH spend) |
| N+1 | `commit:N+1` (NFT-commit hashlock) | scriptSig carries the auth-NFT body CBOR |
| N+2 | `commit:N+2` (change) | funds the (potentially large) reveal fee |

Outputs (N+3):

| vout | bytes | role |
|---|---|---|
| 0..N-1 | 241 each | N V1 dMint contract UTXOs, each at 1 photon |
| N | 63 | FT NFT singleton (`d8 <commit:N+1-LE> 75 <P2PKH-25>`) — the token's on-chain identity, pointing back to the NFT-commit hashlock outpoint |
| N+1 | 63 | Auth NFT singleton |
| N+2 | 25 | change P2PKH |

Two production decisions are open to a builder:

1. **Auth NFT strategy.** Either mint fresh inside the same reveal
   (simpler, self-contained, recommended for first cuts) or
   "forward-prior" by spending an existing mutable-container NFT in an
   additional input (the GLYPH deploy does the latter; it requires the
   deployer to already hold a mutable-container NFT). pyrxd M2 chose
   mint-fresh; see deferred-work note below.
2. **Premine and delegate-ref**: Photonic supports both; the GLYPH
   deploy uses neither. Both are deferred work for first-cut builders.

### V1 mint tx mechanics (mainnet-verified)

A V1 mint transaction spends one of the N parallel contract UTXOs,
recreates it with `height` incremented by 1, and pays the miner a
75-byte FT-wrapped reward. The shape is fixed and the on-chain covenant
will reject any deviation.

**Mainnet anchors** (byte-decoded; the layout below was verified
identical against both):

| Token | Mint txid | Notes |
|---|---|---|
| snk | `146a4d688ba3fc1ea9588e406cc6104be2c9321738ea093d6db8e1b83581af3c` | block 422,865 (2026-01); documented in `pyrxd/docs/dmint-research-mainnet.md` §4 |
| PXD | `c9fdcd3488f3e396bec3ce0b766bb8070963e7e75bb513b8820b6663e469e530` | 2026-05-11; independent confirmation at a different timestamp, same I/O shape, same 72-byte mint scriptSig layout. Deploy reveal: `8eeb333943771991c2752abc78038365ecd76b1a24426f7a3212eea71b6a6564`. |

#### Inputs

| vin | spends | role |
|---|---|---|
| 0 | the previous contract UTXO (241 B) | scriptSig carries the mint solution — see scriptSig layout below |
| 1 | a plain-RXD P2PKH the miner controls | funds the reward and tx fee; scriptSig is a standard `<sig> <pubkey>` |

Selecting vin[1] **must** exclude token-bearing UTXOs (any with an
`OP_PUSHINPUTREF`-family opcode in opcode position). Spending an FT,
NFT, or another contract UTXO as funding silently destroys the token —
see the [Token-Burn Defense](#token-burn-defense-coin-selection-must-reject-token-bearing-utxos)
in §7 and use an opcode-aware walker; a bare-byte scan rejects ~51% of
honest funding addresses.

#### Outputs (canonical: 4 outputs)

| vout | bytes | value | role |
|---|---|---|---|
| 0 | 241 | 1 photon (singleton — must equal previous contract value) | recreated contract; **only byte that differs from previous contract** is the 4-byte LE `height` at offset 1..4 (incremented by 1) |
| 1 | 75 | `reward` photons (from the contract's state, e.g. 50,000) | FT-wrapped reward to the miner: `OP_DUP OP_HASH160 <miner_pkh> OP_EQUALVERIFY OP_CHECKSIG` `bd` `d0 <tokenRef>` `dec0e9aa76e378e4a269e69d` |
| 2 | varies | 0 | OP_RETURN per-mint marker (Photonic-Wallet convention): `6a 03 6d7367 <push-len> <msg-bytes>` — `6d7367` is the ASCII bytes for `"msg"` |
| 3 | 25 | change | plain P2PKH back to the miner |

The reward output (vout[1]) is **not** a plain P2PKH. The V1 covenant
enforces an FT-wrapped reward via `OP_CODESCRIPTHASHVALUESUM_OUTPUTS
OP_NUMEQUALVERIFY`; emitting a bare P2PKH at vout[1] produces a
`mandatory-script-verify-flag-failed` rejection. The 12-byte
`dec0e9aa76e378e4a269e69d` epilogue is the codescript-hash preimage
that ties the reward back to the token.

**This same vout[1] output shape applies to V2 mints.** The FT-conservation
covenant logic — the 75-byte FT-wrapped reward with the
`dec0e9aa76e378e4a269e69d` codescript-hash fingerprint — is shared between
V1 and V2; in pyrxd it lives in the `_PART_C` bytecode reused by both
contract builders. The only V1/V2 difference at the mint-tx level is the
**scriptSig nonce width** (4 bytes in V1, 8 bytes in V2; see "Mint scriptSig
layout" below). Any V2 implementation that emits a plain 25-byte P2PKH at
vout[1] will be rejected by the covenant just as a V1 one would.

The OP_RETURN at vout[2] is convention, not consensus — different
deployers use different `msg` payloads. The push prefix is always
`6a 03 6d7367` ("OP_RETURN PUSH(3) 'msg'") followed by a length-prefixed
message bytes.

#### Mint scriptSig layout (vin[0]) — 72 bytes for V1

```
<0x04> <nonce:4-LE> <0x20> <inputHash:32> <0x20> <outputHash:32> <0x00>
```

That is:

- `0x04` — direct PUSH of 4 bytes (V1 nonce width; V2 uses an 8-byte nonce)
- `nonce` — the value the miner found via Proof-of-Work
- `0x20` — direct PUSH of 32 bytes
- `inputHash` — `SHA256d(vin[1].locking_script)`, i.e. the double-SHA256 of the funding input's locking script
- `0x20` — direct PUSH of 32 bytes
- `outputHash` — `SHA256d(vout[2].locking_script)`, i.e. the double-SHA256 of the OP_RETURN message script
- `0x00` — `OP_0`, the empty-bytes terminator that the covenant's `OP_ROLL` drops

Total length: 1+4+1+32+1+32+1 = **72 bytes** exactly. Verified against
mainnet mint `146a4d68…f3c` vin[0] and our own mint `c9fdcd34…e530` vin[0].

#### PoW preimage layout (V1)

The miner hashes a 64-byte preimage plus the 4-byte nonce to find a
solution. The preimage halves are constructed as:

```
preimage[ 0..32] = SHA256(outpointTxHash || contractRef)
preimage[32..64] = SHA256( SHA256d(input_script) || SHA256d(output_script) )
PoW_hash         = SHA256d(preimage || nonce)         # nonce is 4 bytes LE for V1
```

Where:

- `outpointTxHash` is the 32-byte txid (internal/little-endian order) of the previous mint tx (the one whose vout[0] this mint is spending — i.e. the contract UTXO's source txid)
- `contractRef` is the 36-byte contract ref from the spent UTXO's state (bytes 5..41 of the 241-byte contract script)
- `input_script` is `vin[1].locking_script` (the funding input)
- `output_script` is `vout[2].locking_script` (the OP_RETURN message)

The covenant rebuilds the second SHA256 from the `inputHash` and
`outputHash` pushed in the mint scriptSig, then re-hashes the assembled
preimage with the pushed nonce to confirm `PoW_hash < target`. If the
scriptSig pushes diverge from what the miner actually hashed, the
covenant rejects after a successful mine — see
`docs/solutions/runtime-errors/dmint-v1-mint-scriptsig-shape.md` in
pyrxd for the prior incident.

#### pyrxd builder API for V1 mint mechanics

The reference implementation in pyrxd
(`src/pyrxd/glyph/dmint.py`) exposes the moving parts as:

```python
from pyrxd.glyph.dmint import build_pow_preimage, build_mint_scriptsig

pow = build_pow_preimage(
    txid_le=prev_mint_txid_le,        # 32 bytes, internal/little-endian
    contract_ref_bytes=contract_ref,  # 36 bytes (state bytes 5..41)
    input_script=funding_utxo_script, # vin[1] locking script
    output_script=op_return_script,   # vout[2] OP_RETURN message
)
# pow is PowPreimageResult(preimage, input_hash, output_hash)
# - mine over pow.preimage to find a 4-byte nonce hitting the target
# - then build the scriptSig from the SAME hashes:
scriptsig = build_mint_scriptsig(
    nonce, pow.input_hash, pow.output_hash,
    nonce_width=4,                    # 4 for V1, 8 for V2
)
```

Returning the preimage and the two hashes from a single helper is
deliberate: independently recomputing them on the scriptSig-build side
is the failure mode that produced the M1 covenant-rejection bug. Treat
`PowPreimageResult` as the single source of truth for both the mining
and signing paths.

### dMint CBOR token body (revealed in vin[0])

For a V1 dMint deploy:

```python
{
  "p":      [1, 4],                              # MUST: V1 dMint FT — both 1 (FT) and 4 (DMINT)
  "ticker": "GLYPH",                             # SHOULD: short token symbol
  "name":   "Glyph Protocol",                    # SHOULD: display name
  "desc":   "The first of its kind",             # SHOULD: prose description
  "by":     [CBORTag(64, <36-byte NFT ref>)],    # SHOULD: deployer/owner NFT ref (provenance)
  "main":   {"t": "image/png", "b": CBORTag(64, <PNG bytes>)},   # SHOULD: token logo
}
```

Three V1-specific rules:

- **`p: [1, 4]` is required.** Both 1 (FT) and 4 (DMINT) must be present.
- **No `v` field.** V2 deploys emit `v: 1`; V1 must omit `v` entirely.
- **dMint params live in the contract scripts, not the CBOR.** Do **not**
  embed a `dmint: {numContracts, reward, maxHeight, target, ...}` sub-dict
  in V1. The contract UTXOs are the authoritative source.

The `main.b` field can be very large (65,430 bytes for GLYPH's PNG logo).
This forces the scriptSig push to use **`OP_PUSHDATA4`** (`0x4e`) rather
than the smaller `OP_PUSHDATA1` (`0x4c`) or `OP_PUSHDATA2` (`0x4d`):

```
<sig> <pubkey> "gly" 4e <length:4-LE> <CBOR-map>
```

Builders that hardcode `OP_PUSHDATA1` will silently truncate any CBOR
body over 255 bytes and produce a tx that fails consensus on its hash
check. Use length-aware push selection.

### Where dMint params live

| Parameter | Authoritative location | Notes |
|---|---|---|
| `num_contracts` | Count of 241-byte outputs in the deploy reveal | Not in CBOR |
| `max_height` | Bytes 80..82 of every contract's state script (3-byte LE) | Per-contract |
| `reward` (sats) | Bytes 84..86 of every contract's state script (3-byte LE) | Per-mint payout |
| `target` | Bytes 88..95 of every contract's state script (8-byte LE) | V1 = fixed, no DAA |
| `algorithm` | Byte at offset 19 of the 145-byte epilogue: `0xaa`=SHA256D, `0xee`=BLAKE3, `0xef`=K12 | Hardcoded per-deploy |
| `tokenRef` | Bytes 42..78 of every contract's state script (36-byte ref) | Shared across all N |
| `contractRef[i]` | Bytes 5..41 of contract i's state script | Differs per slot |
| `current_height` | Bytes 1..4 of contract's state script (4-byte LE) | Increments by 1 each mint |

### Photonic Wallet divergences (V1 dMint)

The Photonic Wallet reference implementation
(`RadiantBlockchain-Community/photonic-wallet@master`) is the
canonical TypeScript source for Glyph primitives, but for V1 dMint
specifically the master branch diverges from on-chain reality in five
documented ways. Treat Photonic as a useful pattern reference, not as
a byte-equal spec, when implementing V1 dMint:

| # | Photonic master | Mainnet reality | Implication |
|---|---|---|---|
| 1 | `dMintScript()` emits V2 10-state-item layout | Every live deploy is V1 9/6-state-item layout | A Photonic-built deploy ships scripts no miner targets |
| 2 | Supports optional `premine: number` | GLYPH deploy uses no premine | Not blocking; defer |
| 3 | Supports `delegateRef` commit prefix | GLYPH deploy uses no delegate-ref | Not blocking; defer |
| 4 | `algorithm` and `daaMode` params (V2) | V1 contracts: SHA256D only, no DAA | V1 builders hardcode `algorithm='sha256d'` |
| 5 | CBOR `v: 1, p: [2, 4]` (V2) | CBOR `p: [1, 4]`, no `v` field (V1) | Wrong keys break RXinDexer classification |

For V1 dMint deploys, use either a hand-rolled implementation or a
V1-aware reference (e.g. pyrxd's `prepare_dmint_deploy` in
`src/pyrxd/glyph/builder.py`, which calls `build_dmint_v1_contract_script`
from `src/pyrxd/glyph/dmint.py`).

### Finding the deploy reveal from a commit txid (scripthash-history gotcha)

ElectrumX's `blockchain.scripthash.get_history` returns **all** txs
that ever touched a given scripthash, not just the unique commit+reveal
pair. The 75-byte Glyph FT-commit hashlock script is deterministic
given `(payload, owner_pkh, N)`, so any deployer who:

- Pre-encodes a CBOR body and signs a commit
- Has the broadcast fail (insufficient fee, propagation issue, etc.)
- Retries with the same body

emits a second tx whose vout 0 hashes to the **same scripthash** as the
first. The indexer returns both. The real GLYPH deploy's hashlock
scripthash has 4 history entries:

```
228398  d171b184…1597   ← earlier failed attempt (same script bytes)
228398  6de766d7…3eaf   ← spends d171b184:0 to refund
228604  a443d9df…878b   ← the real deploy commit
228604  b965b32d…9dd6   ← the real deploy reveal
```

A "first non-commit entry" heuristic picks `d171b184…1597`, which has
zero V1 contract outputs and only P2PKH outputs.

**Correct disambiguation:** among the history candidates, pick the tx
whose **inputs actually spend `commit_txid:0`**. Only the real reveal
does. This costs one extra `get_transaction` per non-matching
candidate, but the candidate set is small (1–3 typically):

```python
for entry in history:
    h_txid = entry["tx_hash"]
    if h_txid == commit_txid:
        continue
    cand_tx = await fetch_tx(h_txid)
    if any(ti.source_txid == commit_txid and ti.source_output_index == 0
           for ti in cand_tx.inputs):
        return h_txid  # this is the deploy reveal
```

Reference implementation:
`_find_v1_contract_utxos_walk` in `pyrxd.glyph.dmint`
(`src/pyrxd/glyph/dmint.py` lines 2510–2564). The same principle —
scripthash queries are coarse; you must filter by outpoint — applies to
any "find the spending tx" pattern over scripthash history.

#### Known gotchas {#dmint-deploy-known-gotchas}

See also: [§14 Common Errors](#common-errors--solutions) and
[§7 — Wallet Classifier Patterns](#wallet-classifier-patterns).

1. **V1 contract outputs classify as `unknown` in V2-only parsers.** The on-chain V1 contract
   script has 6 state items before `OP_STATESEPARATOR` (`0xbd`), not 10. Any parser that expects
   10 state pushes (the V2 layout) will fail at item 6 and discard the output. A correct parser
   tries V2 first, falls back to V1, and signals which version was matched. (See protocol-review
   for details; compound doc: `dmint-v1-classifier-gap.md`.)

2. **Mint reward output is NOT a plain P2PKH (V1 and V2 both).** The covenant requires a 75-byte
   FT-wrapped reward output (`P2PKH prologue + OP_STATESEPARATOR + OP_PUSHINPUTREF tokenRef +
   12-byte epilogue`). Plain P2PKH reward outputs will be rejected by the covenant. This applies
   to V1 mints (mainnet-verified against `146a4d68…f3c`) and to V2 mints (the reward-shape covenant
   logic is shared bytecode between V1 and V2 contracts). The contract output value must stay
   constant (singleton — typically 1 photon); the miner funds the reward and fee from a separate
   plain-RXD input. (Compound doc: `dmint-v1-mint-shape-mismatch.md`.)

3. **Bare-byte script classification rejects ~51% of honest miners.** Any check for
   OP_PUSHINPUTREF-family opcodes (`0xd0–0xd8`) that scans the full script byte-by-byte will
   false-positive on P2PKH addresses whose 20-byte hash contains those bytes — a ~51% hit rate
   on random addresses. All script classification must walk the opcode stream, skipping push
   payloads. (Compound doc: `funding-utxo-byte-scan-dos.md`.) See the
   [Token-Burn Defense canonical walker](#token-burn-defense-coin-selection-must-reject-token-bearing-utxos)
   in §7 for the defensive code pattern.

4. **Hashlock reuse confuses scripthash-based "find the reveal" walks.** If the same payload
   hash and owner PKH are used in a failed earlier attempt, ElectrumX `get_history` for that
   scripthash returns multiple entries. A naive "first non-commit tx" pick can land on the wrong
   transaction. The correct approach: among history candidates, check which one's `vin 0` spends
   `commit:0` of the known commit txid. (Compound doc: `dmint-deploy-reveal-hashlock-reuse.md`.)


---

## CBOR Payload Format

### Glyph Protocol Structure

Fields fall into three requirement tiers that builders must distinguish:

| Tier | Meaning | Consequence of violating |
|---|---|---|
| **MUST (consensus)** | Enforced by the Radiant protocol; violating transactions are rejected by validators | Tx doesn't confirm — free to fix |
| **MUST (wallet consensus)** | Every wallet expects this; violating mints confirm on-chain but won't render anywhere | Tx confirms as malformed — **permanent** |
| **SHOULD (convention)** | Community convention observed by Glyphium + Glyph Explorer; violations render as a blank card or "Unknown NFT" | Tx confirms but UX is degraded — often recoverable by re-mint |

```javascript
{
    p: [2],                           // MUST (wallet consensus): protocol selector.
                                      // 2=NFT, [1]=FT, [1,4]=V1 dMint, [2,4]=V2 dMint,
                                      // [2,7]=NFT-container, etc. Wallets reject
                                      // the whole payload if absent. Note: V1 dMint
                                      // (the only on-chain reality so far) MUST omit
                                      // the `v` field; emitting `v: 1` switches
                                      // the payload to V2 and breaks classification.
    name: "My NFT #12345",            // SHOULD: display name. Tx is valid without
                                      // it; wallets fall back to "Unknown NFT".
    type: "photo",                    // SHOULD: free-form category used by apps.
    main: {                           // SHOULD but critical: on-chain thumbnail.
        t: 'image/webp',              //   Without main, every wallet shows a
        b: thumbnailUint8Array        //   blank card (consistent across wallets).
    },
    in: [containerRefBytes],          // SHOULD: container/collection ref.
    by: [authorRefBytes],             // SHOULD: author/minter ref (provenance).
    attrs: {                          // SHOULD: app-specific metadata, string-keyed
        score: 1000000,               //   primitives only (see warning below).
        game: "Game Name",
        player: "Player Name"
    },
    loc: "ipfs://...",                // SHOULD: IPFS full-res location. Must be
                                      //   a valid CIDv0 (46 char Qm...) or CIDv1
                                      //   (59 char bafybei...). Truncated CIDs
                                      //   mint permanently broken NFTs.
    loc_hash: "sha256:..."            // SHOULD (security-relevant): binds `loc`
                                      //   content to on-chain record. Omitting
                                      //   is valid on-chain but removes the only
                                      //   integrity guarantee on off-chain content.
                                      //   For NFTs with value (tickets, scores,
                                      //   collectibles), treat as MUST: anyone
                                      //   with pin-service API access can swap
                                      //   the asset post-mint without `loc_hash`.
}
```

**CBOR encoding itself is MUST (wallet consensus)** — JSON-encoded payloads
confirm on-chain but show as "Unknown NFT" in every wallet. The commit script
hashes the CBOR bytes, so the encoder's behavior (e.g. Uint8Array handling,
see below) is also effectively consensus for your mint.

> **Keep `attrs` to string-keyed primitives.** Viewers and indexers cannot
> safely render arbitrary CBOR graphs: map keys that aren't strings, nested
> tagged items, or cyclic references produce renderer divergence (one
> wallet shows the NFT, another shows `Unknown`, a third throws). Recommend
> the minimum discipline:
>
> - Keys: UTF-8 strings only, ≤ 32 characters.
> - Values: string / integer / boolean / small byte-string (≤ 256 B).
> - No nested maps or arrays of maps — flatten before encoding.
> - No CBOR tags other than those the core protocol requires.
>
> `attrs` is a convenience surface, not a schema — treat it the way you'd
> treat query-string parameters, not a general-purpose object store. The
> `main` and `loc` fields are where large/structured content goes.

### Protocol Identifiers

| Value | Meaning | Typical `p` array | Notes |
|-------|---------|-------------------|-------|
| 1 | Fungible Token (FT) | `[1]` | Token amount = UTXO photon value. No separate amount field. |
| 2 | Non-Fungible Token (NFT) | `[2]` | Unique via `OP_PUSHINPUTREFSINGLETON` (`0xd8`). |
| 3 | Data Storage (DAT) | `[3]` | |
| 4 | Decentralized Mint (dMint) | `[1, 4]` | Combined with FT. In V1, dMint parameters (num_contracts, max_height, reward, target, algorithm) live in the contract output scripts, NOT in the CBOR — see §[Decentralized Mint (dMint)](#decentralized-mint-dmint). Algorithm encoded as a single byte in the V1 contract epilogue: `0xaa`=SHA256D, `0xee`=BLAKE3, `0xef`=K12. |
| 5 | Mutable (MUT) | `[5]` | |
| 6 | Explicit Burn | `[6]` | |
| 7 | Container / Collection | `[7]` | Parent-only; children reference via `in` field. |
| 8 | Encrypted Content | `[8]` | |
| 9 | Timelocked Reveal | `[9]` | |
| 10 | Issuer Authority | `[10]` | |
| 11 | WAVE Naming System | `[11]` | On-chain DNS-like records. |

**Note on `p` array combinations:** `p: [1, 4]` means "this is a Fungible Token deployed
via dMint." Combinations like `[2, 7]` (NFT that is also a container) are valid. The first
element is the primary type; subsequent elements are modifiers. `p: [4]` alone (dMint
without an FT or NFT base type) has not been observed on mainnet — all known dMint
deployments use `[1, 4]` (FT + dMint). For the full commit/reveal structure of a V1 `[1, 4]`
deploy, see [§7 — dMint V1 Deploy](#dmint-v1-deploy-multi-contract-structure).

**V1 vs V2 deploys differ in the CBOR shape itself.** V1 (the only
on-chain reality so far) emits `p: [1, 4]` with no `v` field and no
`dmint: {...}` sub-dict. V2 (Photonic-master spec, no mainnet examples
yet) emits `v: 1, p: [2, 4]`. Builders targeting live miners must emit
the V1 shape.

### Container and Author Refs

**CRITICAL:** Container and author refs MUST be extracted from the NFT's singleton output script, NOT calculated from the transaction ID.

#### The Problem

Many implementations calculate refs like this (WRONG):

```javascript
// ❌ WRONG - This will NOT work for container/author refs!
const txidReversed = Buffer.from(containerTxid, 'hex').reverse();
const voutLE = Buffer.alloc(4);
voutLE.writeUInt32LE(0);
const wrongRef = txidReversed.toString('hex') + voutLE.toString('hex');
```

**Why this fails:**
- The singleton ref in the output script is based on the COMMIT transaction, not the reveal transaction
- Computing from reveal txid gives you a completely different 36-byte value
- Child NFTs will reference a non-existent parent, breaking the container hierarchy

#### The Solution: Extract from Output Script

**Correct approach:**

```javascript
// ✅ CORRECT - Extract ref from the singleton output script
// 1. Get the reveal transaction
const tx = await rpc.call('getrawtransaction', [revealTxid, true]);

// 2. Get output 0's scriptPubKey
const script = tx.vout[0].scriptPubKey.hex;

// 3. Extract the 36-byte ref (positions 2-74 in hex string)
// Script format: d8<36-byte ref>7576a914...
//                ^^ skip this
const containerRef = script.substring(2, 74);  // 72 hex chars = 36 bytes

// 4. Use this ref in child NFT payloads
const payload = {
    p: [2],
    name: "Child NFT",
    in: [hexToUint8Array(containerRef)],  // Now correctly references parent
    by: [hexToUint8Array(authorRef)]      // Also extracted from output script
};
```

#### Real-World Example

**Container NFT:**
- Reveal txid: `4edad6696f9ba2c20b7f81bf135032bf1a781ebca40644c9fc1cd8aa817a3b63`
- Output script: `d813499062956d178e7e9d9950418a4a8e8aabbcd38cd38c41ebf38cd63741585800000000757...`
- **Correct ref**: `13499062956d178e7e9d9950418a4a8e8aabbcd38cd38c41ebf38cd63741585800000000` (from script)
- **Wrong ref**: `58584137d68cf3eb418cd38cd3bcab8a8e4a8a4150999d7e8e176d956290491300000000` (from txid)

Using the wrong ref means:
- Child NFTs won't appear in Glyphium under the container
- The hierarchy breaks
- NFTs exist but are orphaned

#### Implementation

```javascript
// Helper to extract singleton ref from a transaction.
// Validates against the full 63-byte NFT singleton template — a bare
// startsWith('d8') accepts any script leading with OP_PUSHINPUTREFSINGLETON,
// including malformed or FT control scripts. The anchored regex below is
// the same shape the wallet classifier enforces.
const NFT_SPK_RE = /^d8[0-9a-f]{72}7576a914[0-9a-f]{40}88ac$/;

async function getSingletonRef(txid, vout = 0) {
    const tx = await rpc.call('getrawtransaction', [txid, true]);
    const script = (tx.vout[vout].scriptPubKey.hex || '').toLowerCase();

    if (!NFT_SPK_RE.test(script)) {
        throw new Error('Not an NFT singleton output');
    }

    // Extract 36-byte ref (72 hex chars starting at position 2)
    return script.substring(2, 74);
}

// Use when creating child NFTs
const containerRef = await getSingletonRef(containerTxid, 0);
const authorRef = await getSingletonRef(authorTxid, 0);

function hexToUint8Array(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

const payload = {
    p: [2],
    name: "My NFT",
    in: [hexToUint8Array(containerRef)],  // 72 hex chars from OUTPUT SCRIPT
    by: [hexToUint8Array(authorRef)]      // 72 hex chars from OUTPUT SCRIPT
};
```

#### Why This Matters

Container refs organize NFTs into collections:
- All NFTs with the same `in` ref appear under that container in explorers
- This creates browsable collections (e.g., "My App Verified Photos")
- Essential for platform branding and user experience

**Testing container refs:**
1. Mint a container NFT (no `in` field)
2. Extract its ref from the output script
3. Mint child NFTs using that ref in their `in` field
4. Check Glyphium - children should appear nested under the container
5. If children are orphaned, your ref extraction is wrong

### JavaScript CBOR Encoding

```javascript
function encodeGlyphData(data) {
    // Verify CBOR library is loaded
    if (typeof CBOR === 'undefined') {
        throw new Error('CBOR library not loaded! NFT would be unreadable.');
    }

    // Ensure protocol is set
    if (!data.p) {
        data.p = [2];
    }

    // Encode to CBOR
    const marker = new TextEncoder().encode('gly');
    const cborData = CBOR.encode(data);

    // CBOR.encode returns ArrayBuffer, convert to Uint8Array
    const payload = new Uint8Array(cborData);

    // Combine marker and payload
    const result = new Uint8Array(marker.length + payload.length);
    result.set(marker, 0);
    result.set(payload, marker.length);

    return result;
}
```

### CBOR Payload Size Cap (DoS vs Real Deploys)

Your CBOR decoder MUST cap input size before calling `cbor.decode()`
or equivalent. Without a cap, a malicious deploy can push a 2³²-byte
payload via `OP_PUSHDATA4` and force your indexer/explorer/wallet to
allocate gigabytes or spend seconds in the decode path. The decoder
is a DoS surface for any service that fetches reveal scriptSigs.

**Pick a cap deliberately. The trade-off:**

- **64 KB and below** — fast, low memory, but rejects real on-chain
  deploys. The GLYPH (Radiant Blockchain Glyph Protocol) deploy
  reveal carries a 65,569-byte CBOR body including a PNG logo.
  Wallets capped at 64 KB cannot decode it.
- **256 KB** — recommended ceiling. Accepts every known mainnet
  deploy with embedded media, and bounds decode time and memory
  to sub-millisecond cost on any reasonable CBOR library.
- **Above 256 KB** — increases DoS surface for no observed benefit.
  No mainnet Glyph payload approaches this size; the ecosystem
  convention is to put large media in IPFS via the `loc` field, not
  inline in `main.b`.

**Reference enforcement (Python):**

```python
_MAX_CBOR_PAYLOAD_BYTES = 262_144  # 256 KB — accommodates GLYPH-class deploys

def decode_payload(cbor_bytes: bytes):
    if len(cbor_bytes) > _MAX_CBOR_PAYLOAD_BYTES:
        raise ValidationError(
            f"CBOR payload too large: {len(cbor_bytes)} > {_MAX_CBOR_PAYLOAD_BYTES}"
        )
    return cbor.loads(cbor_bytes)
```

Apply the cap **before** invoking the CBOR library — most CBOR
libraries will happily allocate a multi-megabyte buffer before they
know the structure of the input. Implementation reference: pyrxd
`src/pyrxd/glyph/payload.py` `_MAX_CBOR_PAYLOAD_BYTES` constant and
the size-cap precheck (lines 51, 94–95).

### Glyph Data Format

```
Glyph = "gly" marker (3 bytes) + CBOR payload
      = 676c79 + <CBOR bytes>
```

---

## Commit Transaction

### Purpose

The commit transaction creates an output with a custom script (nftCommitScript) that:
1. Validates the glyph data hash
2. Checks for "gly" marker
3. Verifies singleton ref exists in reveal outputs
4. Performs standard P2PKH signature validation

### nftCommitScript Structure

```
OP_HASH256 <32-byte-payload-hash> OP_EQUALVERIFY   // Verify CBOR hash
<3-byte "gly"> OP_EQUALVERIFY                       // Check "gly" marker
OP_INPUTINDEX OP_OUTPOINTTXHASH                    // Push input txid
OP_INPUTINDEX OP_OUTPOINTINDEX                     // Push input vout
OP_4 OP_NUM2BIN OP_CAT                             // Build 36-byte ref
OP_REFTYPE_OUTPUT OP_2 OP_NUMEQUALVERIFY           // Verify singleton in output
OP_DUP OP_HASH160 <20-byte-pubkeyhash> OP_EQUALVERIFY OP_CHECKSIG  // P2PKH
```

### Hex Breakdown

| Hex | Opcode | Description |
|-----|--------|-------------|
| `aa` | OP_HASH256 | Hash top stack item (double SHA256) |
| `20` | Push 32 bytes | Payload hash follows |
| `88` | OP_EQUALVERIFY | Check hash matches |
| `03` | Push 3 bytes | "gly" marker follows |
| `676c79` | "gly" | Literal bytes (ASCII: g=67, l=6c, y=79) |
| `c0` | OP_INPUTINDEX | Push current input index |
| `c8` | OP_OUTPOINTTXHASH | Push input's txid (BCH introspection) |
| `c9` | OP_OUTPOINTINDEX | Push input's vout (BCH introspection) |
| `54` | OP_4 | Push number 4 |
| `80` | OP_NUM2BIN | Convert vout to 4-byte LE |
| `7e` | OP_CAT | Concatenate txid+vout = 36-byte ref |
| `da` | OP_REFTYPE_OUTPUT | Check ref type in outputs |
| `52` | OP_2 | Push 2 (singleton type) |
| `9d` | OP_NUMEQUALVERIFY | Verify ref is singleton |
| `76a914...88ac` | P2PKH | Standard signature verification |

### PHP Implementation

```php
/**
 * Build the nftCommitScript for a Glyph NFT commit output.
 *
 * INVARIANTS (caller's responsibility — this function does NOT validate):
 *   - $pubkeyhash MUST be exactly 40 hex chars (20-byte P2PKH pubkeyhash)
 *   - $payloadHash MUST be exactly 64 hex chars (32-byte SHA256(CBOR payload))
 *
 * Passing shorter or attacker-influenced hex here produces a malformed
 * script whose length bytes disagree with the actual content — in the
 * worst case it can shift the pubkeyhash portion and direct the NFT to
 * an attacker-chosen address. Validate upstream before calling.
 */
function buildNftCommitScript($pubkeyhash, $payloadHash) {
    assert(strlen($pubkeyhash) === 40 && ctype_xdigit($pubkeyhash));
    assert(strlen($payloadHash) === 64 && ctype_xdigit($payloadHash));

    $OP_HASH256 = 'aa';
    $OP_EQUALVERIFY = '88';
    $OP_DUP = '76';
    $OP_HASH160 = 'a9';
    $OP_CHECKSIG = 'ac';
    $OP_INPUTINDEX = 'c0';
    $OP_OUTPOINTTXHASH = 'c8';  // BCH introspection
    $OP_OUTPOINTINDEX = 'c9';   // BCH introspection
    $OP_4 = '54';
    $OP_NUM2BIN = '80';
    $OP_CAT = '7e';
    $OP_REFTYPE_OUTPUT = 'da';
    $OP_2 = '52';
    $OP_NUMEQUALVERIFY = '9d';

    $glyphMarker = '676c79';  // "gly" in hex

    $script = $OP_HASH256;
    $script .= '20' . $payloadHash;
    $script .= $OP_EQUALVERIFY;
    $script .= '03' . $glyphMarker;
    $script .= $OP_EQUALVERIFY;
    $script .= $OP_INPUTINDEX . $OP_OUTPOINTTXHASH;
    $script .= $OP_INPUTINDEX . $OP_OUTPOINTINDEX;
    $script .= $OP_4 . $OP_NUM2BIN . $OP_CAT;
    $script .= $OP_REFTYPE_OUTPUT . $OP_2 . $OP_NUMEQUALVERIFY;
    $script .= $OP_DUP . $OP_HASH160;
    $script .= '14' . $pubkeyhash;
    $script .= $OP_EQUALVERIFY . $OP_CHECKSIG;

    return $script;
}
```

### Payload Hash Calculation

```php
// Single-pass, single-name. $payloadHash is HEX (64 chars), not raw bytes —
// buildNftCommitScript() expects hex and concatenates as a string.
$cborHex = substr($glyphHex, 6);                                     // skip "gly" marker
$payloadHash = hash('sha256', hash('sha256', hex2bin($cborHex), true), false);
```

### Building the Commit Transaction End-to-End

`buildNftCommitScript()` returns the OUTPUT script (one piece). A full commit
transaction pulls a funded UTXO, sets `output[0] = nftCommitScript` at the
commit amount, sends change back to your hot wallet, signs with
`signrawtransactionwithwallet`, and broadcasts. This is the piece that the
"Complete Implementation Example" further down assumes you have; here is the
implementation:

```php
/**
 * Build, sign, and broadcast the commit transaction.
 *
 * Returns: [
 *   'txid'         => string,   // commit tx id (hex)
 *   'vout'         => int,      // always 0 — the nftCommitScript output
 *   'commitScript' => string,   // the exact output script (hex), save for reveal
 *   'commitAmount' => int,      // the commit output value in photons
 *   'payloadHash'  => string,   // the 32-byte SHA256d (hex) embedded in script
 * ]
 *
 * $commitAmountSats must cover: reveal-tx fee + reveal NFT output value + dust.
 * For a ~1 KB reveal at 10,000 photons/byte: ~10.4M photons commit amount.
 */
function createCommitTransaction($rpc, $fundingAddress, $glyphHex, $commitAmountSats, $feeRateSatsPerByte) {
    // 1. Build the commit output script from payloadHash + dest pubkeyhash.
    $cborHex = substr($glyphHex, 6);
    $payloadHash = hash('sha256', hash('sha256', hex2bin($cborHex), true), false);
    $fundingInfo = $rpc->call('getaddressinfo', [$fundingAddress]);
    $pubkeyhash  = $fundingInfo['scriptPubKey'] ? substr($fundingInfo['scriptPubKey'], 6, 40) : null;
    if (strlen($pubkeyhash) !== 40) {
        throw new RuntimeException('could not derive pubkeyhash for funding address');
    }
    $commitScript = buildNftCommitScript($pubkeyhash, $payloadHash);

    // 2. Select UTXOs from the funding address. Pull smallest-first to avoid
    //    fragmenting large ones (simple policy — swap for your own if needed).
    $utxos = $rpc->call('listunspent', [1, 9999999, [$fundingAddress]]);
    usort($utxos, fn($a, $b) => $a['amount'] <=> $b['amount']);

    // 3. Rough tx-size estimate, in bytes: 10 header + (148 per P2PKH input) +
    //    (8 + 1 + len(commitScript)/2) commit output + 34 change output.
    $commitScriptBytes = strlen($commitScript) / 2;
    $estimateSize = fn($numInputs) => 10 + ($numInputs * 148) + (8 + 1 + $commitScriptBytes) + 34;

    $selected = [];
    $totalIn = 0;
    foreach ($utxos as $u) {
        $selected[] = $u;
        $totalIn += intval(round(floatval($u['amount']) * 100_000_000));
        $feeSats  = $estimateSize(count($selected)) * $feeRateSatsPerByte;
        if ($totalIn >= $commitAmountSats + $feeSats + 546) break;  // +dust for change
    }
    if ($totalIn < $commitAmountSats + $feeSats) {
        throw new RuntimeException('insufficient funds for commit tx');
    }

    // 4. Build raw tx. Output 0 = nftCommitScript, output 1 = change (P2PKH).
    $inputs = array_map(fn($u) => ['txid' => $u['txid'], 'vout' => $u['vout']], $selected);
    $changeSats = $totalIn - $commitAmountSats - $feeSats;
    $outputs = [];
    // createrawtransaction doesn't accept raw-script outputs directly in
    // Bitcoin-family RPC; use its "data" field for OP_RETURN only. For a
    // custom script output, build the serialized tx by hand OR use
    // `createrawtransaction` with a dummy output then splice the script.
    // The hand-build is simpler — see Section 11 "Reveal Transaction" for
    // the same pattern applied to the reveal. Here is the commit version:
    $rawTx = buildRawTxWithCustomOutput($inputs, [
        ['value' => $commitAmountSats, 'scriptHex' => $commitScript],
        ['value' => $changeSats,       'scriptHex' => buildP2pkhScript($pubkeyhash)],
    ]);

    // 5. Sign with the wallet (standard P2PKH inputs — no custom signer needed).
    $signed = $rpc->call('signrawtransactionwithwallet', [$rawTx]);
    if (empty($signed['complete'])) {
        throw new RuntimeException('commit signing incomplete: ' . json_encode($signed));
    }

    // 6. Broadcast.
    $txid = $rpc->call('sendrawtransaction', [$signed['hex']]);

    // 7. Wait for confirmation before building reveal — without this, the
    //    reveal will fail with "bad-txns-inputs-missingorspent" if the node
    //    hasn't indexed the commit output yet. Poll every few seconds.
    waitForConfirmation($rpc, $txid, $minConfs = 1, $timeoutSec = 600);

    return [
        'txid'         => $txid,
        'vout'         => 0,
        'commitScript' => $commitScript,
        'commitAmount' => $commitAmountSats,
        'payloadHash'  => $payloadHash,
    ];
}

function waitForConfirmation($rpc, $txid, $minConfs, $timeoutSec) {
    $deadline = time() + $timeoutSec;
    while (time() < $deadline) {
        $tx = $rpc->call('getrawtransaction', [$txid, true]);
        if (($tx['confirmations'] ?? 0) >= $minConfs) return;
        sleep(5);
    }
    throw new RuntimeException("commit tx $txid did not reach $minConfs confirmations in {$timeoutSec}s");
}
```

The `buildRawTxWithCustomOutput` helper is a straightforward serializer
(version=2, varint inputs, `u64_le(value)` + varint(scriptLen) + scriptHex
per output, locktime=0). The same pattern is applied to the reveal tx in
`createCommitWithCustomScript()` shown in the Reveal Transaction section —
lift from there.

**Watch out for:**

- **Wait for commit confirmation before reveal.** Some nodes will accept an
  unconfirmed-input reveal; others reject with `bad-txns-inputs-missingorspent`
  until the commit is in a block. Always confirm first.
- **Commit output value must cover reveal fee + reveal output + dust.**
  Undersize and the reveal fails with `min relay fee not met`; the commit
  UTXO is then stuck behind the non-standard `nftCommitScript` and can only
  be recovered by building a correctly-sized reveal (same `glyphHex`, same
  commit outpoint — the payload hash is deterministic, so the same reveal
  will still be valid).
- **Change output goes back to the funding address.** Keeps your hot wallet
  balance intact and predictable for the next mint.

### Recovering From a Failed Reveal

If the commit confirmed but the reveal broadcast failed (network hiccup,
signing error, undersized fee, node rejected the scriptSig shape), **the
commit UTXO is not lost** — it is still spendable, but only by a valid
reveal transaction carrying the same payload hash. You cannot sweep it with
an ordinary P2PKH spend; the `nftCommitScript` prologue requires the "gly"
marker and CBOR body on the stack.

Recovery procedure:

1. **Do not rebuild from scratch.** The payload hash is deterministic over
   `glyphHex`, so any new reveal you build from the original `glyphHex`
   satisfies the commit script. Rebuilding with a different image or
   different CBOR attrs changes the hash and the UTXO is unrecoverable.
2. **Reuse the stored inputs.** Your minter should persist `commitTxid`,
   `commitVout`, `commitAmountSats`, `glyphHex`, and `destPubkeyhash` before
   broadcast — these are the five values a retry needs. Load them, rebuild
   the reveal, re-sign, and rebroadcast.
3. **Check mempool first.** Before assuming the reveal failed, run
   `getrawtransaction <revealTxid> 0` and `getmempoolentry <revealTxid>`.
   A RPC error may have dropped your client's return value while the node
   still accepted the tx. Confirm with a block explorer before paying fees
   on a duplicate.
4. **If mempool eviction is the cause**, raise the fee rate in the new
   reveal (same commit input, same glyph, higher fee → smaller change
   output) and rebroadcast. Do not RBF — the commit script does not admit
   a replacement path.

The worst outcome is a commit UTXO that sits unspent indefinitely; the RXD
inside is not burned, just locked behind a script that only a correctly-
built reveal can satisfy.

### Finding the Reveal Tx on Chain (Don't Trust Scripthash History Alone)

If you're walking from a commit txid to its reveal — to recover from a
failed broadcast, to index your own NFTs, or to verify a third-party
mint — **do not pick the first non-commit entry in the commit-output's
scripthash history**. The commit hashlock script is deterministic in
`(payload_hash, owner_pkh)`; if the same CBOR body was committed in a
prior failed attempt by the same owner, both attempts share the
identical script bytes and the identical scripthash. Indexer history
returns all of them in chronological order, not just yours.

The Glyph Protocol deploy commit's vout-0 scripthash on Radiant mainnet,
for example, has **four** history entries:

```
height  txid                                       what it is
228398  d171b184…1597   ← earlier failed deploy attempt (same script bytes)
228398  6de766d7…3eaf   ← refund spending d171b184:0
228604  a443d9df…878b   ← the real deploy commit
228604  b965b32d…9dd6   ← the real deploy reveal
```

A walker that does `history[0] if history[0] != commit_txid else
history[1]` picks `d171b184…1597` — wrong tx, wrong outputs, your
indexing pipeline either fails loudly or (worse) silently
mis-attributes the token.

**Correct disambiguation:** among history candidates, pick the tx
whose inputs actually spend `commit_txid:vout`. The real reveal is
the only candidate that does:

```javascript
async function findReveal(electrum, commitTxid, commitVout) {
    const scripthash = scriptHashOf(commitOutputScript);
    const history = await electrum.scripthashGetHistory(scripthash);
    for (const entry of history) {
        if (entry.tx_hash === commitTxid) continue;
        const tx = await electrum.transactionGet(entry.tx_hash);
        const spendsCommit = tx.vin.some(
            i => i.txid === commitTxid && i.vout === commitVout
        );
        if (spendsCommit) return entry.tx_hash;
    }
    throw new Error('no tx in scripthash history spends commit outpoint');
}
```

The extra `transactionGet` per candidate costs one round-trip each.
Real candidate sets are tiny (1–3 typically), and you were going to
fetch the reveal tx anyway. The cost is negligible compared to
mis-attributing a token.

**Same principle applies in reverse:** any "which tx spent this UTXO?"
query against indexer scripthash history is coarse-grained. Confirm
the candidate's inputs include your specific outpoint before
trusting the answer.

---

## Reveal Transaction

### Purpose

The reveal transaction spends the commit output and creates the final NFT with:
1. Glyph data embedded in scriptSig
2. Singleton ref output that references the commit transaction
3. NFT owned by specified pubkeyhash

### ScriptSig Structure (CRITICAL)

The scriptSig must be in this **exact order**:

```
<signature> <pubkey> <"gly" marker> <CBOR payload>
```

### Sizing the CBOR push correctly (builder side)

The reveal scriptSig embeds the CBOR payload in this push sequence:

```
<sig> <pubkey> "gly" <push-op> [length-bytes] <CBOR body>
```

Select `<push-op>` based on the CBOR body length:

| Body length | Push opcode | Length encoding |
|---|---|---|
| 1..75 | `<N>` (0x01..0x4B) | implicit (opcode == length) |
| 76..255 | `0x4C` OP_PUSHDATA1 | 1 byte LE |
| 256..65,535 | `0x4D` OP_PUSHDATA2 | 2 bytes LE |
| 65,536..4,294,967,295 | `0x4E` OP_PUSHDATA4 | 4 bytes LE |

dMint deploys frequently carry a 30 KB+ PNG in `main.b` and routinely
need `OP_PUSHDATA2` or `OP_PUSHDATA4`. The GLYPH deploy used
`OP_PUSHDATA4` for a 65,569-byte body. Hardcoding `OP_PUSHDATA1`
silently truncates the body in a length-1 push (the high bytes become
"dust opcodes" on the stack) and the reveal fails the locking-side
`OP_HASH256 <32-byte payload-hash> OP_EQUALVERIFY` check.

### Push-Stack Walker Must Handle OP_PUSHDATA4 (0x4e)

Any wallet, explorer, or builder that walks the reveal scriptSig push
stack — to find the `'gly'` marker and the CBOR body that follows it
— must support all four push-data opcodes. V1 dMint deploys with
embedded media (the GLYPH token's deploy carries a 65,569-byte CBOR
body including a PNG logo) overflow `OP_PUSHDATA2`'s 65,535-byte max
length and use `OP_PUSHDATA4` (`0x4e`). A walker that handles only
`0x01`–`0x4d` silently terminates at the `0x4e` byte, never finds the
`'gly'` marker, and classifies the entire reveal as "no Glyph metadata."

Reveal scriptSig push stacks may use any of four push-data opcodes:

| Opcode | Hex  | Length encoding                | Max push size |
|--------|------|--------------------------------|---------------|
| direct | `0x01`–`0x4b` | opcode IS the length | 75 bytes     |
| OP_PUSHDATA1 | `0x4c` | next 1 byte               | 255 bytes    |
| OP_PUSHDATA2 | `0x4d` | next 2 bytes (LE)         | 65,535 bytes |
| OP_PUSHDATA4 | `0x4e` | next 4 bytes (LE)         | 2³² – 1      |

**V1 dMint deploys with embedded media use `OP_PUSHDATA4`.** The
GLYPH (Radiant Blockchain Glyph Protocol) deploy reveal carries a
65,569-byte CBOR body (including a PNG logo) in its input-0 scriptSig
— above `OP_PUSHDATA2`'s 65,535-byte ceiling, so the script emits
`0x4e` and a 4-byte little-endian length. Wallets that handle only
`0x4c`/`0x4d` terminate the walk at the `0x4e` byte, never find the
`'gly'` marker that follows, and silently report the reveal as a
non-Glyph tx.

**Reference walker (Python, mirrors the four push opcodes):**

```python
def walk_pushes(scriptsig: bytes) -> list[bytes]:
    items, pos = [], 0
    while pos < len(scriptsig):
        op = scriptsig[pos]; pos += 1
        if 0x01 <= op <= 0x4B:
            items.append(scriptsig[pos:pos+op]); pos += op
        elif op == 0x4C:
            length = scriptsig[pos]; pos += 1
            items.append(scriptsig[pos:pos+length]); pos += length
        elif op == 0x4D:
            length = int.from_bytes(scriptsig[pos:pos+2], "little"); pos += 2
            items.append(scriptsig[pos:pos+length]); pos += length
        elif op == 0x4E:
            length = int.from_bytes(scriptsig[pos:pos+4], "little"); pos += 4
            items.append(scriptsig[pos:pos+length]); pos += length
        else:
            break  # non-push opcode — stop walking the push stack
    return items
```

A correct walker on the GLYPH deploy reveal produces a push-stack
whose item-2 is `676c79` (the `'gly'` marker) and whose item-3 is the
65,569-byte CBOR body. The `'gly'` marker convention always: marker
push immediately followed by CBOR-body push. Implementation reference:
pyrxd `src/pyrxd/glyph/inspector.py` `_parse_reveal_scriptsig` (lines
164–203).

### Singleton Output Script

```
d8 <36-byte-ref> 75 76 a9 14 <20-byte-pubkeyhash> 88 ac
```

| Hex | Opcode | Description |
|-----|--------|-------------|
| `d8` | OP_PUSHINPUTREFSINGLETON | Consumes next 36 bytes as ref |
| (36 bytes) | ref | txid (reversed) + vout (LE) |
| `75` | OP_DROP | Drop the ref from stack |
| `76a914...88ac` | P2PKH | Standard P2PKH script |

**CRITICAL:** `d8` directly consumes the next 36 bytes. Do NOT add a push opcode:

- **Correct:** `d8<ref>7576a914...`
- **WRONG:** `d824<ref>7576a914...`

### JavaScript Implementation

```javascript
function buildSingletonScript(commitTxid, commitVout, ownerPubkeyhash) {
    const txidReversed = Buffer.from(commitTxid, 'hex').reverse().toString('hex');
    const voutLE = Buffer.alloc(4);
    voutLE.writeUInt32LE(commitVout);
    const ref = txidReversed + voutLE.toString('hex');

    // d8 + ref + 75 (OP_DROP) + 76a914 + pubkeyhash + 88ac
    const script = 'd8' + ref + '7576a914' + ownerPubkeyhash + '88ac';

    return { script, ref };
}
```

---

## Signing Challenge

### The Problem

The wallet RPC (`signrawtransactionwithwallet`) cannot sign transactions spending nftCommitScript because:
1. It's a custom script, not recognized P2PKH
2. The wallet doesn't know how to construct the correct scriptSig with glyph data

**Error:** "Unable to sign input, invalid stack size"

### The Solution: External Signing with Node.js

Use radiantjs library to sign the reveal transaction.

### Node.js Signing Script

> **Private Key Security:**
> - **Never** pass WIF keys as command-line arguments (visible in `ps`, shell history)
> - **Never** hardcode WIF keys in source code or commit to git
> - Load keys from files or environment at runtime: `fs.readFileSync('/path/to/key.wif', 'utf8').trim()`
> - For development, use a wallet with limited funds only
> - For production, use dedicated signing services or hardware wallets

```javascript
#!/usr/bin/env node
const { Script, Transaction, PrivateKey, crypto } = require('@radiantblockchain/radiantjs');

async function signReveal(params) {
    const { commitTxid, commitVout, wif, glyphHex, outputSats,
            commitScript, commitAmount, destPubkeyhash } = params;

    const privateKey = PrivateKey.fromWIF(wif);
    const publicKey = privateKey.toPublicKey();
    const pubkeyhash = destPubkeyhash ||
        crypto.Hash.sha256ripemd160(publicKey.toBuffer()).toString('hex');

    // Create 36-byte ref
    const txidReversed = Buffer.from(commitTxid, 'hex').reverse().toString('hex');
    const voutLE = Buffer.alloc(4);
    voutLE.writeUInt32LE(commitVout);
    const ref = txidReversed + voutLE.toString('hex');

    // Build singleton output script
    const singletonScript = 'd8' + ref + '7576a914' + pubkeyhash + '88ac';

    // Build transaction
    const tx = new Transaction();

    tx.addInput(new Transaction.Input({
        prevTxId: commitTxid,
        outputIndex: commitVout,
        script: new Script(),
        output: new Transaction.Output({
            script: Script.fromHex(commitScript),
            satoshis: commitAmount, // radiantjs uses 'satoshis' — these are photons on Radiant
        }),
    }));

    tx.addOutput(new Transaction.Output({
        script: Script.fromHex(singletonScript),
        satoshis: outputSats // photons
    }));

    // Build glyph scriptSig
    const glyMarker = Buffer.from('gly', 'utf8');
    const cborHex = glyphHex.substring(6);
    const cborBuffer = Buffer.from(cborHex, 'hex');

    // CRITICAL: Sign with FULL commit script, NOT P2PKH subscript
    tx.setInputScript(0, (txObj, output) => {
        const sigType = crypto.Signature.SIGHASH_ALL | crypto.Signature.SIGHASH_FORKID;

        const sig = Transaction.Sighash.sign(
            txObj,
            privateKey,
            sigType,
            0,
            output.script,  // MUST be full nftCommitScript
            new crypto.BN(String(commitAmount))
        );

        const sigBuffer = Buffer.concat([sig.toBuffer(), Buffer.from([sigType])]);

        // Build scriptSig: <sig> <pubkey> <"gly"> <CBOR>
        return Script.empty()
            .add(sigBuffer)
            .add(publicKey.toBuffer())
            .add(glyMarker)
            .add(cborBuffer)
            .toString();
    });

    tx.seal();

    return {
        success: true,
        signedTx: tx.toString(),
        txid: tx.id,
        ref: ref
    };
}
```

### Hardware Wallet Support

Glyph **minting** cannot currently be done from a hardware wallet: the reveal transaction's scriptSig (`<sig> <pubkey> <"gly"> <CBOR>`) is non-standard, and no mainstream hardware wallet supports signing arbitrary script structures. Minting requires software signing via Node.js as shown above.

Glyph **receiving and spending**, however, does work with the community-built Radiant Ledger Nano S Plus app. You can:

- Mint a Glyph with software signing and send the output to a Ledger-derived address (`m/44'/512'/0'/0/x`)
- Later spend that Glyph UTXO with a Ledger-signed transaction (the unlocking side is standard P2PKH)

See [`radiant-ledger-guide`](https://github.com/Zyrtnin-org/radiant-ledger-guide) for installation, wallet pairing, and the direct-APDU harness needed for spending Glyph UTXOs (Electron Radiant's GUI doesn't yet recognize Glyph-prefixed P2PKH as spendable — see section 6 of that guide).

First Ledger-signed Glyph UTXO spend confirmed on mainnet: [`22d4e0e07200437791b48651125a636b994593b215152241aef7113b24b71da3`](https://explorer.radiantblockchain.org/tx/22d4e0e07200437791b48651125a636b994593b215152241aef7113b24b71da3).

---

## Fee Calculations & Cost Analysis

> **V2 Fee Change (Block 415,000+):** Minimum relay fee increases 10x (1,000 to
> 10,000 photons/byte) after a 5,000-block grace period. Use `estimatefee` RPC
> instead of hardcoding fee rates.
>
> **Note:** `estimatefee` returns a dynamic network estimate that may be lower
> than the policy minimum. Always enforce the minimum relay fee as a floor:
> `max(estimatefee_result, minimum_relay_fee)`.

### Radiant Fee Structure

**Radiant uses photons/byte** (NOT photons/kB like Bitcoin):
- Minimum relay fee: **1000 photons/byte** (0.01 RXD/kB)
- Post-block 415,000: **10,000 photons/byte** (0.1 RXD/kB)
- Always add 50% safety margin

> **Terminology:** Photons are Radiant's smallest unit (like satoshis in Bitcoin).
> Code samples use `$feeSats` / `satoshis` variable names because radiantjs and
> most Radiant tooling inherited Bitcoin-style naming. The unit is the same — 1
> RXD = 100,000,000 photons.

### Fee Calculation Pattern

```php
function calculateFee($rpc, $txSize) {
    $blockHeight = $rpc->call('getblockcount');
    $minRate = ($blockHeight >= 415000) ? 10000 : 1000; // photons/byte

    // Use estimatefee as a signal, but never go below the minimum
    $estimate = $rpc->call('estimatefee', [6]); // RXD/kB
    $estimateRate = ($estimate > 0) ? $estimate * 100000000 / 1000 : $minRate; // → photons/byte

    $feeRate = max($minRate, $estimateRate);
    return $txSize * $feeRate * 1.5; // 50% safety margin, in photons
}
```

> ⚠️  **Don't hardcode `feeRate` in client JS.** The most common way to break
> users on a consensus-parameter change is to ship a JS bundle with a static
> fee rate (e.g. `feeRate = 1000`), let the CDN cache it for days, and never
> update when the network minimum moves. The CDN-cache trap in the
> troubleshooting section below compounds this: an `immutable` response can
> keep stale fees in browsers for a week after you think you've deployed the
> fix, producing "min relay fee not met" errors that *only* the users see.
>
> Compute `feeRate` server-side on every mint (as `calculateFee` above does),
> either by returning the current rate from your backend endpoint before the
> client builds a tx, or by letting the server build and sign the tx end-to-end
> (the pattern used in the Signing Challenge section). Either way, the network
> minimum should never live as a literal in long-lived cached JS.

### Common Fee Bug

```php
// WRONG - treats feeRate as photons/kB
$feeSats = ($txSize * $feeRate) / 1000;

// CORRECT - feeRate is already photons/byte
$feeSats = $txSize * $feeRate;
```

### Real-World Cost Examples

Observed on mainnet April 2026 minting a singleton-ref NFT with a small photo
payload through the commit/reveal path documented in this guide:

| Component | Size | Pre-V2 Cost | Post-V2 Cost (10x) |
|-----------|------|-------------|---------------------|
| Commit TX (observed) | ~276 bytes | ~0.003 RXD | ~0.028 RXD |
| Reveal TX (observed, ~640-byte glyph payload) | ~1,038 bytes | ~0.010 RXD | ~0.104 RXD |
| Thumbnail (150px, 65%) | ~6,000 bytes | ~0.06 RXD | ~0.6 RXD |
| Thumbnail (200px, 75%) | ~15,000 bytes | ~0.15 RXD | ~1.5 RXD |
| CBOR metadata | ~200-500 bytes | ~0.002-0.005 RXD | ~0.02-0.05 RXD |

A typical reveal is ~1 KB even with a small glyph — scriptSig carries signature +
pubkey + `"gly"` marker + CBOR body. Larger thumbnails push reveal size past 15 KB
quickly; plan for 0.5–2 RXD per NFT in real minting costs at post-V2 rates.

**Commit-amount sizing.** The commit transaction's output value must cover the
reveal transaction's fee **plus** the NFT output value (typically 10,000 photons
for the singleton dust). Observed: commit amount ≈ 10,400,000 photons to cover a
reveal at ~10,380,000 photons plus 10,000 photons NFT output.

**Total Cost Formula:**
```
Total = Commit Fee + Reveal Fee + (Thumbnail Size × fee_per_byte)
// Pre-V2:  fee_per_byte = 0.00001 RXD/byte (1000 photons/byte)
// Post-V2: fee_per_byte = 0.0001 RXD/byte  (10,000 photons/byte)
```

**Example with 150px thumbnail (pre-V2 / post-V2):**
- Commit: 0.003 / 0.03 RXD
- Reveal base: 0.0025 / 0.025 RXD
- Thumbnail (6KB): 0.06 / 0.6 RXD
- Metadata (300 bytes): 0.003 / 0.03 RXD
- **Total: ~0.07 / ~0.69 RXD**

**Example with 200px thumbnail (pre-V2 / post-V2):**
- Commit: 0.003 / 0.03 RXD
- Reveal base: 0.0025 / 0.025 RXD
- Thumbnail (15KB): 0.15 / 1.5 RXD
- Metadata (300 bytes): 0.003 / 0.03 RXD
- **Total: ~0.16 / ~1.59 RXD**

---

## IPFS Integration

### Purpose

Use IPFS for full-resolution images while keeping on-chain thumbnails small:
- **On-chain (`main` field):** Small thumbnail for wallet display
- **IPFS (`loc` field):** Full-resolution original

### Pinning Service Options

The examples below use **Pinata** because it has a stable REST API and a
reasonable free tier, but the Glyph protocol is pinning-service agnostic —
the `loc` field only needs a resolvable `ipfs://` URL. Alternatives if you
want to decouple from a single vendor:

| Service | Notes |
|---|---|
| **Pinata** (`api.pinata.cloud`) | Default in examples below. JWT auth, good free tier, dedicated gateways. |
| **web3.storage / Storacha** | Protocol-Labs-associated. Pivoted to paid "Storacha" tier in 2025; free tier limited/changed. Check current pricing before integrating. |
| **NFT.Storage** | Formerly free-for-NFTs; 2024 policy change migrated existing free pins to "Classic" tier with read-only access. Check current pricing before integrating. |
| **Filebase** (`s3.filebase.com`) | S3-compatible API, works with any AWS SDK. Paid, per-GB. |
| **4EVERLAND** | IPFS + Arweave in one API. Free tier available. |
| **Self-hosted Kubo node** | Full control; you pay bandwidth + disk. Easiest to lose pins if the node dies. |
| **Dedicated gateway** | Pinata, Cloudflare, Filebase, and Fleek all offer per-account dedicated gateways that resolve faster and aren't rate-limited. |

Rule of thumb: **pin to at least two independent services** so one vendor
going down or deprecating an API doesn't silently break your NFTs. Record
the `loc_hash` binding so you can re-pin from a different service later
without needing on-chain updates.

### CID Validation

> ⚠️  **A single-character CID truncation makes your NFT invisible on every
> IPFS gateway.** Real-world bug: a minting pipeline generated 58-character
> mock CIDs (one character short of a valid 59-character CIDv1) when Pinata
> wasn't configured, and silently embedded them on-chain. Every public
> gateway (`gateway.pinata.cloud`, `ipfs.io`, `dweb.link`) returned 400/422
> for the truncated CID — the NFT's `loc` field was permanently broken.
>
> Before writing `loc` into CBOR:
> - Validate CID length: CIDv1 with sha2-256 = 59 chars (`bafybei` + 52
>   base32). CIDv0 = 46 chars (`Qm` + 44 base58).
> - Validate CID resolves: `curl -sI https://gateway.pinata.cloud/ipfs/<cid>`
>   should return HTTP 200.
> - Never fall back to a mock/fake CID in production. If IPFS upload fails,
>   throw and surface the error — don't mint with a broken `loc`.
>
> The `main` field (on-chain thumbnail) is what wallets actually display.
> `loc` is the backup pointer. A broken `loc` doesn't make the NFT invisible
> in Glyphium — a missing `main` does. But a broken `loc` does mean the
> full-resolution image is unreachable, and once minted, the CID is permanent.

### Server-Side IPFS Upload (Pinata)

> ⚠️  **Secrets hygiene.** A Pinata JWT grants full account control (pin,
> unpin, billing). Treat it like a password. Keep real secrets in a local
> `.env` file, **add `.env` to `.gitignore`**, and commit a `.env.example`
> with placeholders so contributors know which keys to set. This applies to
> the Pinata JWT, your Radiant RPC password, any AI provider keys, and
> anything else `getenv()` reads. Public-repo secret leaks are the
> single most common way people burn themselves on projects built from
> guides like this one.

```php
function uploadFileToPinata($fileData, $filename, $mimeType = 'image/jpeg') {
    $jwt = getenv('PINATA_JWT');

    if (empty($jwt)) {
        return ['success' => false, 'error' => 'Pinata JWT not configured'];
    }

    // Handle base64 data URL
    if (strpos($fileData, 'data:') === 0) {
        $parts = explode(',', $fileData, 2);
        if (count($parts) === 2) {
            $fileData = base64_decode($parts[1]);
        }
    }

    $tmpFile = tempnam(sys_get_temp_dir(), 'pinata_');
    file_put_contents($tmpFile, $fileData);

    $cfile = new CURLFile($tmpFile, $mimeType, $filename);

    $ch = curl_init('https://api.pinata.cloud/pinning/pinFileToIPFS');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $jwt],
        CURLOPT_POSTFIELDS => ['file' => $cfile],
        CURLOPT_TIMEOUT => 60
    ]);

    $response = curl_exec($ch);
    curl_close($ch);
    unlink($tmpFile);

    $result = json_decode($response, true);
    $gateway = getenv('PINATA_GATEWAY') ?: 'gateway.pinata.cloud';

    // Defence in depth: validate PINATA_GATEWAY against a hostname allow-list
    // so a polluted env cannot redirect renders through an attacker-controlled
    // gateway. Rendering code that trusts gatewayUrl verbatim will fetch
    // content from whatever host is set here.
    // Cloudflare sunset their public IPFS gateway in 2024 — do not add it back.
    $allowedGateways = [
        'gateway.pinata.cloud',
        'ipfs.io',
        'dweb.link',
    ];
    if (!in_array($gateway, $allowedGateways, true)) {
        throw new RuntimeException("PINATA_GATEWAY '{$gateway}' not in allow-list");
    }

    // CRITICAL: validate the CID Pinata returned BEFORE minting it into the
    // `loc` field. A truncated or malformed CID mints permanently as an
    // unresolvable NFT (all public gateways return 400/422). Real-world bug
    // observed at FlipperHub: 58-character CIDv1 (one char short of 59) got
    // minted and every NFT with that `loc` was invisible in wallets.
    // Matches sha2-256 CIDv1 (bafybei + 52 base32 chars = 59 total) and CIDv0
    // (Qm + 44 base58 chars = 46 total). Pinata pins with sha2-256 by default,
    // so this covers the expected happy path. If you switch hash functions
    // (e.g. blake3) you will need to widen the regex.
    // Note the `D` flag: PHP's PCRE `$` matches before a trailing newline by
    // default, so without `D` a CID with a stray `\n` would pass validation
    // and be written into `loc` as a broken link. See the Wallet Classifier
    // section's cross-language regex note for the same pitfall in Python.
    $cid = $result['IpfsHash'] ?? '';
    if (!preg_match('/^(bafybei[a-z2-7]{52}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/D', $cid)) {
        return [
            'success' => false,
            'error'   => 'Pinata returned malformed CID (expected 59-char sha2-256 CIDv1 bafybei... or 46-char CIDv0 Qm...): ' . substr($cid, 0, 80)
        ];
    }

    return [
        'success' => true,
        'cid' => $cid,
        'url' => 'ipfs://' . $cid,
        'gatewayUrl' => "https://{$gateway}/ipfs/" . $cid
    ];
}
```

### SSL Certificate Issues

**Problem:** "SSL certificate problem: unable to get local issuer certificate"

**Development-only workaround** (never ship this):
```bash
# In .env — DEVELOPMENT ONLY. Disables TLS verification for the Pinata curl handle.
IPFS_SKIP_SSL_VERIFY=true
```

> ⚠️  **Never set this in production.** Disabling TLS verification lets an
> active network attacker (hotel/cafe wifi, corporate MITM proxy, compromised
> upstream) substitute the IPFS CID in Pinata's response. You then mint an NFT
> pointing at the attacker's content instead of yours — permanent and visible
> on chain. Fix the CA bundle instead.

**Production:** Configure proper CA bundle path in `curl.cainfo` php.ini
setting, or install `ca-certificates` in your container image so system roots
are present.

---

## Validating Your Builder Against Mainnet

**Synthetic tests alone cannot validate a wire-format builder.** If your
test suite only round-trips your own builder through your own parser
(`assert parse(build(x)) == x`), both can harbor coordinated bugs invisible
to every assertion — they were authored from the same flawed mental
model. A real example: a recent Radiant SDK shipped a complete green V1
dMint mint-tx builder that produced outputs the mainnet covenant rejects
100% of the time. 49 unit tests passed. The bug was caught by manually
walking mainnet bytes against the builder's output.

Before broadcasting any Glyph/FT/dMint transaction from new builder
code, run at least one **golden-vector** assertion: byte-equal your
builder's output against captured mainnet bytes for a known-good
transaction.

### Mainnet golden vectors

| What | Reference txid | What to compare |
|------|---------------|-----------------|
| Glyph NFT reveal w/ on-chain thumbnail | `27390efab1e3168c05301b18f6cdfd553a6d122a41496d0f5e104e79a918be7e` | scriptSig push stack (`<sig> <pubkey> <preimage with gly+CBOR>`) and the 63-byte singleton output |
| V1 dMint deploy commit + reveal (GLYPH token) | commit `a443d9df469692306f7a2566536b19ed7909d8bf264f5a01f5a9b171c7c3878b` / reveal `b965b32dba8628c339bc39a3369d0c46d645a77828aeb941904c77323bb99dd6` | 75-byte FT-commit hashlock script; 32 × 241-byte V1 contract output scripts |
| V1 dMint mint-tx reward output (snk token, 2026-01) | `146a4d68…f3c` vout[1] (75 bytes: `76 a9 14 <miner_pkh> 88ac bd d0 <token_ref> dec0e9aa76e378e4a269e69d`) | reward-output script byte-equal |
| V1 dMint mint-tx (PXD token, 2026-05-11) | `c9fdcd3488f3e396bec3ce0b766bb8070963e7e75bb513b8820b6663e469e530` | independent timestamp confirmation: same 4-output mint shape, same 72-byte mint scriptSig, byte-equal `_PART_C` reward bytecode |
| Live RBG dMint reveal w/ 10 V1 contracts | `c5c296ebff5869c6e2b208ce0cd04be479a9f10d33cf73608f0a5efc2d6b55b6` | classifier coverage on vouts 0–13 (10 dMint, 1 FT, 2 NFT, 1 P2PKH) |

### Required test pattern

For every new output your builder produces:

1. Capture the raw script hex from a mainnet RPC query
   (`getrawtransaction <txid> 1` then walk `vout[].scriptPubKey.hex`).
2. Pin the bytes as a constant in your test file with a comment naming
   the source txid and vout index.
3. Write a `test_byte_equal_to_mainnet_<vout>` assertion that runs your
   builder with the same params and `assert build(...) == GOLDEN`.
4. Run the golden-vector test first, before any round-trip test, in
   your CI matrix. A round-trip green + golden red means the bug is
   in your shared mental model, not at the boundary.

If you cannot find a real mainnet instance of the format you're
building, you are either targeting a future protocol version (mark
it experimental and gate it behind an explicit opt-in flag — see "V2
dMint footgun" below) or implementing a format that was never deployed
(a trap; revisit your spec source).

---

## Common Errors & Solutions

### Environment & Infrastructure

These are the errors you hit *before* any protocol-level problem, and they
account for the majority of time lost setting up a minting pipeline for the
first time.

#### `sh: node: not found` (from PHP)

**Cause:** The web container doesn't have Node.js installed, but your PHP code
is trying to shell out to `node scripts/sign_reveal.js`.

**Fix:** Install Node in the Dockerfile. See Infrastructure Setup → Calling the
Signer from PHP.

#### `Method not found` (code -32601) for `listunspent` / `dumpprivkey` / `signrawtransactionwithwallet`

**Cause:** Your Radiant daemon was built without wallet support. v2.2.0 prebuilt
tarballs ship node-only; v2.1.2 tarballs are mislabeled ARM64.

**Fix:** Upgrade to a wallet-enabled build (v2.3.0+). Verify with
`docker exec radiant-node radiant-cli -datadir=/home/radiant/.radiant listwallets`.
Remember `--no-cache` on the rebuild, and **back up `wallet.dat` first**.

#### `Cannot find module '@radiantblockchain/radiantjs'` (from Node)

**Cause:** radiantjs isn't installed, or is installed at the wrong path (npm put
it at `node_modules/radiantjs/` because that's the dep key you used).

**Fix:** Either install with `npm install github:chainbow/radiantjs` and accept
npm's placement, or add a symlink:

```bash
mkdir -p node_modules/@radiantblockchain
ln -sfn ../radiantjs node_modules/@radiantblockchain/radiantjs
```

If your deps live at `/opt/signing-deps/node_modules`, set
`NODE_PATH=/opt/signing-deps/node_modules` so the lookup walks there.

#### "Node.js signing failed" with a valid `{"success":true,"signedTx":…}` in the message

**Cause:** PHP's `proc_close()` returns -1 because `proc_get_status()` already
reaped the child. The signed transaction in stdout is *correct*; the exit code
is bogus.

**Fix:** Capture the exit code from `proc_get_status()['exitcode']` at the
moment `running=false`, and parse stdout JSON before falling back to the exit
code. See Infrastructure Setup → Calling the Signer from PHP for a reference
implementation.

#### Web container can't reach the Radiant node ("Connection refused" / DNS fails)

**Cause:** Containers are on separate Docker networks, or `rpcbind=127.0.0.1`
in `radiant.conf` restricts the daemon to in-container loopback.

**Fix:** Set `rpcbind=0.0.0.0` + `rpcallowip=172.16.0.0/12` in `radiant.conf`,
bind host ports to `127.0.0.1:`, and attach both containers to the same Docker
network. See Infrastructure Setup → Networking the Node.

#### Schema drift: three variants of "missing column"

The database part of minting has three distinct failure modes that look
superficially similar but need different diagnostics. If you hit any of
them, check **all three** locations where a new column lives: the schema
definition, the API whitelist that filters incoming writes, and the
actual INSERT/UPDATE column list.

| Symptom | Cause |
|---|---|
| `ERROR: must be owner of table` on `ALTER TABLE` | Running migration as the app user instead of `postgres` superuser. Use `-U postgres`. |
| Every write returns 500 with `column "X" does not exist` | New code deployed before migration ran. Always migrate the DB *first*. |
| Write "succeeds" in the UI but state resets on reload | Column exists in schema but API whitelist strips it, or upsert omits it. Save path silently drops the field; reload repopulates from DB with the missing value. |
| Write succeeds but silently no-ops on one field | ORM silently dropping unknown columns. Check your DB client's strict/loose mode and the UPDATE column list. |

The "looks saved in JS but resets on reload" version is the sneakiest — the
failing field looks like a frontend bug because the UI appears to accept the
change. It's almost always a desync between schema / API / upsert: the three
places a new column has to be threaded through.

#### Stale JS served to users after deploy

**Cause:** CDN (usually Cloudflare) is holding the unversioned JS/CSS file
because your nginx sent `Cache-Control: public, immutable; expires 7d`.

**Fix:** Change the nginx rule for JS/CSS to a short TTL with revalidation, and
purge the CDN cache to evict the already-poisoned entries:

```nginx
# Short-cache unversioned JS/CSS — lets deploys reach users within minutes.
location ~* \.(css|js)$ {
    expires 5m;
    add_header Cache-Control "public, max-age=300, must-revalidate";
}
# Keep `immutable` for content-addressed assets only.
location ~* \.(svg|png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot)$ {
    expires 7d;
    add_header Cache-Control "public, immutable";
}
```

#### CORS-blocked image fetch from an IPFS/R2 gateway

**Cause:** CDN cache was populated by a non-browser fetch with no `Origin`
header, so the cached response has no `Access-Control-Allow-Origin`. All
subsequent browser `fetch()` calls hit the same poisoned entry.

**Fix:** Add a per-request cachebuster on the authoritative fetch
(`?_cb=<timestamp>`), then purge the CDN cache once to evict the poisoned
response. Your origin (R2, Pinata, etc.) should have CORS configured correctly;
the problem is almost always the intermediate CDN layer.

### Protocol Errors

#### "FT UTXO not recognized by wallet" / FT balance shows as 0

**Cause:** Wallet's script classifier only recognizes plain 25-byte P2PKH. The
75-byte FT holder template (`76a914 <pkh> 88ac bd d0 <ref> dec0e9aa…`) falls
through to "unknown script type" and is never associated with the owning
address.

**Fix:** Add the FT classifier regex to the wallet's script recognizer:
```
^76a914[0-9a-f]{40}88acbdd0[0-9a-f]{72}dec0e9aa76e378e4a269e69d$
```
On match, extract `pkh` at positions `[6:46]` and `ref` at `[54:126]`. Group FT
UTXOs by ref and sum photon values for per-token balance. See the "Wallet
Classifier Patterns" section above + the reference implementation in
[`classifier.mjs`](https://github.com/Zyrtnin-org/radiant-ledger-app/blob/main/view-only-ui/classifier.mjs).

Same pattern applies to NFT singletons (63 bytes) — see the classifier table.

**Related defense:** if you're writing the wallet itself, the inverse
bug — *recognizing* an FT/NFT UTXO and then spending it as plain
funding — silently burns the token. See "Token-Burn Defense: Coin
Selection Must Reject Token-Bearing UTXOs" under the Wallet
Classifier Patterns section.

#### "Trying to spend a 241-byte FT control output — fails at consensus"

**Cause:** The wallet classified the 241-byte FT mint-authority script as a
spendable output. These are NOT wallet-owned P2PKH outputs — they enforce mint
rules and cannot be spent with a `<sig> <pubkey>` scriptSig.

**Fix:** Ensure the classifier rejects scripts that don't match the three known
patterns (P2PKH, NFT singleton, FT holder). The 241-byte control scripts
correctly fall through to "unknown" in the reference classifier.

#### "NFT shows as blank card in wallet"

**Cause:** Missing `main` field with on-chain image data.

**Fix:** Add thumbnail to payload:
```javascript
payload.main = {
    t: 'image/webp',        // Must match thumbnail format
    b: thumbnailUint8Array  // Must be Uint8Array, not base64
};
```

#### "NFT shows as 'Unknown NFT' with no metadata"

**Cause:** NFT was encoded with JSON instead of CBOR.

**Symptoms:**
- NFT appears but shows as "Unknown NFT"
- No attributes visible
- Browser console shows: "CBOR library not loaded, using JSON fallback"

**Fix:**
1. Download CBOR library (vendor a pinned version — see the supply-chain
   warning in Infrastructure Setup; do not fetch from `master` at build time
   on production systems). Example: `curl -o js/cbor.min.js "https://raw.githubusercontent.com/paroga/cbor-js/<commit-sha>/cbor.js"` then verify with `sha256sum`.
2. Load BEFORE blockchain scripts in HTML
3. Verify: `console.log(typeof CBOR)` should output "object"
4. Mint new NFT (old one cannot be fixed)

**Related decode bugs:** if metadata decoding TypeErrors on
`main.b`, your decoder is not unwrapping CBORTag 64 — see
"Decoding `main.b`: Handle CBORTag 64". If the walker terminates
before finding the `'gly'` marker on a reveal with embedded media
(>64 KB), it's missing OP_PUSHDATA4 support — see "Push-Stack
Walker Must Handle OP_PUSHDATA4".

#### "Extra items left on stack after execution"

**Cause:** Using P2PKH commit instead of nftCommitScript.

**Fix:** Pass `glyphHex` to commit transaction:
```javascript
const glyphData = encodeGlyphData(payload);
const glyphHex = Array.from(glyphData).map(b => b.toString(16).padStart(2, '0')).join('');
const commitResult = await createCommitTransaction(feeRate, glyphHex);
```

#### "Unable to sign input, invalid stack size"

**Cause:** Wallet RPC cannot sign custom nftCommitScript.

**Fix:** Use external signing with Node.js and radiantjs (see Signing Challenge section).

#### "min relay fee not met (code 66)"

**Cause:** Transaction fee is below Radiant's enforced minimum relay fee.

**Fix (post-V2 mainnet, block ≥ 415,000):**
```php
// Radiant Core 2 enforces a minimum relay fee of 0.1 RXD/kB = 10,000 photons/byte.
// This is fully in effect from block 415,000 onward; between 410,000 and 415,000
// miners ran in a grace window that capped policy at the legacy 0.01 RXD/kB floor.
$minRate = 10000;                       // photons/byte (post-V2 minimum)
$feeSats = $txSize * $minRate * 1.5;    // photons, with safety margin
```

If you're building against a chain before block 415,000 (e.g. regtest or a custom network that hasn't grace-graduated), you can use `getblockcount` to pick the right floor:

```php
$h = $rpc->call('getblockcount');
$minRate = ($h < 415000) ? 1000 : 10000; // legacy floor before grace ends
```

Mainnet has been past 415,000 since early 2026; production code should default to 10,000.

#### "reference-operations" error

**Cause:** Incorrect ref format or extra push opcode.

**Fix:**
- Verify ref = reversed(txid) + LE(vout), exactly 36 bytes
- Use `d8<ref>75...` NOT `d824<ref>75...`

#### "Signature must be zero"

**Cause:** Signing with P2PKH subscript instead of full commit script.

**Fix:** In signing script, use `output.script` (full nftCommitScript).

#### "SSL certificate problem" (IPFS upload)

See the full discussion in "IPFS Integration → SSL Certificate Issues" above —
including the warning about why you must not ship with `IPFS_SKIP_SSL_VERIFY=true`
enabled.

#### "Child NFTs don't appear in container" (Glyphium/Explorers)

**Cause:** Using txid-derived ref instead of extracting from output script.

**Symptoms:**
- Child NFTs exist and are visible in explorers
- BUT they don't appear nested under the container
- Container shows 0 children even though child NFTs have `in` field set

**Fix:**
```javascript
// ❌ WRONG - Don't calculate from txid
const wrongRef = reverseHex(containerTxid) + '00000000';

// ✅ CORRECT - Extract from output script
const tx = await rpc.call('getrawtransaction', [containerTxid, true]);
const script = tx.vout[0].scriptPubKey.hex;
const correctRef = script.substring(2, 74);  // Skip 'd8', take next 72 chars
```

**Why it happens:**
- The singleton ref is based on the COMMIT transaction, not the reveal
- Reveal txid ≠ the ref value in the output script
- You must query the blockchain and extract the ref from the actual output

**Verification:**
1. Check your container ref matches the value in the output script (starts at position 2)
2. Child NFTs should use this exact ref in their `in` field
3. In Glyphium, click the container - children should be listed

**For dMint-specific issues** (deploy walk returns wrong tx, V1/V2
confusion, V1 mint funding rejected) see the corresponding sections
under Security Best Practices and What's New in V2.

---

## Complete Implementation Example

### Full Minting Flow with Thumbnail

```javascript
class GlyphNFTMinter {
    async mintNFT(imageDataUrl, metadata, ownerAddress) {
        // Step 1: Create thumbnail for on-chain storage (225px @ 90% WebP)
        const thumbnail = await this.createThumbnail(imageDataUrl, 225, 0.90);
        console.log(`Thumbnail: ${thumbnail.length} bytes`);

        // Step 2: Upload full-res to IPFS (optional)
        const ipfsResult = await this.uploadToIPFS(imageDataUrl);
        console.log(`IPFS: ${ipfsResult.url}`);

        // Step 3: Build payload with main field
        const payload = {
            p: [2],
            name: metadata.name,
            type: metadata.type || 'photo',
            main: {
                t: 'image/webp',  // WebP for best quality/size ratio
                b: thumbnail
            },
            loc: ipfsResult.url,
            attrs: metadata.attrs || {}
        };

        // Step 4: Encode to CBOR
        const glyphData = this.encodeGlyphData(payload);
        const glyphHex = Array.from(glyphData)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        // Step 5: Create commit transaction
        const commitResult = await this.createCommitTransaction(glyphHex);
        console.log('Commit TX:', commitResult.txid);

        // Step 6: Wait for confirmation
        await this.waitForConfirmation(commitResult.txid);

        // Step 7: Create and sign reveal transaction
        const revealResult = await this.createRevealTransaction(
            commitResult, glyphHex, ownerAddress
        );
        console.log('Reveal TX:', revealResult.txid);

        return {
            commitTxid: commitResult.txid,
            revealTxid: revealResult.txid,
            glyphId: `${revealResult.txid}:0`,
            ref: revealResult.ref,
            thumbnailSize: thumbnail.length,
            ipfsUrl: ipfsResult.url
        };
    }

    async createThumbnail(dataUrl, maxSize = 225, quality = 0.90) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxSize) {
                        height = Math.round((height * maxSize) / width);
                        width = maxSize;
                    }
                } else {
                    if (height > maxSize) {
                        width = Math.round((width * maxSize) / height);
                        height = maxSize;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);

                // Use WebP for best quality/size ratio
                canvas.toBlob((blob) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(new Uint8Array(reader.result));
                    reader.onerror = reject;
                    reader.readAsArrayBuffer(blob);
                }, 'image/webp', quality);
            };
            img.onerror = reject;
            img.src = dataUrl;
        });
    }

    encodeGlyphData(data) {
        if (typeof CBOR === 'undefined') {
            throw new Error('CBOR library not loaded!');
        }
        if (!data.p) data.p = [2];

        const marker = new TextEncoder().encode('gly');
        const cborData = CBOR.encode(data);
        const payload = new Uint8Array(cborData);

        const result = new Uint8Array(marker.length + payload.length);
        result.set(marker, 0);
        result.set(payload, marker.length);
        return result;
    }
}
```

---

## Testing & Verification

### Golden vectors must come from real mainnet bytes

Synthetic round-trip tests (`assert parser(builder(x)) == x`) cannot
validate that your builder produces bytes the network accepts. The
builder and parser, written together by the same author, agree because
they share the same mental model — including any bugs in that model.

**Rule:** Every protocol output that lands on-chain must have at least
one test that asserts byte-equality against bytes captured directly
from chain. Each such test must:

- Cite the source transaction (txid, vout index, research doc reference).
- Use real hex captured from RPC, not synthetic fixtures.
- Be the **first** check on a new builder, not a polish addition.
- Treat a failure as an on-chain conformance regression, not a harness glitch.

Recommended golden-vector anchors for any new Glyph builder:

| Builder | Mainnet anchor |
|---|---|
| V1 dMint contract output | GLYPH reveal `b965b32d…9dd6` vout 0..31 (each is a 241-byte V1 contract) |
| V1 dMint mint reward (75-byte FT) | mint tx `146a4d68…f3c` vout 1 — see `dmint-research-mainnet.md` §4 |
| FT holder template | any of the 2,309 samples cited in §"Fungible Tokens" |
| NFT singleton | container reveal `4edad669…3b63` vout 0 |
| dMint deploy commit (FT-commit hashlock) | `a443d9df…878b` vout 0 |
| dMint deploy reveal | `b965b32d…9dd6` (35 outputs total) |

A worked example of this discipline catching a show-stopper bug — V1
dMint mint outputs that would have been rejected by every node, but
passed 49 synthetic tests — is documented at
`docs/solutions/logic-errors/dmint-v1-mint-shape-mismatch.md` in pyrxd.

### Verify CBOR Encoding

```javascript
// Before minting, verify CBOR is working
const testPayload = { p: [2], name: "Test" };
const encoded = CBOR.encode(testPayload);
const decoded = CBOR.decode(encoded);
console.log('CBOR test:', decoded.name === "Test" ? 'PASS' : 'FAIL');
```

### Verify Thumbnail

```javascript
// Check thumbnail size before minting
const thumbnail = await createThumbnail(imageDataUrl, 225, 0.90);
console.log(`Thumbnail size: ${thumbnail.length} bytes`);
if (thumbnail.length > 30000) {
    console.warn('Thumbnail large - consider reducing quality or dimensions');
}
```

### Verify on Glyph Explorer

Visit: `https://glyph-explorer.rxd-radiant.com/tx/<reveal_txid>`

You should see:
- NFT image displayed (from `main` field)
- NFT metadata
- Container/author refs (if used)
- Attributes

### Verify in Glyphium Wallet

Import your wallet and check:
- NFT appears in collection
- Thumbnail is visible and clear
- Attributes are readable

### Verified Working Transactions (January 2026)

**With on-chain thumbnail:**
- Reveal: `27390efab1e3168c05301b18f6cdfd553a6d122a41496d0f5e104e79a918be7e`
- Thumbnail: 150x200, ~14KB, displays correctly in Glyphium

**dMint V1 deploy (GLYPH token, height 228,604 — byte-decoded from chain):**
- Deploy commit: `a443d9df469692306f7a2566536b19ed7909d8bf264f5a01f5a9b171c7c3878b`
  - 35 outputs: 1 FT hashlock + 32 ref-seeds + 1 NFT hashlock + 1 change
  - Serialized size: 1,448 bytes
- Deploy reveal: `b965b32dba8628c339bc39a3369d0c46d645a77828aeb941904c77323bb99dd6`
  - 36 inputs × 35 outputs; serialized size: 79,141 bytes
  - vouts 0–31: 241-byte V1 dMint contract scripts (32 contracts)
  - vout 32: 63-byte FT NFT singleton
  - vout 33: 63-byte auth NFT singleton
  - vout 34: change P2PKH
- Token params: `numContracts=32`, `reward=50,000 photons`, `maxHeight=625,000`,
  `target=0x00da740da740da74`, `algo=sha256d`
- Full byte-decode: `pyrxd/docs/dmint-research-photonic-deploy.md` §§2–4

These are the canonical golden vectors for any V1 dMint deploy implementation.
Use them as the "chain is the oracle" test: your deploy reveal's vout 0 should be
byte-identical to the GLYPH reveal's vout 0 after substituting your deployer PKH
and commit txid. For additional golden-vector txids covering V1 dMint mint and
classifier coverage on live RBG dMint reveals, see [Validating Your Builder
Against Mainnet](#validating-your-builder-against-mainnet).

**V1 dMint mint tx (canonical 4-output shape — byte-decoded from chain):**
- `146a4d688ba3fc1ea9588e406cc6104be2c9321738ea093d6db8e1b83581af3c` — snk
  token, block 422,865. 2 inputs (contract + funding), 4 outputs (recreated
  241-byte contract + 75-byte FT reward + OP_RETURN msg marker + change).
  vin[0] is the canonical 72-byte V1 mint scriptSig
  (`<0x04 nonce(4)> <0x20 inputHash(32)> <0x20 outputHash(32)> <0x00>`).
  Full byte-decode: `pyrxd/docs/dmint-research-mainnet.md` §4.
- `c9fdcd3488f3e396bec3ce0b766bb8070963e7e75bb513b8820b6663e469e530` —
  PXD token, 2026-05-11. Independent confirmation at a different
  timestamp (block 422,865 for snk vs. 2026-05-11 for PXD), same
  4-output shape and same 72-byte mint scriptSig layout. Used to
  verify the V1 covenant accepts pyrxd's own mint output bytes. PXD
  deploy reveal: `8eeb333943771991c2752abc78038365ecd76b1a24426f7a3212eea71b6a6564`.

Use the snk mint as the primary golden vector for the V1 mint tx output
shape and scriptSig layout. See [§8 V1 mint tx
mechanics](#v1-mint-tx-mechanics-mainnet-verified) for the byte layout
and PoW preimage construction.

---

## Security Best Practices

### Input Validation for Blockchain Operations

When building applications that interact with the Radiant blockchain, **always validate inputs** before passing them to RPC calls or transaction signing scripts. Malformed data can cause errors, vulnerabilities, or unexpected behavior.

#### Transaction ID Validation

```javascript
// Validate txid format (64 hex characters)
function isValidTxid(txid) {
    return /^[a-f0-9]{64}$/i.test(txid);
}

// Example usage
const commitTxid = userInput.trim();
if (!isValidTxid(commitTxid)) {
    throw new Error('Invalid transaction ID format');
}
```

```php
// PHP version
if (!preg_match('/^[a-f0-9]{64}$/i', $commitTxid)) {
    throw new Exception('Invalid commit transaction ID format');
}
```

#### Glyph Hex Validation

Glyph payloads must start with the "gly" marker (`676c79` in hex). Validate both format and size:

```javascript
// Validate glyph hex format
function isValidGlyphHex(glyphHex) {
    // Must start with "gly" marker (676c79)
    if (!glyphHex.toLowerCase().startsWith('676c79')) {
        return false;
    }

    // Must be valid hex
    if (!/^[a-f0-9]+$/i.test(glyphHex)) {
        return false;
    }

    // Reasonable size limit (e.g., 100KB = 200,000 hex chars)
    if (glyphHex.length > 200000) {
        return false;
    }

    return true;
}
```

```php
// PHP version with detailed validation
function validateGlyphHex($glyphHex) {
    // Validate format (must start with "gly" marker)
    if (!preg_match('/^676c79[a-f0-9]*$/i', $glyphHex)) {
        throw new Exception('Invalid glyph hex format (must start with "gly" marker)');
    }

    // Validate length (prevent excessive data)
    if (strlen($glyphHex) > 200000) { // 100KB hex = 200,000 chars
        throw new Exception('Glyph hex data too large (max 100KB)');
    }

    return true;
}
```

#### Output Index Validation

Validate that output indices (vout) are within reasonable bounds:

```javascript
function isValidVout(vout) {
    const index = parseInt(vout, 10);
    return !isNaN(index) && index >= 0 && index < 1000;
}
```

```php
// Validate commitVout is a non-negative integer in a sane range.
// NOTE: use is_int + explicit cast, NOT just "< 0 || > 1000" — PHP's
// type coercion means the string "abc" compares false to both bounds
// and slips through. Do the type check first.
if (!is_int($commitVout)) {
    // Most $_POST/$_GET/JSON values arrive as strings; cast deliberately.
    if (!is_numeric($commitVout) || (int)$commitVout != $commitVout) {
        throw new Exception('Invalid commit output index (not an integer)');
    }
    $commitVout = (int)$commitVout;
}
if ($commitVout < 0 || $commitVout > 1000) {
    throw new Exception('Invalid commit output index');
}
```

#### Address Validation

Always validate Radiant addresses using the RPC:

```javascript
async function validateAddress(address) {
    const validation = await rpc.call('validateaddress', [address]);
    if (!validation.isvalid) {
        throw new Error('Invalid Radiant address');
    }
    return validation;
}
```

```php
// PHP version
if ($destAddress) {
    $validation = $this->rpc->call('validateaddress', [$destAddress]);
    if (!$validation['isvalid']) {
        throw new Exception('Invalid destination address');
    }
}
```

#### Complete Example: Secure Reveal Transaction Creation

```php
function createRevealTransaction($commitTxid, $commitVout, $glyphHex, $destAddress = null) {
    // 1. Validate commit txid format
    if (!preg_match('/^[a-f0-9]{64}$/i', $commitTxid)) {
        throw new Exception('Invalid commit transaction ID format');
    }

    // 2. Validate commit vout is a non-negative integer.
    //    Cast first — PHP type coercion lets strings like "abc" pass bounds checks.
    if (!is_numeric($commitVout) || (int)$commitVout != $commitVout) {
        throw new Exception('Invalid commit output index (not an integer)');
    }
    $commitVout = (int)$commitVout;
    if ($commitVout < 0 || $commitVout > 1000) {
        throw new Exception('Invalid commit output index');
    }

    // 3. Validate glyph hex format and content
    if (!preg_match('/^676c79[a-f0-9]*$/i', $glyphHex)) {
        throw new Exception('Invalid glyph hex format (must start with "gly" marker)');
    }

    // 4. Validate glyph hex length (prevent excessive data)
    if (strlen($glyphHex) > 200000) { // 100KB hex = 200,000 chars
        throw new Exception('Glyph hex data too large (max 100KB)');
    }

    // 5. Validate destination address if provided
    if ($destAddress) {
        $validation = $this->rpc->call('validateaddress', [$destAddress]);
        if (!$validation['isvalid']) {
            throw new Exception('Invalid destination address');
        }
    }

    // All inputs validated - proceed with transaction creation
    return $this->executeRevealTransaction($commitTxid, $commitVout, $glyphHex, $destAddress);
}
```

#### Why This Matters

- **Prevents Script Errors**: Malformed hex or txids can cause Node.js signing scripts to crash
- **Avoids Lost Funds**: Invalid addresses or indices can result in unspendable outputs
- **Security**: Validates data before passing to shell commands or RPC calls
- **Better UX**: Provides clear error messages before attempting blockchain operations

#### Validation Checklist

Before any blockchain operation:

- [ ] Transaction IDs are 64 hex characters
- [ ] Output indices are non-negative integers < 1000
- [ ] Glyph hex starts with `676c79` ("gly" marker)
- [ ] Glyph hex is valid hexadecimal only
- [ ] Glyph hex size is reasonable (< 100KB recommended)
- [ ] Radiant addresses validated via RPC `validateaddress`
- [ ] All user inputs sanitized before passing to shell commands

### Error Message Hygiene: Don't Log Key Material

Every error path that interpolates a user-supplied value is a key-leak
risk. Common offenders:

- `throw new Error("Invalid WIF: " + wif)` — leaks the private key into stack traces.
- `console.log("signing tx:", rawTx)` where `rawTx` includes a debug
  preimage push of a privkey.
- `logger.exception()` over a function whose `args` include a WIF/mnemonic
  passed for diagnostic context.
- Crash-report telemetry that uploads the full exception message.

**Defensive pattern:** wrap any error message that touches a
caller-supplied value in a redaction helper. Long base58/hex strings
and BIP-39 mnemonics get replaced with `<redacted>` before the message
crosses any logging boundary.

```python
import re

_HEX_OR_B58 = re.compile(r"^[A-Za-z0-9+/=]{20,}$")

def redact(value):
    if isinstance(value, bytes) and len(value) > 8:
        return f"<redacted:{len(value)}b>"
    if isinstance(value, str) and len(value) > 8:
        # BIP-39 mnemonic heuristic: >=8 space-separated ASCII lowercase tokens
        tokens = value.split()
        is_mnemonic = (len(tokens) >= 8 and
                       all(t.isascii() and t.isalpha() and t.islower() for t in tokens))
        if is_mnemonic or _HEX_OR_B58.match(value):
            return "<redacted>"
    return value

class WalletError(Exception):
    def __init__(self, *args):
        super().__init__(*(redact(a) for a in args))

# Usage — caller-supplied values pass through redaction automatically:
raise WalletError("invalid WIF", user_input_wif)
# Logged message: "invalid WIF <redacted>"
```

```javascript
function redact(v) {
    if (typeof v === 'string' && v.length > 8) {
        // BIP-39 mnemonic
        const tokens = v.split(/\s+/);
        if (tokens.length >= 8 && tokens.every(t => /^[a-z]+$/.test(t))) return '<redacted>';
        // Long hex / base58 / base64
        if (/^[A-Za-z0-9+/=]{20,}$/.test(v)) return '<redacted>';
    }
    if (v instanceof Uint8Array && v.length > 8) return `<redacted:${v.length}b>`;
    return v;
}
```

Apply at the boundary, not at the call site — defenders should not
have to remember `redact()` at every `throw`. Have a single error
base class that runs redaction in its constructor. New code that
inherits the base class gets the defense for free.

**Specifically: never include the WIF, private key, mnemonic, or seed
phrase in any error message string.** Use a static description
(`invalid WIF format`); for diagnostics, log a structural hint
(`expected 52-char base58, got 31 chars`) instead of the value
itself.

---

## What's New in V2

> V2 is live on mainnet. This section has been updated against a running Radiant
> Core v2.3.0 node (tip beyond 420,000) and verified against the consensus
> parameters in `src/chainparams.cpp`, `src/policy/policy.h`, and
> `src/script/script.h`.

### V2 Activation (Block 410,000)

At block 410,000, three things activated simultaneously:

- **ASERT difficulty adjustment** — the half-life dropped from 2 days to 12 hours,
  so block-time variance is tighter. Expect faster recovery from hashrate spikes
  and drops.
- **Six new opcodes** — `OP_BLAKE3` (`0xee`), `OP_K12` (`0xef`), `OP_LSHIFT` (`0x98`),
  `OP_RSHIFT` (`0x99`), `OP_2MUL` (`0x8d`), `OP_2DIV` (`0x8e`). These enable dMint
  mining validation and advanced script contracts. See Appendix opcode table.
- **New fee framework** — defined at 410,000 but enforced on a delay (see below).

### Fee Increase (Block 415,000, after grace)

The minimum relay fee rose 10x from 0.01 RXD/kB (legacy) to **0.1 RXD/kB**
(10,000 photons/byte), with a maximum block min-fee cap of **0.5 RXD/kB**. Between
blocks 410,000 and 415,000, miners ran under a 5,000-block (~1 week) grace window
that kept the effective floor at the legacy rate. From block 415,000 onward, the
0.1 RXD/kB floor is fully enforced — every transaction you build today must meet
it or receive `{"code":-26,"message":"min relay fee not met (code 66)"}`.

See Fee Calculations & Cost Analysis for the post-V2 cost tables.

### New Protocols: dMint and WAVE

- **dMint** — Mineable token distribution via PoW. Protocol combination `[1, 4]`.
  Three active mining algorithms: SHA256D (`0xaa`), BLAKE3 (`0xee`), K12 (`0xef`),
  though only SHA256D appears on mainnet today. See [Decentralized Mint (dMint)](#decentralized-mint-dmint)
  for the full V1 contract layout, deploy commit/reveal shapes, CBOR schema, and
  the warning that Photonic-master ships V2-only emitters. For V2-only algorithm
  and DAA mode parameters, see the [Radiant AI Knowledge Base](https://github.com/Radiant-Core/radiant-mcp-server/blob/master/docs/RADIANT_AI_KNOWLEDGE_BASE.md).
- **WAVE** — On-chain naming system. Protocol 11. Provides human-readable addresses and DNS-like records.

### Footgun: V2 dMint Deploys Have No Miners (Use V1)

V2 dMint exists in the protocol spec but is **not** the version live on
mainnet. As of May 2026, every dMint contract observable on Radiant
mainnet — the entire ecosystem — is V1. No ecosystem miner targets V2.
Indexer (RXinDexer) behavior on V2 deploys is empirically undefined.
Deploying a V2 dMint today produces a token nobody can mine: the
contract sits on chain forever, the premise of mineable distribution
silently breaks, no error is raised.

**Pattern your deploy code should adopt:**

```python
def prepare_dmint_deploy(params, *, allow_v2_deploy: bool = False):
    if params.version == 2 and not allow_v2_deploy:
        raise DmintError(
            "V2 dMint deploys have no ecosystem miner and indexer "
            "behavior is undefined. Refusing to build a token nobody "
            "can mine. For V1 (the only live mainnet format), pass "
            "DmintV1DeployParams. To deploy V2 anyway (e.g. SDK "
            "testing), pass allow_v2_deploy=True."
        )
    ...
```

This is a footgun-mitigation pattern: V2 may become the live format
later, but the deploy is irreversible. An explicit opt-in flag forces
the caller to confirm they understand the consequence at the call
site, not in a README.

See [Decentralized Mint (dMint)](#decentralized-mint-dmint) for the
canonical V1 deploy shape.

---

## Appendix: Quick Reference

### Opcodes

| Hex | Name | Notes |
|-----|------|-------|
| `aa` | OP_HASH256 | Double SHA256 |
| `88` | OP_EQUALVERIFY | Check equal and remove |
| `c0` | OP_INPUTINDEX | BCH introspection |
| `c8` | OP_OUTPOINTTXHASH | BCH introspection - input txid |
| `c9` | OP_OUTPOINTINDEX | BCH introspection - input vout |
| `da` | OP_REFTYPE_OUTPUT | Check ref type in outputs |
| `d8` | OP_PUSHINPUTREFSINGLETON | Create singleton ref (NFT) |
| `d0` | OP_PUSHINPUTREF | Create non-singleton ref (FT) |
| `bd` | OP_STATESEPARATOR | Split prologue/epilogue (runtime NOP) |
| `e3` | OP_CODESCRIPTHASHVALUESUM_UTXOS | Sum input photons by codeScript hash (FT conservation) |
| `e4` | OP_CODESCRIPTHASHVALUESUM_OUTPUTS | Sum output photons by codeScript hash (FT conservation) |
| `75` | OP_DROP | Remove top stack item |
| `76` | OP_DUP | Duplicate top stack item |
| `a9` | OP_HASH160 | RIPEMD160(SHA256(x)) |
| `ac` | OP_CHECKSIG | Verify signature |

#### V2 Opcodes (available after block 410,000)

| Hex | Name | Notes |
|-----|------|-------|
| `ee` | OP_BLAKE3 | BLAKE3 hash (max 1024-byte input) |
| `ef` | OP_K12 | KangarooTwelve hash |
| `98` | OP_LSHIFT | Bitwise left shift |
| `99` | OP_RSHIFT | Bitwise right shift |
| `8d` | OP_2MUL | Multiply by 2 |
| `8e` | OP_2DIV | Divide by 2 |

### Key Hex Values

| Purpose | Hex |
|---------|-----|
| "gly" marker | `676c79` |
| Push 3 bytes | `03` |
| Push 20 bytes | `14` |
| Push 32 bytes | `20` |
| OP_PUSHDATA1 | `4c` |

### Checklist Before Minting

- [ ] CBOR library loaded (`typeof CBOR === 'object'`)
- [ ] Thumbnail created (Uint8Array, < 30KB recommended)
- [ ] `main` field added to payload with `t` and `b` properties
- [ ] Protocol set (`p: [2]`)
- [ ] Name set
- [ ] Sufficient RXD balance for fees

### Cost Quick Reference

See [Thumbnail Size vs Cost Tradeoffs](#thumbnail-size-vs-cost-tradeoffs) and [Fee Calculations & Cost Analysis](#fee-calculations--cost-analysis) for detailed cost tables with pre-V2 and post-V2 pricing.

---

**Last Updated:** 2026-05-11 — added V1 mint tx mechanics (4-output shape, 72-byte mint scriptSig, PoW preimage construction, `PowPreimageResult` reference API). 2026-05-10 added Decentralized Mint (dMint) section with V1 contract layout, deploy shape, CBOR schema, and chain-walking patterns. Based on byte-by-byte mainnet research from pyrxd's V1 dMint mint + deploy work. See Changelog.
**Based on Verified Mainnet Transactions:**
- With thumbnail: `27390efab1e3168c05301b18f6cdfd553a6d122a41496d0f5e104e79a918be7e`

**Key Highlights:**
1. On-chain images (`main` field) required for wallet display
2. CBOR encoding mandatory (JSON = "Unknown NFT")
3. Optimal thumbnail: 225px WebP @ 90% quality (~22KB, ~0.22 RXD pre-V2)
4. V2-ready fee calculations with pre/post cost tables
5. All 11 Glyph protocol types and 6 new V2 opcodes documented
6. MCP server integration for AI-assisted development (see [BUILDING_WITH_CLAUDE.md](BUILDING_WITH_CLAUDE.md))

**License:** MIT
**Radiant Blockchain:** https://radiantblockchain.org

---

## Disclaimer & Warranty

This guide is provided **as is**, without warranty of any kind, express or
implied. The patterns, code, and templates documented here have been tested
against mainnet at a specific point in time but consensus rules,
dependencies, and infrastructure can change. Readers are responsible for:

- Verifying all claims against the current Radiant Core source and their
  own test results on regtest before deploying to mainnet.
- Auditing any third-party dependency they install (`chainbow/radiantjs`,
  `paroga/cbor-js`, Radiant Core release tarballs, Pinata SDKs, Ledger
  app-radiant-v1 firmware). Nothing in this guide constitutes a
  recommendation that these dependencies are trustworthy — it documents
  *how* to use them with the least risk, not *whether* to use them.
- Their own key management and funds. The authors accept no liability for
  lost RXD, lost NFTs, lost FT supply, stuck commit UTXOs, or
  attacker-controlled spends resulting from misapplied patterns.

**Ledger app-radiant-v1 is community-maintained and unaudited.** The
customisable-helpers patch described in this guide (and shipped in the
`v0.0.8-glyph-transfer` release) was built to demonstrate that Glyph
transfer-preserving spends *can* be signed by a Ledger device. It has not
undergone a formal security audit. Use it on testnet first; if you use it
on mainnet, start with values you can afford to lose.

In short: treat this guide as a technical map, not a warranty. The terrain
is yours to navigate.

---

## Changelog

Radiant's on-chain protocol is versioned by activation height (V2 = block
410,000, fee change = 415,000, etc.). This guide is versioned independently
and tracks documentation evolution.

| Date | Commit range | Summary |
|---|---|---|
| 2026-05-11 | (this commit, pyrxd 0.5.0 audit) | Three follow-ups from the pyrxd 0.5.0 re-audit. (1) **R3 PUSHDATA4 reveal-payload support**: confirmed the GLYPH mainnet reveal `b965b32d…9dd6` uses `OP_PUSHDATA4` (`0x4e`) to push a 65,569-byte CBOR body (over the `OP_PUSHDATA2` 65,535-byte ceiling). The recommended CBOR payload cap is **256 KB** (262,144 bytes) via PUSHDATA4 — already noted in §§8, 11, 12; this changelog row records the verification. (2) **R1 reward-shape statement strengthened**: the §8 V1-vs-V2 table now states explicitly that V2's entire 107-byte output-validation block (the FT-conservation epilogue, `_PART_C` in the pyrxd reference, equal to `_V1_EPILOGUE_SUFFIX[18:]`) is byte-identical to V1's tail — not merely the 12-byte `dec0e9aa76e378e4a269e69d` fingerprint. The whole epilogue is shared, which is what the covenant actually enforces. (3) **Second mainnet mint golden vector locked in**: PXD token mint `c9fdcd3488f3e396bec3ce0b766bb8070963e7e75bb513b8820b6663e469e530` (2026-05-11; deploy reveal `8eeb333943771991c2752abc78038365ecd76b1a24426f7a3212eea71b6a6564`) is now pinned alongside the snk mint `146a4d68…f3c` (block 422,865) as a second independent timestamp confirming the canonical V1 mint scriptSig and 4-output shape. The §8 mainnet-anchors table and §17 golden-vectors table both reference the pair; the §16 Verified Working Transactions entry was updated from "independent confirmation" to its explicit PXD label. No new sections added; edits limited to existing dMint coverage. |
| 2026-05-11 | (earlier commit) | V1 mint mechanics: added "V1 mint tx mechanics (mainnet-verified)" subsection to §8 covering the canonical 4-output mint tx shape (contract recreate + 75-byte FT reward + OP_RETURN `6a 03 6d7367 …` msg marker + change), the 72-byte V1 mint scriptSig layout (`<0x04 nonce(4)> <0x20 inputHash(32)> <0x20 outputHash(32)> <0x00>`), the V1 PoW preimage construction (`SHA256(outpointTxHash || contractRef) || SHA256(SHA256d(input_script) || SHA256d(output_script))`, hashed with the 4-byte nonce via `SHA256d`), and the `build_pow_preimage` / `build_mint_scriptsig` reference API (now returning `PowPreimageResult(preimage, input_hash, output_hash)`). Anchored against mainnet mints `146a4d68…f3c` and `c9fdcd34…e530`. Fixed broken TOC sub-anchors under §8 and a stray HTML-comment fragment in the Known Gotchas section. Also (same day, separate edit) clarified that V2 mint reward outputs are **byte-identical** to V1 (75-byte FT-wrapped with the same `dec0e9aa76e378e4a269e69d` fingerprint) — the only mint-tx-level V1/V2 difference is the scriptSig nonce width (4 vs 8 bytes). This was caught by a red-team audit of the pyrxd reference implementation, which had a latent bug emitting a plain 25-byte P2PKH at vout[1] for V2 mints; the bug was fixed pre-V2-mainnet-deploy by routing V2 through the same FT-wrapped reward bytecode (`_PART_C`) used by V1. Any implementation emitting a plain P2PKH at vout[1] — V1 or V2 — will be rejected by the covenant. Generalised the §8 reward-shape gotcha to V1+V2 and added explicit V1/V2 rows to the critical-warning table. |
| 2026-05-10 | (prior) | Major dMint expansion: new top-level §8 "Decentralized Mint (dMint)" section with V1 contract byte layout (state 96B + epilogue 145B = 241B), deploy commit/reveal shape (N+3 outputs each), V1 CBOR schema (`p:[1,4]`, no `v`), warning that Photonic-master ships V2-only emitters, opcode-aware classification rule + canonical walker, token-burn defense for funding-input selection, scripthash-history disambiguation pattern, PUSHDATA4 sizing rule for large CBOR bodies, "Known gotchas" subsection covering the four pyrxd compound-doc findings (classifier gap, mint-shape mismatch, hashlock reuse, byte-scan DoS). Anchored with GLYPH deploy commit `a443d9df…878b` and reveal `b965b32d…9dd6`, both added to Verified Working Transactions. Added "First dMint deploy or mint?" routing to FOR AI AGENTS block. Replaced the §19 dMint stub with an in-guide cross-reference. Corrected mis-labeling of dMint contract UTXOs as "FT control / mint-authority." Based on pyrxd M1+M2 byte-by-byte research (`dmint-research-mainnet.md`, `dmint-research-photonic-deploy.md`). |
| 2026-04-17 | (prior) | Added MUST-vs-SHOULD tier table for CBOR fields, cross-language regex note for wallet classifiers, multi-library CBOR ecosystem warning, alternative IPFS provider options, CID validation in `uploadFileToPinata`, Changelog section. |
| 2026-04-17 | `4a9d87d` | Ultrathink review fixes: tx-output validation gate (integer math), radiantjs SHA pin, Radiant Core tarball verification, PINATA_GATEWAY hostname allow-list, `loc_hash` field, `proc_terminate` fallback on signing timeout, MCP guide WIF hardening. Recovery walkthroughs (regtest funding, failed-reveal recovery). FT ref construction by copy-from-existing-UTXO. Anchored 63-byte NFT regex. CBOR attrs restricted to string-keyed primitives. Disclaimer + Ledger-app unaudited note. |
| 2026-04-16 | `63da546`, `08d623d`, `b2a496b` | Repo renamed to `radiant-glyph-guide`. Section-numbering fixes, scriptSig order corrections, thumbnail-size tradeoff table. Reviewer fixes: precision language, glossary, PII review, FT epilogue opcode decode. |
| 2026-04-16 | `2a71304` | Added FT support end-to-end: 75-byte holder template, wallet classifier patterns, `OP_STATESEPARATOR` + conservation epilogue decode against Radiant Core source, CID validation guidance after the 58-char truncation bug. |
| earlier | — | NFT-only reference, V2 opcode/fee coverage, CBOR payload format, commit/reveal flow, Common Errors catalogue. |

### When to re-verify

- **Radiant Core release**: re-run the Verified Working Transactions section against the new version.
- **Glyph protocol addition** (new opcode, new protocol ID, new required CBOR field): audit sections 5 (On-Chain Images), 7 (Fungible Tokens), 8 (CBOR Payload Format), 14 (Common Errors).
- **Pinata/IPFS API change**: audit `uploadFileToPinata` and the IPFS Integration section.
- **Electron-Wallet / Ledger firmware update**: audit the Hardware Wallet pointer and [`radiant-ledger-guide`](https://github.com/Zyrtnin-org/radiant-ledger-guide) cross-reference.
- **First mainnet V2 dMint deploy**: update §7 dMint section with V2 contract layout, update Verified Working Transactions, and add a V2 row to the V1/V2 CBOR distinction table.
