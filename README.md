# Radiant Blockchain Glyph NFT Implementation Guide

**Complete Technical Documentation for Building NFT Applications on Radiant**

> **Guide version:** see the [Changelog](#changelog) at the bottom.
> **Protocol baseline:** Radiant V2 (block 410,000) + post-V2 fees (block 415,000) + script-security soft fork (block 440,000; mainnet nodes must run Radiant Core v3.1.1 or newer).
> **Last on-chain verification:** see the [Verified Working Transactions](#verified-working-transactions-january-2026) section for mainnet txids that back the claims in this document.
> **Integrity (read BEFORE pasting into an AI agent):** the canonical source is `MudwoodLabs/radiant-glyph-guide` on GitHub. Before pasting into an agent session that has file-write or network access, clone the repo (`git clone https://github.com/MudwoodLabs/radiant-glyph-guide`), run `git log --oneline` to see the commit history, and diff the current `README.md` against an earlier commit you recognize (e.g. `git diff <known-good-commit>..HEAD README.md`). A compromised fork or a commit injected by an attacker could add instructions that exfiltrate keys or insert backdoors into signing code — and you will not see the injection just by reading the rendered markdown.

This guide provides everything you need to implement Glyph NFTs on the Radiant blockchain, updated for **V2** (block 410,000+). It includes critical discoveries from real-world implementation, all 11 Glyph protocol types, V2 opcode reference, and updated fee calculations for the post-V2 fee increase.

Designed to be used as context for AI coding agents (Claude, Cursor, etc.) — paste the README into your session and start building. See [BUILDING_WITH_CLAUDE.md](BUILDING_WITH_CLAUDE.md) for MCP server setup and AI-assisted workflow tips.

> **FOR AI AGENTS — Start Here:**
> - **First NFT mint?** → Read sections 2 (Critical Requirements), 5 (On-Chain Images), 9 (CBOR Payload), then 10-12 (Commit/Reveal/Signing)
> - **First FT integration?** → Read section 7 (Fungible Tokens) for the 75-byte template + wallet classifier patterns
> - **First dMint deploy or mint?** → Read [section 8 (Decentralized Mint)](#decentralized-mint-dmint) for the V1 contract layout, deploy commit/reveal shape, [V1 mint tx mechanics](#v1-mint-tx-mechanics-mainnet-verified) (4-output shape, mint scriptSig, PoW preimage layout), and Photonic divergences. See also the [byte-decoded GLYPH reference deploy and GLYPH/PXD mint txs](#verified-working-transactions-january-2026).
> - **Writing a covenant or token-aware contract?** → Read [Avoid Phantom Refs in Embedded Bytecode](#constructing-covenants-avoid-phantom-refs-in-embedded-bytecode) and [NFT Conservation Has No Consensus "Exactly One" Rule](#nft-conservation-has-no-consensus-exactly-one-rule): an FT cannot be held in a foreign covenant (gate its spend path); an NFT can. For ref-authenticity checks against an indexer, see [Resolving a Ref via RXinDexer](#resolving-a-ref-via-rxindexer).
> - **Debugging a failed mint?** → Jump to section 16 (Common Errors) and the Appendix (opcodes, hex values)
> - **Upgrading to V2?** → Read section 20 (What's New in V2) and the Fee Calculations section for updated costs
> - **Hardware wallet (Ledger) support?** → See [`radiant-ledger-guide`](https://github.com/MudwoodLabs/radiant-ledger-guide). Minting still requires software signing; receiving + spending Glyph UTXOs works with the community Ledger app
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
   - [V1 contract UTXO byte layout (GLYPH example)](#v1-contract-utxo-byte-layout-glyph-example-241-b--state96--code145)
   - [dMint deploy: commit-tx output shape](#dmint-deploy-commit-tx-output-shape)
   - [dMint deploy: reveal-tx I/O shape](#dmint-deploy-reveal-tx-io-shape)
   - [V1 mint tx mechanics (mainnet-verified)](#v1-mint-tx-mechanics-mainnet-verified)
   - [dMint CBOR token body](#dmint-cbor-token-body-revealed-in-vin0)
   - [Photonic Wallet divergences](#photonic-wallet-divergences-v1-dmint)
   - [Finding the deploy reveal from a commit txid](#finding-the-deploy-reveal-from-a-commit-txid-scripthash-history-gotcha)
   - [Known gotchas](#known-gotchas)
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

### Container Organization: Payload `in` Field vs Commit and Reveal Addresses

**IMPORTANT:** The container an NFT belongs to is set by the payload's `in` field (the container NFT's 36-byte ref), not by any address. The commit address is the key that must sign the reveal (the commit script ends in its P2PKH); the reveal destination address determines who owns the NFT.

```
┌─────────────────────────────────────────────────────────┐
│ CBOR PAYLOAD                                             │
│ - in: [<container NFT ref>]                             │
│ - Purpose: Places the NFT in your platform's container  │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│ COMMIT TRANSACTION                                       │
│ - Address: Admin/Platform wallet                        │
│ - Purpose: This key must sign the reveal                │
│ - Result: UTXOs and change stay with platform           │
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
- **Payload `in`:** Your platform's container ref, extracted from the container NFT's singleton output (see [Container and Author Refs](#container-and-author-refs))
- **Commit address:** Your platform's wallet (it signs every reveal)
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
  and its underlying JS library. Photonic depends on `@radiant-core/radiantjs`
  (the maintained Radiant-Core fork, published on npm), and this guide's
  signer examples use the same package as the server-side signer.
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

> **Radiant code lives in `github.com/Radiant-Core/*`.** The older
> `github.com/RadiantBlockchain/*` account (radiant-node, radiantjs,
> electron-radiant, electrumx) has had no commits since 2024-07-28 and is not
> maintained. This guide uses `Radiant-Core/Radiant-Core` for the node and
> `Radiant-Core/radiant-mcp-server` for the MCP server. **Before
> cloning or installing any dependency this guide links to, verify on
> [radiantblockchain.org](https://radiantblockchain.org) or in the
> `#dev` / `#announcements` channels of the Radiant Discord that you are
> pulling from the intended org** — an attacker forking the less-canonical
> path could insert compromised builds. Pinning exact versions or SHAs (as shown below for
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
- **Photonic builds V2 dMint.** Photonic's dMint UI builds V2
  (10-state-item) deploy shapes. Mainnet carries both V1 contracts
  and V2 contracts (since at least block 438,356), and V2 contracts
  are mined by Glyph-miner. Do not assume a V1 parser handles a
  Photonic-built deploy, or the reverse. (See the dMint section.)
- **Review what you copy.** Review any Photonic code path you copy
  against your own threat model before adopting it, and record which
  file and commit you copied in the divergence log below.

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

1. **Radiant Node** (wallet-enabled build). This guide's examples were verified against v2.3.0; the current release is v3.1.2, and v3.1.1 or newer is mandatory for mainnet operators (script-security soft fork at block 440,000).

   The wallet-capability story is not obvious from release titles:
   - **v2.1.2**: prebuilt linux-x64 tarball is an x86-64 build but ships without wallet support (no `listwallets` / `dumpprivkey`), so it is unusable here. Build from source or upgrade.
   - **v2.2.0**: prebuilt linux-x64 runs on x86_64 but **ships without wallet support**
     compiled in. `listwallets`, `listunspent`, `dumpprivkey`, and
     `signrawtransactionwithwallet` all return `-32601 Method not found`. Every
     minting flow in this guide depends on wallet RPCs, so v2.2.0 is unusable here.
   - **v2.3.0**: prebuilt linux-x64 (`radiant-core-linux-x64-v2.3.0.tar.gz`), wallet-enabled. This is the first release the guide's examples have been verified against.
   - **v3.1.x**: the prebuilt linux-x64 download is `radiant-core-gui-linux-x64-v<ver>.tar.gz` (contains `radiantd` and `radiant-cli`, wallet-enabled; has a `.sha256` file). v3.0.0 changed the default HD derivation path to `m/44'/512'/0'/0/k`.

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
   # Dockerfile.mainnet.v2 is your own Dockerfile (Radiant-Core ships none by that
   # name), built from the official release tarball as shown below.
   docker build --no-cache -t radiant-core:3.1.2 -f Dockerfile.mainnet.v2 .
   docker run -d --name radiant-node \
     -p 127.0.0.1:7332:7332 \
     -p 7333:7333 \
     -v radiant-data:/home/radiant/.radiant \
     radiant-core:3.1.2
   ```

   **Verify the tarball SHA256 before you RUN it.** Your Dockerfile should
   contain an explicit checksum step so a swapped release asset fails the
   build rather than silently producing a malicious node. Copy the published
   SHA from the release's `SHA256SUMS.txt`, then:

   ```dockerfile
   ARG RADIANT_VERSION=3.1.2
   ARG RADIANT_SHA256=<paste-from-SHA256SUMS.txt>
   ARG RADIANT_TARBALL=radiant-core-gui-linux-x64-v${RADIANT_VERSION}.tar.gz
   RUN curl -fsSLO "https://github.com/Radiant-Core/Radiant-Core/releases/download/v${RADIANT_VERSION}/${RADIANT_TARBALL}" && \
       echo "${RADIANT_SHA256}  ${RADIANT_TARBALL}" | sha256sum -c - && \
       tar xzf "${RADIANT_TARBALL}"
   ```

   Asset names and archive layout change between releases (v2.3.0:
   `radiant-core-linux-x64-v2.3.0.tar.gz`, binaries at the archive root;
   v3.1.2: `radiant-core-gui-linux-x64-v3.1.2.tar.gz`, binaries under
   `radiant-core-gui-linux-x64-v3.1.2/`). Check the release's asset list and
   inspect with `tar tzf` before updating your `cp` paths — but never skip
   the checksum step.

   **Bind RPC to `127.0.0.1:` on the host.** The P2P port 7333 is the only port
   that should face the public internet. See "Networking the Node" below for the
   matching `radiant.conf` settings when the node and your PHP backend run in
   separate Docker containers.

2. **Node.js** - a supported release for signing scripts (v22 or v24; v18 and v20 are EOL).
   ```bash
   node --version  # Should be 22.x or higher
   ```

3. **radiantjs Library** - For transaction signing.

   Use `@radiant-core/radiantjs`, the maintained Radiant-Core fork
   (github.com/Radiant-Core/radiantjs), published on npm and used by Photonic
   Wallet, Glyph-miner and the Radiant MCP server. The older
   `chainbow/radiantjs` fork has had no commits since 2024-03-22, and the
   `@radiantblockchain/radiantjs` name it declares is not on the npm registry.
   Pin an exact version you've reviewed, since this library sits directly in
   your signing path:
   ```bash
   npm install --save-exact @radiant-core/radiantjs@2.0.6
   # Or pin a reviewed commit instead of a registry version:
   npm install github:Radiant-Core/radiantjs#<commit-sha>
   ```
   Commit the `package-lock.json` alongside so the exact resolved tarball is
   frozen across machines.

   The signing script does `require('@radiant-core/radiantjs')`. The package
   name matches the require path, so no symlink is needed.

   In a `package.json`:
   ```json
   "dependencies": {
     "@radiant-core/radiantjs": "2.0.6"
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
   # (only one tag exists, v0.1.0 from 2015; master is 65dc49611107db83aff8308a6b381f4d7933824b, 2016-09-22). Review the diff from whatever commit you pick back
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
   > is the library this guide's examples use (Photonic Wallet and Glyph-miner use
   > `cbor-x`). Some Radiant projects vendor a **custom minimal CBOR encoder** (smaller file size,
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
# Expected: 50000.00000000 (first coinbase, matured — Radiant's block subsidy is 50,000 RXD)
```

Point your minter's RPC config at the regtest node (default RPC port `17443`,
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
docker run --rm --entrypoint=sh <image> -c 'strings /usr/local/bin/radiantd | grep -c "Wallet file not specified"'
# Should print 1; 0 means a node-only build.
```

`listunspent` is not a usable marker: the string appears in node-only builds
too (it is in the RPC client's conversion table).

**2. Protect `wallet.dat` at upgrade time.** The wallet lives in your node's
datadir volume — e.g. `/home/radiant/.radiant/wallet.dat` inside the container.
Persisting the volume is necessary but **not sufficient** across version jumps:

- A node-only binary leaves `wallet.dat` untouched (no wallet code = nothing
  that would touch the file).
- A wallet-enabled binary that cannot read `wallet.dat` refuses to start
  ("Wallet corrupted" / "requires newer version"). The silent failure is a
  **path** change: if `-datadir`, `-walletdir` or `-wallet` resolves somewhere
  else after the upgrade, the node creates a fresh empty wallet there and the
  original is simply not loaded. The symptom is `getaddressinfo <addr>`
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

# Restrict who's allowed to talk to RPC to your app network's own CIDR.
# Find it with:
#   docker network inspect <app-network> --format '{{(index .IPAM.Config 0).Subnet}}'
rpcallowip=127.0.0.1
rpcallowip=172.20.0.0/16           # example — replace with YOUR app network's CIDR
# Do NOT use the broad Docker range 172.16.0.0/12 on a shared host: every
# container in 172.16-31.x could then reach your RPC with only the
# rpcpassword between it and a wallet-enabled node.

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
# Prometheus: the node serves /metrics on the RPC port (7332), behind RPC auth
# unless -metricsauth=0. There is no separate metrics port to publish.
```

**Connecting from another container.** If your PHP backend lives in a separate
compose file / network, attach the Radiant container to that network with an
alias so app code can use a stable hostname:

```bash
docker network connect --alias radiant-rpc <app-network> radiant-node
```

Then in your app's env: `RADIANT_RPC_HOST=radiant-rpc`. DNS resolves to the
container's IP on the shared network; make sure that network's subnet is the
one you listed in `rpcallowip` (not the broad `172.16.0.0/12` range).

### Calling the Signer from PHP

The Signing Challenge section later in this guide shows a Node.js script
(save it as `scripts/sign_reveal.js`) that builds and signs the reveal transaction. It has
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
# signing-deps/package.json pins "@radiant-core/radiantjs": "2.0.6" (exact, no ^),
# and signing-deps/package-lock.json is committed alongside it. Treat radiantjs
# as an untrusted dependency (see Supply-Chain section below): `npm ci` installs
# exactly what the lockfile records and fails if it does not match package.json.
COPY signing-deps/package.json signing-deps/package-lock.json /opt/signing-deps/
RUN cd /opt/signing-deps && npm ci --omit=dev

ENV NODE_PATH=/opt/signing-deps/node_modules
```

**Never use a floating radiantjs dependency in a production image** (a `^`
range, `latest`, or an unpinned `github:` URL, which resolves the default
branch at image-build time). A compromised upstream or a branch rename could
silently substitute code that signs transactions with attacker-controlled
values. Use a version or commit you have reviewed, and update the pin through
a deliberate PR, not a rebuild.

Also check your deploy pipeline: `rsync --exclude node_modules/` matches
*every* `node_modules` directory, so scripts-level deps never reach the server
that way. Either allow-list the specific path or install inside the image at
build time as above.

**3. `proc_close()` can lie about exit codes.** When PHP shells out to Node and
polls `proc_get_status()` in a loop to detect completion, `proc_get_status()`
reaps the process and consumes the exit code (PHP 8.2 and earlier, including
the `php:8.2-fpm-alpine` image used here; PHP 8.3+ caches it). The subsequent
`proc_close()` then returns `-1`, so code that does `success = ($returnCode === 0)`
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
a future supply-chain swap of `radiantjs`) could emit a structurally
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

// 4. Value conservation: Σ inputs − Σ outputs must equal the fee you computed, exactly.
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
conservation — is the defense against a compromised `radiantjs` or
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

An off-chain full-resolution copy is for **backup**, not wallet display. Pointing
`loc` at it is a convention of this guide: in the Glyph spec `loc` is a
link-token location, and remote files are described as `{t, u, h}`.

### The `main` Field Structure

```javascript
{
    p: [2],
    name: "My NFT",
    main: {
        t: 'image/webp',           // MIME type (must match thumbnail format)
        b: thumbnailUint8Array     // Image data as Uint8Array
    },
    loc: 'ipfs://Qm...',           // Full-res backup (optional; guide convention — see above)
    loc_hash: 'sha256:abcd…'       // Guide/pyrxd convention, not a Glyph protocol field
}
```

> **Optionally bind off-chain content with `loc_hash`** (a convention of this
> guide and pyrxd, not a Glyph protocol field; Photonic and RXinDexer do not
> read it, and the spec's own remote-file hash is `h`). An `ipfs://` CID is
> already content-addressed: whoever controls the pinning service can unpin
> it, but cannot swap it for different bytes under the same CID. A hash adds
> integrity only when `loc` is a mutable URL (`https://…`), where whoever
> controls the host can swap the asset. Recording `sha256:<hex>` of the file's
> raw bytes lets a viewer that implements this convention detect that swap:
> compute `sha256(bytes)` of whatever the server returns, compare, reject
> mismatches. As specified (`sha256:<hex>` text), `loc_hash` costs about
> 82 bytes on chain (~0.008 RXD at post-V2 rates).

**Consumer-side verification** — `loc_hash` only helps if the *renderer*
checks it. Minimal viewer code (browser-side, matching the
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
they cannot claim that content fetched from a mutable `loc` URL is authentic. If your renderer is
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

Safari and iOS browsers cannot encode WebP from a canvas: `canvas.toBlob(...,
'image/webp')` silently returns a PNG, which is also several times larger. Set
`main.t` from the blob's actual type (as `createThumbnail` below does), never
hard-code it.

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

            // Request WebP. Safari/iOS cannot encode WebP from a canvas and
            // silently return PNG instead, so report the type the browser
            // actually produced — never hard-code `main.t`.
            canvas.toBlob((blob) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const bytes = new Uint8Array(reader.result);
                    console.log(`Thumbnail: ${width}x${height}, ${bytes.length} bytes (${blob.type})`);
                    resolve({ bytes, type: blob.type });
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

    // CRITICAL: Add thumbnail for wallet display.
    // photoData.thumbnail is { bytes, type } from createThumbnail() above.
    if (photoData.thumbnail && photoData.thumbnail.bytes instanceof Uint8Array) {
        payload.main = {
            t: photoData.thumbnail.type,  // the type the browser actually encoded
            b: photoData.thumbnail.bytes
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
> `photoData.thumbnail.bytes` is a real `Uint8Array`. If it's a plain `Array` of
> numbers (e.g. `Array.from(uint8)`), `paroga/cbor-js` encodes it as a CBOR
> **array of integers (major type 4)**, not a **byte string (major type 2)**.
> The bytes land on chain, but Glyph wallets look for major type 2 and render
> your NFT as a blank card. Two checks save you:
>
> 1. **At payload-build time**, assert the type: `if (!(thumbnail.bytes instanceof Uint8Array)) throw new Error('thumbnail must be Uint8Array');`
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
    // paroga/cbor-js strips tags by default (its default tagger returns the
    // inner value); this branch only matters for a decoder or custom tagger
    // that keeps tags as { tag, value } objects.
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
`decode_payload`'s CBORTag-64 unwrap (pyrxd 6207b5b8).

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
Reversed:    263c6922e5b0bfb29b78e25331822ba0b59924d4da5348b414225b082d40fb6a
Vout: 0
Vout LE:     00000000
Ref:         263c6922e5b0bfb29b78e25331822ba0b59924d4da5348b414225b082d40fb6a00000000
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

### NFT Conservation Has No Consensus "Exactly One" Rule

A common and dangerous assumption is that Radiant consensus guarantees an NFT
singleton always lands on **exactly one** output. **It does not.** The
consensus ref rules enforce only two things:

- **Output refs ⊆ input refs** (`validatePushRefRule` in `validation.h`): a
  singleton appearing on an output must trace back to a singleton on some
  input — you cannot conjure one from nothing.
- **No disallowed siblings** (`validateDisallowedSiblingsRefRule`): the ref may
  not appear on an output it was forbidden from.

Neither rule requires the singleton to appear on **any** output. Spending an
NFT into a transaction with zero copies of its ref is a perfectly valid
**burn** at consensus — the token is destroyed, no error raised. "Exactly one
output, carrying the singleton forward" is a property a **wallet or covenant
must enforce itself** (e.g. `tx.outputs.length == 1` +
`tx.outputs.refOutputCount(ref) == 1`); there is no consensus backstop.

Two consequences worth internalizing:

1. **A careless or malicious spend can burn an NFT irreversibly.** A coin
   selector that treats an NFT UTXO as plain RXD funding (see [Token-Burn
   Defense](#token-burn-defense-coin-selection-must-reject-token-bearing-utxos)
   below) destroys it; so does any transaction that simply omits the
   forwarding output. For a one-of-one there is no recovery — the conservation
   guarantee is entirely on you.
2. **An NFT *can* be held directly inside a covenant.** Unlike an FT — which is
   welded to its code-script by the conservation epilogue and cannot be moved
   into a foreign script (see [Avoid Phantom
   Refs](#constructing-covenants-avoid-phantom-refs-in-embedded-bytecode)
   below) — an NFT singleton is welded only to its 36-byte ref. A covenant of
   the form `d8 <ref> 75 <covenant-logic>` both holds the singleton and gates
   its spend; consensus places no code-script constraint on where the singleton
   goes, which is exactly why the covenant body is the *sole* guarantor of
   conservation.

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

**What the epilogue does** (source: [`interpreter.cpp:2389-2426`](https://github.com/Radiant-Core/Radiant-Core/blob/9cd72aa98ea03378e4b0f2ac4025202963267516/src/script/interpreter.cpp#L2389-L2426)):

The 12-byte suffix encodes the FT conservation law. The two key introspection
opcodes in the sequence are:

- `e3` = `OP_CODESCRIPTHASHVALUESUM_UTXOS` — sum the photon values of all
  inputs whose `codeScript` hash matches the current script's hash
- `e4` = `OP_CODESCRIPTHASHVALUESUM_OUTPUTS` — same, for outputs

The full sequence is `de` OP_REFOUTPUTCOUNT_OUTPUTS, `c0` OP_INPUTINDEX,
`e9` OP_CODESCRIPTBYTECODE_UTXO, `aa` OP_HASH256, `76` OP_DUP, `e3`,
`78` OP_OVER, `e4`, `a2` OP_GREATERTHANOREQUAL, `69` OP_VERIFY,
`e6` OP_CODESCRIPTHASHOUTPUTCOUNT_OUTPUTS, `9d` OP_NUMEQUALVERIFY.
`aa 76 78 a2 69 9d` are inherited Bitcoin opcodes, `c0` is native
introspection, and `de e9 e3 e4 e6` are Radiant ref/code-script opcodes.
Together they wire the two sums into the conservation check. A full opcode-by-opcode decode is available in
[`radiant-ledger-app/docs/solutions/integration-issues/radiant-glyph-ft-template-and-view-only-renderer.md`](https://github.com/MudwoodLabs/radiant-ledger-app/blob/d7427359f3a9a3393bf769c43a0a17c84ee1ec92/docs/solutions/integration-issues/radiant-glyph-ft-template-and-view-only-renderer.md) — for this guide, the important
takeaway is that together they enforce **Σ input photons ≥ Σ output photons**
per codeScript hash, and that every output carrying the ref also carries this
code-script — tokens cannot be inflated by a normal spend. New supply enters
only at the token's genesis reveal or, for dMint tokens, through the dMint
contract (see [§8](#decentralized-mint-dmint)).

**`OP_STATESEPARATOR` (`0xbd`)** has consensus-level significance: it splits
the script into a **prologue** (P2PKH, evaluated against the scriptSig for
signature verification) and an **epilogue** (FT conservation, evaluated by
consensus for token-supply invariants). During script *execution*
([`interpreter.cpp`](https://github.com/Radiant-Core/Radiant-Core/blob/9cd72aa98ea03378e4b0f2ac4025202963267516/src/script/interpreter.cpp#L2164))
it acts as a NOP — it doesn't push, pop, or branch — but its *position* in
the script is what determines the boundary between "what the signer proves"
and "what the network enforces." Don't omit it; don't move it. The scriptSig
only needs to satisfy the prologue — which is why FT spends use the same
`<sig> <pubkey>` as plain P2PKH. A hardware-wallet app must still recognise
the 75-byte output on its review screen: the community Ledger app needed its
Glyph-transfer firmware changes (see [Disclaimer](#disclaimer--warranty)) to
sign FT transfers.

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

Two distinct output shapes appear in FT transactions; do not confuse them:

| Shape | Where it appears | Spendable? |
|---|---|---|
| **V1 dMint contract UTXO** (6 state pushes + 145-byte code section from `bd`; 241 B for GLYPH, 238 B for PXD — size varies with the deploy's params) | `vout[0]` of every mint tx (recreated each mint), and `vout[0..N-1]` of a V1 dMint deploy reveal (one per parallel contract slot) | Only by a valid PoW-bearing mint input. Not a wallet-spendable shape. |
| **75-byte FT holder** | `vout[1+]` of every mint tx; every output of a plain FT transfer | Spendable with the holder's P2PKH key. |

A plain FT *transfer* (one user sending FT to another) has **no** dMint
contract output — only 75-byte holder outputs. A dMint contract output at
`vout[0]` is a signal that the transaction is a **dMint mint** (or a deploy
reveal), not a plain transfer. See the [Decentralized Mint (dMint)](#decentralized-mint-dmint)
section for the contract layout.

Wallets must skip dMint contract outputs — attempting to spend
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
19 classifier vectors (7 from real mainnet txs, 12 synthetic negatives;
derived from a 2,309-sample, 6-token, 500-block scan) in [`radiant-ledger-app/view-only-ui/fixtures/classifier-vectors.json`](https://github.com/MudwoodLabs/radiant-ledger-app/blob/d7427359f3a9a3393bf769c43a0a17c84ee1ec92/view-only-ui/fixtures/classifier-vectors.json).

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

dMint contract scripts (234–241 B on mainnet V1, longer in V2) intentionally do NOT match any of
these patterns — they correctly classify as `unknown` and should not be surfaced
to users as spendable outputs.

Reference implementation: [`classifier.mjs`](https://github.com/MudwoodLabs/radiant-ledger-app/blob/d7427359f3a9a3393bf769c43a0a17c84ee1ec92/view-only-ui/classifier.mjs) (pure ES module, 101 lines at that commit, no imports).

**dMint contract outputs** (state + the fixed 145-byte epilogue; 241 bytes for GLYPH, 234-240 bytes for other mainnet deploys) do not match any of the three patterns above
and will classify as `unknown`. This is correct for wallet display — they are not user-spendable.
However, an explorer or dMint-aware tool must NOT silently discard them. Detect them by parsing
the script as an opcode stream and looking for the first `OP_STATESEPARATOR` (`0xbd`) in opcode
position after exactly 6 state-item pushes in V1, or 10 in V2 (byte 96 for GLYPH, 93 for PXD — it
varies with push widths). A bare-byte search for `0xbd` is NOT
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
| `d4`–`d7` | `OP_REFHASHDATASUMMARY_UTXO` … `OP_REFHASHVALUESUM_OUTPUTS` | introspection (no 36-byte operand; carry no token) — denied conservatively |
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

Canonical pyrxd implementation: `src/pyrxd/glyph/dmint/chain.py`
`is_token_bearing_script` and its load-bearing call
site in `find_dmint_funding_utxo` (pyrxd 6207b5b8).

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

### Constructing Covenants: Avoid Phantom Refs in Embedded Bytecode

The opcode-position rule above has a **producer-side mirror** that bites
covenant authors, not just wallet classifiers. The same linear
byte-walk that *your* classifier must avoid is exactly how **consensus
itself** scans every output's `scriptPubKey` for ref opcodes. If you
build a covenant that embeds token-script bytes as raw comparison data,
consensus can mis-read one of those payload bytes as a real ref opcode —
manufacturing a **phantom ref** that breaks conservation and gets your
transaction rejected.

**Where consensus scans.** Radiant Core's induction-rule parser
(`ReferenceParser::validateTransactionReferenceOperations`,
`src/validation.h`; `CScript::GetPushRefs`, `src/script/script.cpp`)
walks each output script from start to end, looking for the ref-family
opcodes (`0xd0`–`0xd3`, `0xd8`). When it lands on one **in opcode
position**, it consumes the **next 36 bytes** as the ref operand. It
skips pushdata operands (after `0x01`–`0x4b`, `0x4c`/`0x4d`/`0x4e`) but
is otherwise purely syntactic — it does not understand your covenant's
intent. The conservation rule then requires every ref found in an output
to also appear in some input; a ref that appears nowhere in the inputs
fails:

```
bad-txns-inputs-outputs-invalid-transaction-reference-operations-mempool
```

**The trap.** Covenants commonly verify a settlement output by comparing
it against an expected script — e.g. building the expected FT holder
bytecode and checking it with `OP_OUTPUTBYTECODE ... OP_EQUAL`. If that
expected bytecode is embedded as **raw script bytes** (not behind a
pushdata), it contains the FT epilogue `…dec0e9aa76e378e4a269e69d` and
its `0xd0`/`0xd8` ref markers as literal bytes. A stray `0xd8` or `0xd0`
byte inside that embedded region — landing on a position the parser
reaches as an opcode — gets read as a real `OP_PUSHINPUTREFSINGLETON` /
`OP_PUSHINPUTREF`, and the 36 bytes after it become a **phantom ref**
that exists in no input. Consensus rejects, even though every *intended*
ref is conserved correctly.

This is not hypothetical: a ref-bearing swap-covenant spike hit exactly
this. Its single legitimate `OP_PUSHINPUTREF <REF>` at offset 0 was fine,
but a `0xd8` byte deep inside an embedded `OP_OUTPUTBYTECODE` comparison
template was parsed as a singleton ref, and `testmempoolaccept` on
mainnet returned the reject string above. The diagnosis only became
clear after walking the script the same way `GetPushRefs` does.

**Fixes, in order of preference:**

1. **Push-wrap the embedded bytecode.** Emit the expected-script template
   behind a pushdata (`0x01`–`0x4e`) so consensus skips every byte of it,
   exactly as the classifier walker does. No `0xd0`/`0xd8` byte inside a
   pushdata operand is ever read as an opcode. This is the surgical fix —
   the pyrxd dMint epilogue uses it (e.g. `01 d0`, `01 d8`: each ref-range
   byte is pushed as 1-byte data, never executed).
2. **Compare a hash instead of the bytes.** Where introspection allows,
   verify `OP_OUTPUTBYTECODE OP_HASH256 <expected_hash> OP_EQUAL` so the
   raw token bytes never appear in your covenant at all.
3. **Re-examine the shape.** If neither works, reconsider whether the
   settlement output must be epilogue-shaped inside the covenant.

**Verification step you must run before broadcasting.** Walk your
finished covenant `scriptPubKey` with the opcode-aware walker above and
collect every ref-opcode operand it finds. The set must contain
**exactly** the refs you intend (and every one must trace to an input).
If the walk surfaces a ref you didn't author, you have a phantom ref —
fix the encoding, don't broadcast. A bare-byte search for `0xd0`/`0xd8`
will *under*-count here (it can't tell payload from opcode), so use the
position-aware walk, not a substring scan.

**A second, independent gate: an FT cannot be *held* in a foreign covenant at
all.** Suppose you eliminate the phantom ref and still try to move an FT into a
covenant output — it fails a *different* rule, the FT's own conservation
epilogue. The `e3`/`e4` `OP_CODESCRIPTHASHVALUESUM` opcodes (see [FT Holder
Template](#ft-holder-template-75-bytes) above) sum photons only across
inputs/outputs whose **`codeScript` hash matches the FT's**. An FT can
therefore only flow to an output carrying its *exact* code-script. A foreign
covenant script hashes differently, so if the covenant output carries the FT's
ref, the epilogue's ref-output count (`de`) no longer equals its code-script
output count (`e6`) and the spend fails with:

```
mandatory-script-verify-flag-failed (Script failed an OP_NUMEQUALVERIFY operation)
```

If the covenant output does not carry the ref at all, the spend is **valid**
and the FT is silently burned (a zero output-side sum still passes the `a2`
≥ check).

The two gates surface **in sequence** — fix the phantom ref and this one
appears next, which looks like a regression if you only knew about the first.

**The way through** rests on one fact: `codeScriptHash` is computed over the
bytes **from the byte immediately after `OP_STATESEPARATOR` (`0xbd`) onward** —
the separator byte itself and the prologue before it are both excluded
(`script_execution_context.h`; the parser advances past the `0xbd` before
marking the boundary). So a covenant can *replace the FT's
P2PKH prologue with covenant logic* while keeping the `bd d0 <ref>
dec0e9aa76e378e4a269e69d` epilogue intact: a covenant-prologue FT input and a
standard-P2PKH FT output share the **same** `codeScriptHash` and conserve
together. The covenant gates the FT's *spend path*; it never *holds* the FT in
a foreign script. Two rules make this work:

- The prologue must contain **no bare `0xbd` in opcode position** (push-wrapped
  hash bytes are fine). The consensus ref-parser latches the *first*
  `OP_STATESEPARATOR` and rejects a script with a second one outright, so a
  stray `0xbd` in the prologue doesn't merely shift the boundary — it fails the
  transaction.
- The settlement output is pinned by **hash-compare** against the exact FT
  code-script (`hash256(outputs[0].lockingBytecode) == EXPECTED_FT_HASH`),
  never by embedding the FT bytes raw (the Layer-1 guard above).

This is the FT mirror of the NFT case in [NFT Conservation Has No Consensus
"Exactly One" Rule](#nft-conservation-has-no-consensus-exactly-one-rule) above:
an NFT *can* be held in a covenant (welded only to its ref), an FT *cannot*
(welded to its code-script) — so you gate its spend instead. (Source:
`interpreter.cpp` `getCodeScriptHashValueSumOutputs`; `script_execution_context.h`
`codeScriptHash` boundary.)

### Constructing an FT Holder Output (Sending)

When building a transfer, **do not try to derive** the 36-byte ref from the
holder's address or pubkeyhash — the ref identifies the *token*, not the
*holder*, and it is only discoverable by reading an existing FT UTXO of
that token from the chain.

That 36-byte ref is the token's **genesis outpoint** — the FT-commit/mint
origin (`commit_txid_reversed + commit_vout_LE`). It is identical in *every*
holder UTXO of the token and **constant across every transfer**. It is **not**
the reveal txid, and **not** the txid of the UTXO you are currently reading.
Copy the ref bytes verbatim from an existing holder UTXO; never recompute them
from the current UTXO's txid — the same trap the [Container and Author
Refs](#container-and-author-refs) section warns about for NFT refs. (For a
dMint-minted FT, the genesis ref is the deploy commit's `:0` outpoint, shared
by every contract and every mint reward of that token.)

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
> mint flow, see the FT Holder Template above and the pyrxd `build_dmint_mint_tx`
> reference implementation (`pyrxd.glyph.dmint`).

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

There are two on-chain layouts for dMint contracts, and **both are live on
mainnet**. V1 is the original layout (the GLYPH deploy and every other
contract decoded in this section). V2 contracts have been on mainnet since at
least block 438,356 (deploy `95335028ee31e655c7fada44c6571c3e31552dc15573a250d6f06b64bb16fb09`)
and are mined: for example, mint `a2f186c38d8defff53341059d23136d41a1bd8e9c7593fb1e413e1b3fc2e531b`
(block 439,061) spends a 601-byte, 10-state-item BLAKE3/ASERT contract.

The current V2 shape is the 2026-05-26 redesign (see the
`DmintContractVersion` comment in Photonic's `packages/lib/src/script.ts` at
`becf41a731e7`): 10 state items with minimal-length pushes, and a
difficulty-adjustment algorithm (DAA) that the covenant evaluates on chain.
Photonic's comment notes that V2 deploys made before that redesign were test
tokens and do not parse under the new shape.

| | V1 | V2 |
|---|---|---|
| State items | 6 (height, contractRef, tokenRef, maxHeight, reward, target) | 10 (height, contractRef, tokenRef, maxHeight, reward, algoId, daaMode, targetTime, lastTime, target), minimal-length pushes |
| State size | 96 bytes for GLYPH (varies with push widths; 93 for PXD) | varies |
| Code section (from `bd`) | 145-byte template, byte-identical across the V1 contracts decoded here | deploy-parameterised (embeds the deploy's own refs and parameters) |
| Total | 241 bytes for GLYPH (state + 145; 234–241 B observed on mainnet) | varies (380 B for `95335028…`, 601 B for the contract `a2f186c3…` spends) |
| Algorithm | PoW hash opcode at offset 19 of the code section, counting `bd` as 0 (`0xaa`=SHA256D, `0xee`=BLAKE3, `0xef`=K12). Both mainnet V1 contracts decoded here (GLYPH, PXD) carry `aa`; pyrxd builds V1 with SHA256d only. | `algoId` state item (`0x00`=SHA256D, `0x01`=BLAKE3, `0x02`=K12) **plus** the matching hash opcode (`aa`/`ee`/`ef`) in the code section — the state value and the opcode are different encodings |
| DAA | none (fixed target) | `daaMode` state item (fixed, ASERT or LWMA); the covenant computes the next target on chain |
| CBOR | `p: [1, 4]`, no `v` field, no `dmint` map | `p: [1, 4]`, `v: 2`, parameters in a `dmint: {...}` map (Photonic) |
| Mint scriptSig nonce width | not checked by the covenant (it only concatenates the nonce). pyrxd's V1 builder pushes 4 bytes (72-byte scriptSig); V1 mints with 8-byte nonces are also on chain (e.g. `b1a7c712a17c2173d7caaf532509a10fe40aa3c265928be48ebdd2ac72165415`) | not checked by the covenant. Glyph-miner chooses by algorithm (4 bytes for SHA256D, 8 for BLAKE3/K12); pyrxd chooses by version (8 for V2) |
| Mint tx `nLockTime` | not used | must equal the `lastTime` written into the recreated contract (the covenant reads `OP_TXLOCKTIME`) |
| Mint reward output (vout[1]) | **75-byte FT-wrapped** (P2PKH prologue + `bd` + `d0 <tokenRef>` + `dec0e9aa76e378e4a269e69d`) | same 75-byte FT-wrapped output, same 12-byte fingerprint |
| Output-validation epilogue (covenant bytecode) | 107-byte block enforcing the vout[1] reward shape (in pyrxd: the tail of `_V1_EPILOGUE_SUFFIX`, bytes 18..124) | **shares its first 56 bytes (the FT-reward check) with V1**; the continuation and final-mint branches differ — canonical V2 (Photonic `buildV2PartC`, pyrxd `_build_part_c`) rebuilds the next state, taking `lastTime` from `OP_TXLOCKTIME` and the target from the DAA |

The V1/V2 split is in the **contract script**, not the CBOR `p` array: both
versions carry `p: [1, 4]`. Do not assume a V1 parser handles a V2 deploy, or
the reverse; detect the version by counting state pushes before `bd`.

The canonical V1 reference is the GLYPH (Glyph Protocol) deploy at:

- Commit: `a443d9df469692306f7a2566536b19ed7909d8bf264f5a01f5a9b171c7c3878b` (h=228,604)
- Reveal: `b965b32dba8628c339bc39a3369d0c46d645a77828aeb941904c77323bb99dd6` (h=228,604)
- Params: 32 parallel contracts, max_height=625,000, reward=50,000 sats per mint, target=`0x00da740da740da74`, SHA256D, no DAA. Total supply = 32 × 625,000 × 50,000 = 1,000,000,000,000 sats = 10,000 GLYPH @ 8 decimals.

Photonic Wallet (`Radiant-Core/Photonic-Wallet`, commit `becf41a731e7`)
emits the V2 10-state-item layout **only** (`dMintScript()` in
`packages/lib/src/script.ts`). A builder that needs V1 must implement it
explicitly or borrow a V1 reference implementation (e.g. pyrxd's
`build_dmint_v1_contract_script` in `src/pyrxd/glyph/dmint/builders.py`).

### V1 contract UTXO byte layout (GLYPH example: 241 B = state[96] + code[145])

Decoded byte-by-byte against GLYPH reveal vout 0 and the seven sampled
mainnet contract UTXOs (every byte from offset 79 onward is bit-identical
across all 32 contracts of a single deploy). **These offsets are GLYPH's.**
Other V1 deploys use minimal-length pushes for `maxHeight`, `reward` and
`target` and run 234–241 B (PXD `c9fdcd34…` vout 0 is 238 B, with
`bd` at byte 93). **Parse the pushes; never hard-code offsets.** What does
hold across the V1 contracts decoded here: they start `04 <height:4>`, so
byte 5 is the `d8` opcode and byte 42 is the `d0` opcode, and the 145-byte
code section from `bd` is identical.

```
[ 0..  4]  04 <height:4-LE>                              4-byte LE push of current mint count
[   5   ]  d8                                            OP_PUSHINPUTREFSINGLETON
[ 6.. 41]  <contractRef:36>                              contractRef (commit_txid:i+1 LE)
[  42   ]  d0                                            OP_PUSHINPUTREF
[43.. 78]  <tokenRef:36>                                 tokenRef (commit_txid:0 LE)  — shared across all N contracts
[79.. 82]  03 <maxHeight:3-LE>                           supply cap (max mints per contract)       — GLYPH widths
[83.. 86]  03 <reward:3-LE>                              sats per successful mint                  — GLYPH widths
[87.. 95]  08 <target:8-LE>                              difficulty target                         — GLYPH widths
[96..240]  bd <144 bytes>                                145-byte V1 code section from OP_STATESEPARATOR
                                                         (PoW hash opcode at offset 19, counting bd as 0)
```

`contractRef[i]` is the LE-reversed 32-byte txid of the deploy commit
followed by a 4-byte LE `vout` index `i+1` for the i-th of N parallel
contracts. `tokenRef` is always `commit_txid:0` (the FT-commit hashlock
outpoint), shared by every mint and every contract.

The 12-byte fingerprint `de c0 e9 aa 76 e3 78 e4 a2 69 e6 9d` appears
both inside the V1 contract code and as the suffix of every 75-byte
FT holder output (it is the tail of the `d0 <tokenRef> …` code-script whose
hash links a mint reward to its token). It is the cheapest substring to
detect a "Glyph FT-related output" by, but **do not classify scripts by
byte-substring scan alone** — see "Opcode-aware classification" above.

### dMint deploy: commit-tx output shape

A V1 dMint deploy commit has **N+3 outputs** (where N = num_contracts):

| vout | bytes | role |
|---|---|---|
| 0 | 75 | FT-commit hashlock (Photonic `ftCommitScript`, `OP_HASH256` + payload-hash + "gly" check + `OP_1 OP_NUMEQUALVERIFY` + P2PKH; longer if a delegate ref is included) |
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
| N+1 | `commit:N+1` (NFT-commit hashlock) | scriptSig carries an NFT body (in GLYPH, a link payload `p: [2], loc: 0, by: [...]`) |
| N+2 | prior auth-NFT singleton (forward-prior only) | plain `<sig> <pubkey>` |
| N+2 or N+3 | `commit:N+2` (change) | funds the (potentially large) reveal fee |

Outputs (N+3):

| vout | bytes | role |
|---|---|---|
| 0..N-1 | contract size (241 each for GLYPH) | N V1 dMint contract UTXOs, each at 1 photon |
| N | 63 | FT NFT singleton (`d8 <commit:N+1-LE> 75 <P2PKH-25>`) — the token's on-chain identity, pointing back to the NFT-commit hashlock outpoint |
| N+1 | 63 | Auth NFT singleton |
| N+2 | 25 | change P2PKH |

Two production decisions are open to a builder:

1. **Auth NFT strategy.** Either mint fresh inside the same reveal
   (simpler, self-contained) or "forward-prior" by spending an existing
   singleton in an additional input (the GLYPH deploy does the latter: its
   vin 34 spends `6de766d7…f6ed:12`; it requires the deployer to already hold
   that NFT). pyrxd's V1 deploy builder omits the auth NFT entirely and lists
   it as deferred work.
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
| GLYPH (mint msg `snk [r2w]`) | `146a4d688ba3fc1ea9588e406cc6104be2c9321738ea093d6db8e1b83581af3c` | block 422,865 (2026-04-23); documented in `pyrxd/docs/dmint-research-mainnet.md` §4 |
| PXD | `c9fdcd3488f3e396bec3ce0b766bb8070963e7e75bb513b8820b6663e469e530` | 2026-05-12 UTC; independent confirmation at a different timestamp, same I/O shape, same 72-byte mint scriptSig layout. Deploy reveal: `8eeb333943771991c2752abc78038365ecd76b1a24426f7a3212eea71b6a6564`. |

#### Inputs

| vin | spends | role |
|---|---|---|
| 0 | the previous contract UTXO | scriptSig carries the mint solution — see scriptSig layout below |
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
| 0 | same as the spent contract (241 for GLYPH, 238 for PXD) | 1 photon (singleton — must equal previous contract value) | recreated contract; **only byte that differs from previous contract** is the 4-byte LE `height` at offset 1..4 (incremented by 1) |
| 1 | 75 | `reward` photons (from the contract's state, e.g. 50,000) | FT-wrapped reward to the miner: `OP_DUP OP_HASH160 <miner_pkh> OP_EQUALVERIFY OP_CHECKSIG` `bd` `d0 <tokenRef>` `dec0e9aa76e378e4a269e69d` |
| 2 | varies | 0 | OP_RETURN per-mint marker (Photonic-Wallet convention): `6a 03 6d7367 <push-len> <msg-bytes>` — `6d7367` is the ASCII bytes for `"msg"` |
| 3 | 25 | change | plain P2PKH back to the miner |

The reward output (vout[1]) is **not** a plain P2PKH. The V1 covenant
enforces an FT-wrapped reward via `OP_CODESCRIPTHASHVALUESUM_OUTPUTS
OP_NUMEQUALVERIFY`; emitting a bare P2PKH at vout[1] produces a
`mandatory-script-verify-flag-failed` rejection. The reward's code-script
(`d0 <tokenRef> dec0e9aa76e378e4a269e69d`) is what the covenant hashes to
tie the reward back to the token.

**This same vout[1] output shape applies to V2 mints.** The 75-byte
FT-wrapped reward with the `dec0e9aa76e378e4a269e69d` codescript-hash
fingerprint is required by both V1 and V2 covenants. The V2 mint tx is
otherwise **not** a V1 mint with a wider nonce: canonical V2 (Photonic
`buildV2PartC`, pyrxd `_build_part_c`) rebuilds the recreated contract's
state, taking `lastTime` from the tx's `nLockTime` and the new target from
the DAA, so the recreated contract output and `nLockTime` must match what the
covenant reconstructs. Any V2 implementation that emits a plain 25-byte P2PKH
at vout[1] will be rejected by the covenant just as a V1 one would.

The OP_RETURN at vout[2] is convention, not consensus — different
deployers use different `msg` payloads. The push prefix is always
`6a 03 6d7367` ("OP_RETURN PUSH(3) 'msg'") followed by a length-prefixed
message bytes.

#### Mint scriptSig layout (vin[0]) — 72 bytes with a 4-byte nonce

```
<0x04> <nonce:4-LE> <0x20> <inputHash:32> <0x20> <outputHash:32> <0x00>
```

That is:

- `0x04` — direct PUSH of 4 bytes (the nonce width in both anchors above; the
  covenant does not check the width, and `<0x08> <nonce:8>` — a 76-byte
  scriptSig — is equally valid)
- `nonce` — the value the miner found via Proof-of-Work
- `0x20` — direct PUSH of 32 bytes
- `inputHash` — `SHA256d(vin[1].locking_script)`, i.e. the double-SHA256 of the funding input's locking script
- `0x20` — direct PUSH of 32 bytes
- `outputHash` — `SHA256d(vout[2].locking_script)`, i.e. the double-SHA256 of the OP_RETURN message script
- `0x00` — `OP_0`, the output index of the recreated contract (vout 0); the covenant reads it to locate the continuation output

Total length with a 4-byte nonce: 1+4+1+32+1+32+1 = **72 bytes**. Verified
against mainnet mint `146a4d68…f3c` vin[0] and mint `c9fdcd34…e530` vin[0].

#### PoW preimage layout (V1)

The miner hashes a 64-byte preimage plus the nonce to find a
solution. The preimage halves are constructed as:

```
preimage[ 0..32] = SHA256(outpointTxHash || contractRef)
preimage[32..64] = SHA256( SHA256d(input_script) || SHA256d(output_script) )
PoW_hash         = SHA256d(preimage || nonce)         # nonce exactly as pushed in the scriptSig
```

Where:

- `outpointTxHash` is the 32-byte txid (internal/little-endian order) of the previous mint tx (the one whose vout[0] this mint is spending — i.e. the contract UTXO's source txid)
- `contractRef` is the 36-byte contract ref from the spent UTXO's state (bytes 6..41 inclusive — byte 5 is the `d8` opcode)
- `input_script` is `vin[1].locking_script` (the funding input)
- `output_script` is `vout[2].locking_script` (the OP_RETURN message)

The covenant rebuilds the second SHA256 from the `inputHash` and
`outputHash` pushed in the mint scriptSig, then re-hashes the assembled
preimage with the pushed nonce to confirm `PoW_hash < target`. If the
scriptSig pushes diverge from what the miner actually hashed, the
covenant rejects after a successful mine — see
`docs/solutions/logic-errors/dmint-v1-mint-scriptsig-divergence.md` in
pyrxd for the prior incident.

#### pyrxd builder API for V1 mint mechanics

The reference implementation in pyrxd (the `pyrxd.glyph.dmint` package;
these helpers live in `src/pyrxd/glyph/dmint/miner.py`) exposes the moving
parts as:

```python
from pyrxd.glyph.dmint import build_pow_preimage, build_mint_scriptsig

pow = build_pow_preimage(
    txid_le=prev_mint_txid_le,        # 32 bytes, internal/little-endian
    contract_ref_bytes=contract_ref,  # 36 bytes (state bytes 6..41)
    input_script=funding_utxo_script, # vin[1] locking script
    output_script=op_return_script,   # vout[2] OP_RETURN message
)
# pow is PowPreimageResult(preimage, input_hash, output_hash)
# - mine over pow.preimage to find a nonce hitting the target
# - then build the scriptSig from the SAME hashes:
scriptsig = build_mint_scriptsig(
    nonce, pow.input_hash, pow.output_hash,
    nonce_width=4,                    # pyrxd's V1 builder uses 4; neither covenant checks the width (V1 mints with 8 are on chain)
)
```

Returning the preimage and the two hashes from a single helper is
deliberate: independently recomputing them on the scriptSig-build side
is the failure mode that produced the M1 covenant-rejection bug. Treat
`PowPreimageResult` as the single source of truth for both the mining
and signing paths. For a whole mint transaction (V1 or V2), pyrxd's
entry point is `build_dmint_mint_tx`.

### dMint CBOR token body (revealed in vin[0])

For a V1 dMint deploy:

```python
{
  "p":      [1, 4],                              # MUST: dMint FT — both 1 (FT) and 4 (DMINT)
  "ticker": "GLYPH",                             # SHOULD: short token symbol
  "name":   "Glyph Protocol",                    # SHOULD: display name
  "desc":   "The first of its kind",             # SHOULD: prose description
  "by":     [CBORTag(64, <36-byte NFT ref>)],    # SHOULD: deployer/owner NFT ref (provenance)
  "main":   {"t": "image/png", "b": CBORTag(64, <PNG bytes>)},   # SHOULD: token logo
}
```

Three V1-specific rules:

- **`p: [1, 4]` is required.** Both 1 (FT) and 4 (DMINT) must be present (V2 uses the same `p`).
- **No `v` field.** Photonic's V2 deploys emit `v: 2`; the GLYPH V1 deploy has no `v`.
- **dMint params live in the contract scripts, not the CBOR.** Do **not**
  embed a `dmint: {numContracts, reward, maxHeight, target, ...}` sub-dict
  in V1 (Photonic's V2 deploys do carry one). The contract UTXOs are the
  authoritative source.

The full CBOR body can be very large (65,569 bytes for GLYPH, including a
65,430-byte PNG). Above 65,535 bytes the push must use **`OP_PUSHDATA4`**
(`0x4e`) rather than `OP_PUSHDATA1` (`0x4c`) or `OP_PUSHDATA2` (`0x4d`):

```
<sig> <pubkey> "gly" 4e <length:4-LE> <CBOR-map>
```

Builders that hardcode `OP_PUSHDATA1` will silently truncate any CBOR
body over 255 bytes and produce a tx that fails consensus on its hash
check. Use length-aware push selection.

### Where dMint params live

V1 locations, with GLYPH's offsets as the worked example. Push widths vary
per deploy, so a decoder must walk the state pushes rather than slice fixed
offsets.

| Parameter | Authoritative location | Notes |
|---|---|---|
| `num_contracts` | Count of dMint contract outputs in the deploy reveal | Not in CBOR |
| `max_height` | 4th state push (GLYPH: bytes 80..82, 3-byte LE) | Per-contract |
| `reward` (sats) | 5th state push (GLYPH: bytes 84..86, 3-byte LE) | Per-mint payout |
| `target` | 6th state push (GLYPH: bytes 88..95, 8-byte LE) | V1 = fixed, no DAA |
| `algorithm` | PoW hash opcode at offset 19 of the 145-byte code section, counting `bd` as 0: `0xaa`=SHA256D, `0xee`=BLAKE3, `0xef`=K12 | Hardcoded per-deploy |
| `tokenRef` | 36 bytes after the `d0` (bytes 43..78 when the height push is `04 <4 bytes>`, as in GLYPH and PXD) | Shared across all N |
| `contractRef[i]` | 36 bytes after the `d8` (bytes 6..41 when the height push is `04 <4 bytes>`) | Differs per slot |
| `current_height` | 1st state push (GLYPH: bytes 1..4, 4-byte LE) | Increments by 1 each mint |

### Photonic Wallet divergences (V1 dMint)

The Photonic Wallet reference implementation
(`Radiant-Core/Photonic-Wallet`, commit `becf41a731e7`) is the
canonical TypeScript source for Glyph primitives, but it builds V2
dMint only. Where it differs from the V1 deploys on chain:

| # | Photonic (`becf41a731e7`) | V1 deploys on mainnet | Implication |
|---|---|---|---|
| 1 | `dMintScript()` emits the V2 10-state-item layout | V1 contracts use the 6-state-item layout (mainnet also has V2 contracts) | A V1-only builder or parser misses V2 deploys, and a V2-only parser misses V1 |
| 2 | Supports optional `premine: number` | GLYPH deploy uses no premine | Not blocking; defer |
| 3 | Supports `delegateRef` commit prefix | GLYPH deploy uses no delegate-ref | Not blocking; defer |
| 4 | `algorithm` and `daaMode` params (V2) | V1 contracts have no DAA; the two decoded here (GLYPH, PXD) use SHA256D | pyrxd's V1 builder supports SHA256d only |
| 5 | CBOR `v: 2, p: [1, 4]` plus a `dmint: {...}` map | CBOR `p: [1, 4]`, no `v`, no `dmint` (GLYPH) | Same `p`; tell V1 from V2 by the contract script, not the CBOR |

For V1 dMint deploys, use either a hand-rolled implementation or a
V1-aware reference (e.g. pyrxd's `prepare_dmint_deploy` in
`src/pyrxd/glyph/builder.py` with `DmintV1DeployParams`, which calls
`build_dmint_v1_contract_script` from `src/pyrxd/glyph/dmint/builders.py`).

### Finding the deploy reveal from a commit txid (scripthash-history gotcha)

ElectrumX's `blockchain.scripthash.get_history` returns **all** txs
that ever touched a given scripthash, not just the unique commit+reveal
pair. The 75-byte Glyph FT-commit hashlock script is deterministic
given `(payload_hash, owner_pkh)` (plus the OP_1/OP_2 ref-type byte that
separates FT from NFT commits, and the delegate ref if any), so any deployer
who commits the same body with the same key twice — a retry after a failed
broadcast, or, as in GLYPH's history, an earlier complete deploy — emits a
second tx whose vout 0 hashes to the **same scripthash** as the first. The indexer returns both. The real GLYPH deploy's hashlock
scripthash has 4 history entries:

```
228398  d171b184…1597   ← earlier 10-contract deploy commit (same hashlock script bytes)
228398  6de766d7…f6ed   ← its reveal (spends d171b184:0–12)
228604  a443d9df…878b   ← the real deploy commit
228604  b965b32d…9dd6   ← the real deploy reveal
```

A "first non-commit entry" heuristic picks `d171b184…1597`, which is
another commit (two 75-byte hashlocks plus P2PKH outputs) and has no V1 contract
outputs.

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
`_find_v1_contract_utxos_walk` in `pyrxd.glyph.dmint.chain`
(`src/pyrxd/glyph/dmint/chain.py`, pyrxd 6207b5b8). The same principle —
scripthash queries are coarse; you must filter by outpoint — applies to
any "find the spending tx" pattern over scripthash history.

#### Known gotchas

See also: [§16 Common Errors](#common-errors--solutions) and
[§7 — Wallet Classifier Patterns](#wallet-classifier-patterns).

1. **V1 contract outputs classify as `unknown` in V2-only parsers.** The on-chain V1 contract
   script has 6 state items before `OP_STATESEPARATOR` (`0xbd`), not 10. Any parser that expects
   10 state pushes (the V2 layout) will fail at item 6 and discard the output. A correct parser
   tries V2 first, falls back to V1, and signals which version was matched. (See protocol-review
   for details; compound doc: `dmint-v1-classifier-gap.md`.)

2. **Mint reward output is NOT a plain P2PKH (V1 and V2 both).** The covenant requires a 75-byte
   FT-wrapped reward output (`P2PKH prologue + OP_STATESEPARATOR + OP_PUSHINPUTREF tokenRef +
   12-byte epilogue`). Plain P2PKH reward outputs will be rejected by the covenant. This applies
   to V1 mints (mainnet-verified against `146a4d68…f3c`) and to V2 mints (the FT-reward check is
   shared between V1 and V2 contracts). The contract output value must stay
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
   hash and owner PKH were used in an earlier commit, ElectrumX `get_history` for that
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
                                      // 2=NFT, [1]=FT, [1,4]=dMint FT (V1: no `v`,
                                      // no `dmint` map; V2: `v: 2` plus a `dmint`
                                      // map), [2,7]=NFT-container, etc. Wallets
                                      // reject the whole payload if absent.
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
    loc: "ipfs://...",                // OPTIONAL (guide convention; the Glyph spec
                                      //   reserves `loc` for link tokens). Full-res
                                      //   location. Must be a valid CIDv0 (46 char
                                      //   Qm...) or sha2-256 CIDv1 (59 char
                                      //   bafybei... or bafkrei...). Truncated CIDs
                                      //   mint permanently broken NFTs.
    loc_hash: "sha256:..."            // OPTIONAL (pyrxd convention; Photonic and
                                      //   RXinDexer do not read it). An ipfs://
                                      //   CID is already content-addressed; add a
                                      //   hash only when `loc` is a mutable URL
                                      //   (https), where whoever controls the host
                                      //   can swap the asset.
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
> - No nested maps or arrays of maps in *your own* app attrs — flatten before
>   encoding. (Decoders must still accept protocol-defined nested attrs such as
>   WAVE `attrs.records` and authority `attrs.permissions`.)
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
| 4 | Decentralized Mint (dMint) | `[1, 4]` | Combined with FT. In V1, dMint parameters (num_contracts, max_height, reward, target, algorithm) live in the contract output scripts, NOT in the CBOR; V2 deploys also carry a `dmint: {...}` map — see §[Decentralized Mint (dMint)](#decentralized-mint-dmint). The PoW hash is named by a byte in the contract code: `0xaa`=SHA256D, `0xee`=BLAKE3, `0xef`=K12 (in V1, at offset 19 of the code section; the V1 contracts decoded in this guide carry `aa`). V2 also records it as an `algoId` state item (`0`/`1`/`2`). |
| 5 | Mutable (MUT) | `[2, 5]` | Requires NFT (2). |
| 6 | Explicit Burn | `[1, 6]` / `[2, 6]` | Action marker; must accompany FT or NFT. |
| 7 | Container / Collection | `[2, 7]` | Requires NFT (2). Parent-only; children reference via `in` field. |
| 8 | Encrypted Content | `[2, 8]` | Payload encrypted client-side (XChaCha20-Poly1305); the decryption key is released later. Requires an NFT base type. Pairs with `[9]`. |
| 9 | Timelocked Reveal | `[2, 8, 9]` | Encrypted payload gated until `unlock_at` (block height or unix time). The minter commits `sha256(CEK)` + `unlock_at` on-chain and holds the content key off-chain; after unlock, an `OP_RETURN` reveal tx publishes the CEK and wallets verify `sha256(cek) == commitment` then decrypt. The token stays freely transferable throughout — only payload *visibility* is gated. Requires `[8]`. (REP-3009.) |
| 10 | Issuer Authority | `[2, 10]` | Requires NFT (2). |
| 11 | WAVE Naming System | `[2, 5, 11]` | On-chain DNS-like naming. Canonical CBOR carries the name in **`attrs.name`** (plus `domain`/`target`/`target_type`); a top-level `name` field still decodes but is **not** indexed by RXinDexer. |

**Note on `p` array combinations:** `p: [1, 4]` means "this is a Fungible Token deployed
via dMint." Combinations like `[2, 7]` (NFT that is also a container) are valid. The first
element is the primary type; subsequent elements are modifiers. `p: [4]` alone (dMint
without an FT or NFT base type) has not been observed on mainnet — all known dMint
deployments use `[1, 4]` (FT + dMint). For the full commit/reveal structure of a V1 `[1, 4]`
deploy, see [§8 — Decentralized Mint (dMint)](#decentralized-mint-dmint).

**V1 and V2 deploys share `p: [1, 4]`.** V1 deploys carry no `v` field and
no `dmint: {...}` sub-dict; Photonic's V2 deploys add `v: 2` and a `dmint`
map. Both versions exist on mainnet. The version that matters to miners is
set by the contract script (6 vs 10 state items), not the CBOR.

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
- Commit txid: `58584137d68cf3eb418cd38cd3bcab8a8e4a8a4150999d7e8e176d9562904913`; reveal txid: `f3f95a8aa35efffd6a3f2064e687de8a58adbd89de891b1ef3f5d291c1d65f68` (`4edad669…3b63` is a later transfer of the same NFT)
- Output script: `d813499062956d178e7e9d9950418a4a8e8aabbcd38cd38c41ebf38cd63741585800000000757...`
- **Correct ref**: `13499062956d178e7e9d9950418a4a8e8aabbcd38cd38c41ebf38cd63741585800000000` (from script)
- **Wrong ref**: `58584137d68cf3eb418cd38cd3bcab8a8e4a8a4150999d7e8e176d956290491300000000` (commit txid in display order — not byte-reversed)

Hand-computing the ref invites exactly this kind of error: here the txid
was right but its byte order was not. Reading the ref from the output
script avoids both this and the reveal-vs-commit mistake above.

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

### Resolving a Ref via RXinDexer

To go the other direction — from a 36-byte ref to the token it identifies, or
to confirm a ref is a genuine on-chain `gly` reveal rather than a
self-consistent fake singleton — wallets, explorers, and indexers query a
glyph indexer such as **RXinDexer**. Three integration facts cost real
debugging time:

1. **RXinDexer can be deployed as ElectrumX-WebSocket *or* REST-only — don't
   assume both run.** The same indexer ships a `glyph.*` ElectrumX-ws interface
   *and* a FastAPI REST API, but a given deployment may run only one. Check the
   *actual* listening services on the target host (`ss -tlnp`, `docker ps`,
   systemd units) before wiring an adapter — not the project README or a
   regtest compose file.

2. **The REST per-token route is `GET /glyphs/{ref}`.** It accepts the
   72-hex wire ref or the display `txid_vout` form. The `/tokens/{ref}/...`
   paths are analytics sub-resources (`/holders`, `/supply`, ...); there is no
   bare `/tokens/{ref}` route, so an adapter built on it gets `404` for every
   ref. A bare 64-hex txid is rejected with `422`. Look a token up by its ref —
   the **commit** outpoint — not by the reveal txid: `/glyphs/<reveal_txid>_0`
   returns `404`.

3. **Byte order.** The 72-hex key is the wire ref: internal (reversed) txid +
   4-byte little-endian vout (RXinDexer also retries a display-order txid as a
   fallback). The REST response returns both forms side by side — `ref`
   (display `txid_vout`) and `ref_hex` (internal 72-hex) — so compare against
   `ref_hex` rather than guessing. On the ElectrumX-ws interface,
   `glyph.get_token` takes `txid:vout` and returns `glyph_id`.

**Fail closed.** Treat an unknown ref (`404`) as "not a genuine glyph," and a
transient/5xx error as "cannot confirm" — in both cases refuse to treat the ref
as authentic rather than passing it. An authenticity check is only as strong as
its weakest transport.

**Trust the live endpoint over a local source checkout.** The deployed API and
a checked-out copy of the indexer can be different versions with different
field sets (e.g. `ref_hex` was added to RXinDexer on 2026-05-31). Pin your
adapter to the field the **live** API actually returns, and add a smoke check
that resolves one known-good ref and one fabricated ref before relying on the
result.

> **Testing note.** A mock indexer that returns the final *typed* object your
> code expects will hide the entire dict→object parsing layer — including a
> field-name mismatch like reading `ref_outpoint` when the real REST API
> returns `ref`/`ref_hex` (or `glyph_id` on ElectrumX-ws). Test ref resolution
> against the real indexer (or a fixture captured from it), not only against a
> fake that short-circuits the parsing.

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
or equivalent. Consensus bounds a single on-chain push only by the 12 MB
maximum transaction size, so without a cap a malicious deploy can force your
indexer/explorer/wallet to decode megabytes of attacker-shaped CBOR. The
decoder is a DoS surface for any service that fetches reveal scriptSigs.

**Pick a cap deliberately. The trade-off:**

- **64 KB and below** — fast, low memory, but rejects real on-chain
  deploys. The GLYPH (Radiant Blockchain Glyph Protocol) deploy
  reveal carries a 65,569-byte CBOR body including a PNG logo.
  Wallets capped at 64 KB cannot decode it.
- **256 KB** — too low. Photonic Wallet mints inline `main` content up to
  512 KiB (`GLYPH_INSCRIPTION_MAX_SIZE`, `mintEmbedMaxBytes`), so a 256 KB
  cap refuses tokens the reference wallet produces. pyrxd's decoder
  currently caps at 262,144 bytes (`_MAX_CBOR_PAYLOAD_BYTES`), so pyrxd
  rejects such payloads today.
- **Above the 512 KiB content limit** — recommended. The full CBOR body is
  the content plus name/description/refs and framing, so set the cap with
  headroom above 512 KiB; 640 KiB (655,360 bytes) is a reasonable value.
  Go higher only as far as your memory budget allows.

**Reference enforcement (Python):**

```python
_MAX_CBOR_PAYLOAD_BYTES = 655_360  # 640 KiB — above Photonic's 512 KiB content limit

def decode_payload(cbor_bytes: bytes):
    if len(cbor_bytes) > _MAX_CBOR_PAYLOAD_BYTES:
        raise ValidationError(
            f"CBOR payload too large: {len(cbor_bytes)} > {_MAX_CBOR_PAYLOAD_BYTES}"
        )
    return cbor2.loads(cbor_bytes)
```

Apply the cap **before** invoking the CBOR library — most CBOR
libraries will happily allocate a multi-megabyte buffer before they
know the structure of the input. Implementation reference for the
pattern (with the lower 262,144-byte value): pyrxd
`src/pyrxd/glyph/payload.py` `_MAX_CBOR_PAYLOAD_BYTES` constant and
the size-cap precheck in its decode functions (pyrxd 6207b5b8).

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
 *   - $payloadHash MUST be exactly 64 hex chars (32-byte SHA256d(CBOR payload), i.e. SHA256(SHA256(cbor)))
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
 * $commitAmountSats must cover: reveal-tx fee + reveal NFT output value
 * (1 photon is enough). For a 1,000-byte reveal at 10,000 photons/byte that is
 * 10,000,000 photons of fee plus the NFT output value.
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
    $feeSats = 0;
    foreach ($utxos as $u) {
        $selected[] = $u;
        $totalIn += intval(round(floatval($u['amount']) * 100_000_000));
        $feeSats  = $estimateSize(count($selected)) * $feeRateSatsPerByte;
        // Change must be >= 1 photon: Radiant's dust rule rejects only value <= 0,
        // and a 0-value change output is rejected as 'dust'.
        if ($totalIn >= $commitAmountSats + $feeSats + 1) break;
    }
    if ($totalIn < $commitAmountSats + $feeSats + 1) {
        throw new RuntimeException('insufficient funds for commit tx');
    }

    // 4. Build raw tx. Output 0 = nftCommitScript, output 1 = change (P2PKH).
    $inputs = array_map(fn($u) => ['txid' => $u['txid'], 'vout' => $u['vout']], $selected);
    $changeSats = $totalIn - $commitAmountSats - $feeSats;
    $outputs = [];
    // createrawtransaction doesn't accept raw-script outputs directly in
    // Bitcoin-family RPC; use its "data" field for OP_RETURN only. For a
    // custom script output, build the serialized tx by hand.
    // buildRawTxWithCustomOutput() and buildP2pkhScript() are NOT defined in
    // this guide — you supply them (see the note after this block).
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

    // 7. Wait for confirmation. Not strictly required (a node accepts a reveal
    //    spending an in-mempool commit), but a node that has not seen the
    //    commit — e.g. a different node — rejects the reveal with
    //    "Missing inputs". Poll every few seconds.
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

The `buildRawTxWithCustomOutput` and `buildP2pkhScript` helpers are not
included in this guide. Implement a serializer (version=2, varint input
count, per-input outpoint + empty scriptSig + sequence, varint output count,
`u64_le(value)` + varint(scriptLen) + script per output, locktime=0;
P2PKH = `76a914<pkh>88ac`), or build the commit with radiantjs as in the
Signing Challenge section.

**Watch out for:**

- **Broadcast the reveal to the node that accepted the commit.** It will
  accept the reveal while the commit is still unconfirmed; a node that has
  not seen the commit answers `Missing inputs`.
- **Commit output value must cover reveal fee + reveal output.**
  Undersize and the reveal fails with `min relay fee not met`. Fix it by
  adding a plain P2PKH funding input to the reveal (the commit script does
  not restrict other inputs) — same `glyphHex`, same commit outpoint.
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
   `commitVout`, `commitAmountSats`, `commitScript` (it embeds the funding
   pubkeyhash, which may differ from the destination), `glyphHex`,
   `destPubkeyhash` and the NFT output value before broadcast — these are
   what a retry needs. Load them, rebuild
   the reveal, re-sign, and rebroadcast.
3. **Check mempool first.** Before assuming the reveal failed, run
   `getrawtransaction <revealTxid> 0` and `getmempoolentry <revealTxid>`.
   A RPC error may have dropped your client's return value while the node
   still accepted the tx. Confirm with a block explorer before paying fees
   on a duplicate.
4. **If mempool eviction is the cause**, raise the fee rate in the new
   reveal (same commit input, same glyph, higher fee → smaller change
   output) and rebroadcast. Radiant's mempool has no replace-by-fee: a
   conflicting spend of an outpoint already in the mempool is rejected
   (`txn-mempool-conflict`), so only rebroadcast after the original has been
   evicted.

The worst outcome is a commit UTXO that sits unspent indefinitely; the RXD
inside is not burned, just locked behind a script that only a correctly-
built reveal can satisfy.

### Finding the Reveal Tx on Chain (Don't Trust Scripthash History Alone)

If you're walking from a commit txid to its reveal — to recover from a
failed broadcast, to index your own NFTs, or to verify a third-party
mint — **do not pick the first non-commit entry in the commit-output's
scripthash history**. The commit hashlock script is deterministic in
`(payload_hash, owner_pkh)`; if the same CBOR body was committed
earlier by the same owner (a failed attempt, or an earlier deploy), both
commits share the identical script bytes and the identical scripthash. Indexer history
returns all of them in chronological order, not just yours.

The Glyph Protocol deploy commit's vout-0 scripthash on Radiant mainnet,
for example, has **four** history entries:

```
height  txid                                       what it is
228398  d171b184…1597   ← earlier 10-contract deploy commit (same script bytes)
228398  6de766d7…f6ed   ← reveal of the d171b184 10-contract deploy
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
const crypto = require('crypto');

// ElectrumX scripthash: sha256(scriptPubKey bytes), byte-reversed, hex.
function scriptHashOf(scriptHex) {
    return crypto.createHash('sha256')
        .update(Buffer.from(scriptHex, 'hex'))
        .digest().reverse().toString('hex');
}

async function findReveal(electrum, commitTxid, commitVout, commitOutputScript) {
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
65,569-byte CBOR body. The `'gly'` marker is followed by the CBOR-body
push, except in a DAT reveal, which pushes a second `'dat'` marker between
them (`gly`, `dat`, payload). Implementation reference:
pyrxd `src/pyrxd/glyph/inspector.py` `GlyphInspector._parse_reveal_scriptsig` (pyrxd 6207b5b8).

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
const { Script, Transaction, PrivateKey, crypto } = require('@radiant-core/radiantjs');

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

See [`radiant-ledger-guide`](https://github.com/MudwoodLabs/radiant-ledger-guide) for installation, wallet pairing, and the direct-APDU harness needed for spending Glyph UTXOs (Electron Radiant's GUI doesn't yet recognize Glyph-prefixed P2PKH as spendable — see section 6 of that guide).

First Ledger-signed Glyph UTXO spend confirmed on mainnet: [`22d4e0e07200437791b48651125a636b994593b215152241aef7113b24b71da3`](https://explorer.radiantblockchain.org/tx/22d4e0e07200437791b48651125a636b994593b215152241aef7113b24b71da3).

---

## Fee Calculations & Cost Analysis

> **V2 Fee Change (Block 415,000+):** Minimum relay fee increases 10x (1,000 to
> 10,000 photons/byte) after a 5,000-block grace period. Compute the floor from
> the block height. `estimatefee` (it takes no arguments on Radiant Core)
> returns the node's *legacy* 0.01 RXD/kB relay floor unless the mempool is
> congested, which is below the post-415,000 floor, so it is not a safe fee
> source on its own. Use it only as a signal above the floor:
> `max(estimatefee_result, minimum_relay_fee)`.

### Radiant Fee Structure

**Radiant fees are commonly quoted in photons/byte; the node itself
(`-minrelaytxfee`, `estimatefee`) works in RXD/kB, like Bitcoin:**
- Minimum relay fee: **10,000 photons/byte** (0.1 RXD/kB), in force since block 415,000
- Before block 415,000: 1,000 photons/byte (0.01 RXD/kB)
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
    $estimate = $rpc->call('estimatefee', []); // RXD/kB; takes no arguments on Radiant Core
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
quickly; plan for 0.5–2.5 RXD per NFT at post-V2 rates (the recommended 225px
WebP thumbnail alone is ~2–2.5 RXD).

**Commit-amount sizing.** The commit transaction's output value must cover the
reveal transaction's fee **plus** the NFT output value (1 photon is sufficient —
Radiant's dust limit is 1 photon and Photonic mints NFTs at 1).

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
| **web3.storage / Storacha** | Discontinued as an IPFS pinning service (storacha.network redirects to fil.one, an S3 store, as of 2026-10). Do not integrate. |
| **NFT.Storage** | Formerly free-for-NFTs; 2024 policy change migrated existing free pins to "Classic" tier with read-only access. Check current pricing before integrating. |
| **Filebase** (`s3.filebase.com`) | S3-compatible API, works with any AWS SDK. Paid, per-GB. |
| **4EVERLAND** | IPFS + Arweave in one API. Free tier available. |
| **Self-hosted Kubo node** | Full control; you pay bandwidth + disk. Easiest to lose pins if the node dies. |
| **Dedicated gateway** | Pinata, Cloudflare (Web3 gateways) and Filebase offer per-account dedicated gateways that resolve faster and aren't rate-limited. (Fleek's hosting ended 2026-01-31.) |

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
> - Validate CID length: CIDv1 with sha2-256 = 59 chars (`bafybei` or
>   `bafkrei` + 52 base32). CIDv0 = 46 chars (`Qm` + 44 base58).
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

> ⚠️  **Secrets hygiene.** Create a Pinata key **scoped to the pinning
> endpoint you use** — an Admin-key JWT has full access to every endpoint.
> Treat either like a password. Keep real secrets in a local
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
        // your dedicated gateway, e.g. '<name>.mypinata.cloud'
    ];
    if (!in_array($gateway, $allowedGateways, true)) {
        throw new RuntimeException("PINATA_GATEWAY '{$gateway}' not in allow-list");
    }

    // CRITICAL: validate the CID Pinata returned BEFORE minting it into the
    // `loc` field. A truncated or malformed CID mints permanently as an
    // unresolvable NFT (all public gateways return 400/422). Real-world bug
    // observed at FlipperHub: 58-character CIDv1 (one char short of 59) got
    // minted, leaving every NFT with that `loc` pointing at unresolvable content.
    // Matches sha2-256 CIDv1 (bafybei/bafkrei + 52 base32 chars = 59 total) and
    // CIDv0 (Qm + 44 base58 chars = 46 total). Pinata pins with sha2-256 by default,
    // so this covers the expected happy path. If you switch hash functions
    // (e.g. blake3) you will need to widen the regex.
    // Note the `D` flag: PHP's PCRE `$` matches before a trailing newline by
    // default, so without `D` a CID with a stray `\n` would pass validation
    // and be written into `loc` as a broken link. See the Wallet Classifier
    // section's cross-language regex note for the same pitfall in Python.
    $cid = $result['IpfsHash'] ?? '';
    if (!preg_match('/^((?:bafybei|bafkrei)[a-z2-7]{52}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/D', $cid)) {
        return [
            'success' => false,
            'error'   => 'Pinata returned malformed CID (expected 59-char sha2-256 CIDv1 bafybei.../bafkrei... or 46-char CIDv0 Qm...): ' . substr($cid, 0, 80)
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
# In .env — DEVELOPMENT ONLY. Only meaningful if your upload code reads it and
# sets CURLOPT_SSL_VERIFYPEER=false — uploadFileToPinata() above does not.
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
model. A real example: a Radiant SDK's complete, green V1 dMint mint-tx
builder (49 passing unit tests) produced outputs the mainnet covenant would
reject 100% of the time; it was caught before release by walking mainnet
bytes against the builder's output.

Before broadcasting any Glyph/FT/dMint transaction from new builder
code, run at least one **golden-vector** assertion: byte-equal your
builder's output against captured mainnet bytes for a known-good
transaction.

### Mainnet golden vectors

| What | Reference txid | What to compare |
|------|---------------|-----------------|
| Glyph NFT reveal — a test mint with no `main`, a wrong `in` ref and a truncated 58-char CID in `loc`; **not** a payload template | `27390efab1e3...be7e` | scriptSig push stack (`<sig> <pubkey> "gly" <CBOR>`) and the 63-byte singleton output only |
| V1 dMint deploy commit + reveal (GLYPH token) | commit `a443d9df469692306f7a2566536b19ed7909d8bf264f5a01f5a9b171c7c3878b` / reveal `b965b32dba8628c339bc39a3369d0c46d645a77828aeb941904c77323bb99dd6` | 75-byte FT-commit hashlock script; 32 × 241-byte V1 contract output scripts |
| V1 dMint mint-tx reward output (GLYPH mint, OP_RETURN msg 'snk [r2w]', block 422,865, 2026-04-23) | `146a4d68…81af3c` vout[1] (75 bytes: `76 a9 14 <miner_pkh> 88ac bd d0 <token_ref> dec0e9aa76e378e4a269e69d`) | reward-output script byte-equal |
| V1 dMint mint-tx (PXD token, 2026-05-12 UTC) | `c9fdcd3488f3e396bec3ce0b766bb8070963e7e75bb513b8820b6663e469e530` | independent timestamp confirmation: same 4-output mint shape, same 72-byte mint scriptSig, byte-equal reward-check bytecode |
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
it experimental and gate it behind an explicit opt-in flag — see [V1 vs V2
dMint deploys](#v1-vs-v2-dmint-deploys-pick-deliberately) below) or implementing a format that was never deployed
(a trap; revisit your spec source).

### Reference implementation: pyrxd's golden-vector tests

The pyrxd Python SDK ships six golden-vector test classes. Each pins one wire-format builder against
real mainnet bytes; together they cover the full Glyph protocol surface
that pyrxd builds. Reading them is the fastest way to see what a
"correct" assertion shape looks like in practice:

| What | pyrxd test class | Source |
|------|------------------|--------|
| FT locking script (75 B) | `TestFtLockingScriptMainnetGolden` | `tests/test_dmint_module.py` |
| NFT locking script (63 B) | `TestNftLockingScriptMainnetGolden` | `tests/test_glyph.py` |
| Commit-script (75 B; FT + NFT branches) | `TestCommitLockingScriptMainnetGolden` | `tests/test_glyph_dmint.py` |
| CBOR reveal payload (65,569 B w/ embedded PNG) | `TestCborPayloadMainnetGolden` | `tests/test_glyph.py` (fixture: `tests/fixtures/glyph_reveal_cbor.bin`) |
| V1 dMint contract script (241 B) | `TestV1GoldenVectorGlyphPattern` | `tests/test_dmint_v1_deploy.py` |
| V1 dMint mint-tx scriptSig + reward | `TestCovenantShape` | `tests/test_dmint_v1_mint.py` |

Mirror or cross-check against these if you're implementing the same
protocol in another language — same bytes in, same bytes out is the
strongest interop contract you can write.

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

**Cause:** Your Radiant daemon was built without wallet support — the v2.1.2
and v2.2.0 linux-x64 tarballs ship node-only (v2.1.2's separate bare
`radiantd` asset is a macOS arm64 binary).

**Fix:** Upgrade to a wallet-enabled build (v2.3.0+; v3.1.2 is current, and
v3.1.1+ is mandatory on mainnet). Verify with
`docker exec radiant-node radiant-cli -datadir=/home/radiant/.radiant listwallets`.
Remember `--no-cache` on the rebuild, and **back up `wallet.dat` first**.

#### `Cannot find module '@radiant-core/radiantjs'` (from Node)

**Cause:** radiantjs isn't installed where Node looks for it, or your code
still requires the old `@radiantblockchain/radiantjs` name.

**Fix:** Install it with `npm install --save-exact @radiant-core/radiantjs@2.0.6`
and require `'@radiant-core/radiantjs'`.

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

**Fix:** Set `rpcbind=0.0.0.0` + `rpcallowip=<your app network's CIDR>` (from
`docker network inspect`) in `radiant.conf`, bind host ports to `127.0.0.1:`,
and attach both containers to the same Docker network. See Infrastructure Setup → Networking the Node.

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
[`classifier.mjs`](https://github.com/MudwoodLabs/radiant-ledger-app/blob/d7427359f3a9a3393bf769c43a0a17c84ee1ec92/view-only-ui/classifier.mjs).

Same pattern applies to NFT singletons (63 bytes) — see the classifier table.

**Related defense:** if you're writing the wallet itself, the inverse
bug — *recognizing* an FT/NFT UTXO and then spending it as plain
funding — silently burns the token. See "Token-Burn Defense: Coin
Selection Must Reject Token-Bearing UTXOs" under the Wallet
Classifier Patterns section.

#### "Trying to spend a dMint contract output — fails at consensus"

**Cause:** The wallet classified a dMint contract script (241 B for GLYPH;
other deploys differ) as a spendable output. These are NOT wallet-owned
P2PKH outputs — they enforce mint rules and cannot be spent with a
`<sig> <pubkey>` scriptSig.

**Fix:** Ensure the classifier rejects scripts that don't match the three known
patterns (P2PKH, NFT singleton, FT holder). dMint contract scripts
correctly fall through to "unknown" in the reference classifier.

#### "NFT shows as blank card in wallet"

**Cause:** Missing `main` field with on-chain image data.

**Fix:** Add thumbnail to payload:
```javascript
payload.main = {
    t: thumbnail.type,      // Must match the bytes (Safari/iOS produce PNG, not WebP)
    b: thumbnail.bytes      // Must be Uint8Array, not base64
};
```

#### "NFT shows as 'Unknown NFT' with no metadata"

**Cause:** NFT was encoded with JSON instead of CBOR.

**Symptoms:**
- NFT appears but shows as "Unknown NFT"
- No attributes visible
- Your encoder silently fell back to JSON (some implementations log "CBOR
  library not loaded, using JSON fallback"); the guide's `encodeGlyphData`
  throws instead

**Fix:**
1. Download CBOR library (vendor a pinned version — see the supply-chain
   warning in Infrastructure Setup; do not fetch from `master` at build time
   on production systems). Example: `curl -fo js/cbor.min.js "https://raw.githubusercontent.com/paroga/cbor-js/<commit-sha>/cbor.js"` then verify with `sha256sum`.
2. Load BEFORE blockchain scripts in HTML
3. Verify: `console.log(typeof CBOR)` should output "object"
4. Mint new NFT (old one cannot be fixed)

**Related decode bugs:** if metadata decoding TypeErrors on
`main.b`, your decoder is not unwrapping CBORTag 64 — see
"Decoding `main.b`: Handle CBORTag 64". If the walker terminates
before finding the `'gly'` marker on a reveal with embedded media
(>64 KB), it's missing OP_PUSHDATA4 support — see "Push-Stack
Walker Must Handle OP_PUSHDATA4".

#### "Script failed an OP_EQUALVERIFY operation" / "Extra items left on stack after execution"

**Cause:** Using P2PKH commit instead of nftCommitScript. With the reveal's
scriptSig order (`<sig> <pubkey> <gly> <cbor>`) against a P2PKH prevout,
`OP_DUP OP_HASH160` runs on the CBOR, so the usual error is the
`OP_EQUALVERIFY` failure; the extra-items (CLEANSTACK) error appears only if
the extra pushes sit beneath sig/pubkey.

**Fix:** Pass `glyphHex` to commit transaction:
```javascript
const glyphData = encodeGlyphData(payload);
const glyphHex = Array.from(glyphData).map(b => b.toString(16).padStart(2, '0')).join('');
const commitResult = await createCommitTransaction(feeRate, glyphHex); // your backend call wrapping the PHP createCommitTransaction()
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

Regtest and testnet put the upgrade at different heights (regtest: 200,
testnet: 1,000; the 10× floor starts 5,000 blocks later, i.e. 5,200 and
6,000). Don't hardcode 415,000 there — set the floor from that chain's
upgrade height, or simply use 10,000 everywhere (overpaying a legacy chain is
harmless):

```php
$h = $rpc->call('getblockcount');
$upgradeHeight = 410000;                  // mainnet; regtest 200, testnet 1000
$minRate = ($h < $upgradeHeight + 5000) ? 1000 : 10000; // legacy floor before grace ends
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
confusion, V1 mint funding rejected) see
[Decentralized Mint → Known gotchas](#known-gotchas),
[Token-Burn Defense](#token-burn-defense-coin-selection-must-reject-token-bearing-utxos)
and [What's New in V2](#whats-new-in-v2).

---

## Complete Implementation Example

### Full Minting Flow with Thumbnail

```javascript
// Sketch: uploadToIPFS, createCommitTransaction, waitForConfirmation and
// createRevealTransaction are not defined here. They are your backend calls
// wrapping the PHP functions shown earlier (whose signatures differ).
class GlyphNFTMinter {
    async mintNFT(imageDataUrl, metadata, ownerAddress) {
        // Step 1: Create thumbnail for on-chain storage (225px @ 90% WebP)
        const thumbnail = await this.createThumbnail(imageDataUrl, 225, 0.90);
        console.log(`Thumbnail: ${thumbnail.bytes.length} bytes (${thumbnail.type})`);

        // Step 2: Upload full-res to IPFS (optional)
        const ipfsResult = await this.uploadToIPFS(imageDataUrl);
        console.log(`IPFS: ${ipfsResult.url}`);

        // Step 3: Build payload with main field
        const payload = {
            p: [2],
            name: metadata.name,
            type: metadata.type || 'photo',
            main: {
                t: thumbnail.type,  // what the browser actually encoded (PNG on Safari/iOS)
                b: thumbnail.bytes
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
            // A Glyph is identified by its commit outpoint (the ref), not the reveal.
            glyphId: `${commitResult.txid}:${commitResult.vout}`,
            ref: revealResult.ref,
            thumbnailSize: thumbnail.bytes.length,
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

                // Request WebP; Safari/iOS silently return PNG, so keep blob.type
                canvas.toBlob((blob) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve({ bytes: new Uint8Array(reader.result), type: blob.type });
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
| NFT singleton | container reveal `f3f95a8a…5f68` vout 0 (`4edad669…3b63` is a later transfer of the same NFT) |
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
console.log(`Thumbnail size: ${thumbnail.bytes.length} bytes (${thumbnail.type})`);
if (thumbnail.bytes.length > 30000) {
    console.warn('Thumbnail large - consider reducing quality or dimensions');
}
```

### Verify on Glyph Explorer

Visit: `https://radiantexplorer.com/tx/<reveal_txid>`

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

**Glyph NFT reveal (test mint: no `main`, wrong `in` ref, truncated CID in `loc`):**
- Reveal: `27390efab1e3168c05301b18f6cdfd553a6d122a41496d0f5e104e79a918be7e` —
  useful for the reveal push stack and the 63-byte singleton output, **not** as
  a payload template.

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
byte-identical to the GLYPH reveal's vout 0 after substituting your commit txid
(it appears twice, in the contract ref and the token ref) and, if they differ,
your maxHeight, reward and target — re-encoding those pushes at their minimal
width. vout 0 carries no PKH. For additional golden-vector txids covering V1 dMint mint and
classifier coverage on live RBG dMint reveals, see [Validating Your Builder
Against Mainnet](#validating-your-builder-against-mainnet).

**V1 dMint mint tx (canonical 4-output shape — byte-decoded from chain):**
- `146a4d688ba3fc1ea9588e406cc6104be2c9321738ea093d6db8e1b83581af3c` — GLYPH mint
  (OP_RETURN msg `snk [r2w]`), block 422,865. 2 inputs (contract + funding), 4 outputs (recreated
  241-byte contract + 75-byte FT reward + OP_RETURN msg marker + change).
  vin[0] is a 72-byte mint scriptSig with a 4-byte nonce
  (`<0x04 nonce(4)> <0x20 inputHash(32)> <0x20 outputHash(32)> <0x00>`).
  Full byte-decode: `pyrxd/docs/dmint-research-mainnet.md` §4.
- `c9fdcd3488f3e396bec3ce0b766bb8070963e7e75bb513b8820b6663e469e530` —
  PXD token, 2026-05-12 UTC. Independent confirmation at a different
  timestamp (block 422,865, 2026-04-23 for the GLYPH mint vs. 2026-05-12 UTC for PXD), same
  4-output shape and same 72-byte mint scriptSig layout. Used to
  verify the V1 covenant accepts pyrxd's own mint output bytes. PXD
  deploy reveal: `8eeb333943771991c2752abc78038365ecd76b1a24426f7a3212eea71b6a6564`.

Use the GLYPH mint `146a4d68…` as the primary golden vector for the V1 mint tx output
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

    // Size limit: match your CBOR decode cap (this guide recommends 640 KiB of
    // CBOR = 1,310,726 hex chars including the 3-byte "gly" marker)
    if (glyphHex.length > 1310726) {
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

    // Validate length — match your CBOR decode cap (640 KiB of CBOR + "gly")
    if (strlen($glyphHex) > 1310726) {
        throw new Exception('Glyph hex data too large');
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
if ($commitVout < 0 || $commitVout >= 1000) {
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
// A method of your minter class (it uses $this->rpc). executeRevealTransaction()
// is not defined in this guide: it is your implementation of the reveal
// build/sign/broadcast (e.g. via signRevealViaNode() above).
public function createRevealTransaction($commitTxid, $commitVout, $glyphHex, $destAddress = null) {
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
    if ($commitVout < 0 || $commitVout >= 1000) {
        throw new Exception('Invalid commit output index');
    }

    // 3. Validate glyph hex format and content
    if (!preg_match('/^676c79[a-f0-9]*$/i', $glyphHex)) {
        throw new Exception('Invalid glyph hex format (must start with "gly" marker)');
    }

    // 4. Validate glyph hex length — match your CBOR decode cap
    if (strlen($glyphHex) > 1310726) { // 640 KiB of CBOR + 3-byte marker, in hex
        throw new Exception('Glyph hex data too large');
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
- [ ] Glyph hex size is within your CBOR decode cap (see CBOR Payload Size Cap)
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

**Defensive pattern:** keep the message a static string and pass every
caller-supplied value as a **separate argument** to an error class that
redacts its arguments. Long base58/hex strings and BIP-39 mnemonics get
replaced with `<redacted>` before the message crosses any logging
boundary. Redaction matches whole arguments only: `"Invalid WIF: " + wif`
is one argument containing a space and a colon, so it does not match and
the key is logged verbatim.

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
    def __init__(self, message, *values):
        # `message` must be a static string; secrets go in `values`.
        self.message = message
        self.values = tuple(redact(v) for v in values)
        super().__init__(message, *self.values)

    def __str__(self):
        return " ".join([self.message, *map(str, self.values)])

# Usage — pass the secret as its own argument:
raise WalletError("invalid WIF", user_input_wif)
# str(e): "invalid WIF <redacted>"

# WRONG — interpolated into the message, so redaction never sees it:
# raise WalletError("Invalid WIF: " + user_input_wif)
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

class WalletError extends Error {
    // `message` must be a static string; secrets go in `values`.
    constructor(message, ...values) {
        super([message, ...values.map(v => String(redact(v)))].join(' '));
        this.name = 'WalletError';
    }
}

throw new WalletError('invalid WIF', userInputWif);  // message: "invalid WIF <redacted>"
```

Apply at the boundary, not at the call site — defenders should not
have to remember `redact()` at every `throw`. Have a single error
base class that runs redaction in its constructor — and pass secrets as
**separate arguments**, never interpolated into the message string.
Inheriting the base class does not protect a message that already
contains the key.

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

At block 410,000, two things changed:

- **ASERT difficulty adjustment** — the half-life dropped from 2 days to 12 hours,
  so block-time variance is tighter. Expect faster recovery from hashrate spikes
  and drops.
- **New fee framework** — defined at 410,000 but enforced on a delay (see below).

(`OP_BLAKE3` (`0xee`), `OP_K12` (`0xef`), `OP_LSHIFT` (`0x98`), `OP_RSHIFT` (`0x99`),
`OP_2MUL` (`0x8d`) and `OP_2DIV` (`0x8e`) are not part of this activation; they are
enabled with the enhanced-references rules, mainnet block 62,000. See Appendix opcode table.)

### Fee Increase (Block 415,000, after grace)

The minimum relay fee rose 10x from 0.01 RXD/kB (legacy) to **0.1 RXD/kB**
(10,000 photons/byte), with a maximum block min-fee cap of **0.5 RXD/kB**. Between
blocks 410,000 and 415,000, miners ran under a 5,000-block (~17 days at the 5-minute target spacing) grace window
that kept the effective floor at the legacy rate. From block 415,000 onward, the
0.1 RXD/kB floor is fully enforced — every transaction you build today must meet
it or receive `{"code":-26,"message":"min relay fee not met (code 66)"}`.

See Fee Calculations & Cost Analysis for the post-V2 cost tables.

### New Protocols: dMint and WAVE

- **dMint** — Mineable token distribution via PoW. Protocol combination `[1, 4]`.
  Three mining algorithms: SHA256D (`0xaa`), BLAKE3 (`0xee`), K12 (`0xef`). The V1
  contracts decoded in this guide use SHA256D; BLAKE3 contracts are live on
  mainnet in V2 form (e.g. the contract spent by mint `a2f186c3…531b`, block
  439,061). See [Decentralized Mint (dMint)](#decentralized-mint-dmint)
  for the full V1 contract layout, the V2 differences, deploy commit/reveal
  shapes, CBOR schema, and the note that Photonic emits V2 only. For V2-only algorithm
  and DAA mode parameters, see the [Radiant AI Knowledge Base](https://github.com/Radiant-Core/radiant-mcp-server/blob/59f6150a9e21c529d4756d95d50cfc3e713c412b/docs/RADIANT_AI_KNOWLEDGE_BASE.md).
- **WAVE** — On-chain naming system (protocol `11`; full marker `p: [2, 5, 11]`).
  Provides human-readable names and DNS-like records. The canonical,
  indexer-recognized shape carries the name in a nested **`attrs`** dict
  (`attrs.name`, plus `domain`, `target`, `target_type`), matching Photonic
  Wallet's `wave.ts`. A WAVE token that stores its name as a **top-level
  `name`** field still decodes, but is **not indexed by RXinDexer** — emit the
  `attrs.name` shape or the name is invisible to resolvers.
- **Encrypted Content / Timelocked Reveal** — protocols `8` and `9` (REP-3009;
  markers `p: [2, 8]` and `p: [2, 8, 9]`). The payload is encrypted client-side
  with a 32-byte content key (XChaCha20-Poly1305); the mint commits
  `sha256(CEK)` plus an `unlock_at` (block height or unix time) on-chain and
  holds the key off-chain. The token is freely transferable the whole time —
  only the *visibility* of the encrypted payload is gated. After `unlock_at`, a
  reveal transaction publishes the CEK in an `OP_RETURN`; wallets verify
  `sha256(cek) == commitment` and decrypt. (Photonic-compatible; mirrors
  `timelock.ts`.)

### V1 vs V2 dMint deploys: pick deliberately

Both versions are live on mainnet. V2 dMint contracts have been deployed
since at least block 438,356 (`95335028…fb09`), are mined (Glyph-miner
supports the current V2 shape; see mint `a2f186c3…531b` at block 439,061),
and are indexed by RXinDexer. pyrxd deploys and mines V2 by default. Every
dMint deploy is irreversible, so before deploying either version, confirm
that the miners you expect your audience to use support the exact contract
version, algorithm and DAA mode you emit. Photonic notes that V2 deploys made
before its 2026-05-26 redesign do not parse under the current V2 shape — a
reminder that "V2" has not meant one fixed bytecode.

If your SDK exposes both versions, make the version an explicit, required
choice at the call site rather than a silent default, so the caller confirms
the consequence in code, not in a README.

See [Decentralized Mint (dMint)](#decentralized-mint-dmint) for the
V1 deploy shape and the V1/V2 differences.

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

#### V2 Opcodes (enabled with enhanced references, mainnet block 62,000)

Radiant Core 2.1.0's release notes announce these for block 410,000, but the
v3.1.2 interpreter gates them on the enhanced-references flag (mainnet block
62,000). All are available on mainnet today.


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

**Last Updated:** 2026-06-06 — added covenant-author + indexer-integration learnings (FT genesis-ref clarification, NFT singleton conservation is covenant-only, FT-in-covenant `codeScriptHash` weld, resolving a ref via RXinDexer, WAVE `attrs.name` + Timelocked-Reveal/REP-3009 detail); see Changelog. 2026-05-13 — cross-referenced the six mainnet golden-vector test classes shipped in pyrxd (FT, NFT, commit, CBOR payload, V1 dMint contract, V1 dMint mint) as a reference implementation downstream SDK authors can mirror. 2026-05-11 added V1 mint tx mechanics (4-output shape, 72-byte mint scriptSig, PoW preimage construction, `PowPreimageResult` reference API). 2026-05-10 added Decentralized Mint (dMint) section with V1 contract layout, deploy shape, CBOR schema, and chain-walking patterns. Based on byte-by-byte mainnet research from pyrxd's V1 dMint mint + deploy work. See Changelog.
**Based on Verified Mainnet Transactions:**
- Glyph NFT reveal (test mint: no `main`, wrong `in` ref, truncated CID): `27390efab1e3168c05301b18f6cdfd553a6d122a41496d0f5e104e79a918be7e`

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
- Auditing any third-party dependency they install (`@radiant-core/radiantjs`,
  `paroga/cbor-js`, Radiant Core release tarballs, Pinata SDKs, Ledger
  `app-radiant` firmware). Nothing in this guide constitutes a
  recommendation that these dependencies are trustworthy — it documents
  *how* to use them with the least risk, not *whether* to use them.
- Their own key management and funds. The authors accept no liability for
  lost RXD, lost NFTs, lost FT supply, stuck commit UTXOs, or
  attacker-controlled spends resulting from misapplied patterns.

**Ledger app-radiant-v1 is community-maintained and unaudited.** The
Glyph-transfer patch (released as `v0.0.8-glyph-transfer`, followed by the
`v0.0.5-security-fixes` pre-release with AI-assisted audit remediation whose
fixes have not been reviewed by another human) was built to demonstrate that
Glyph transfer-preserving spends *can* be signed by a Ledger device. It has
not undergone a formal human security audit. Use it on testnet first; if you use it
on mainnet, start with values you can afford to lose.

In short: treat this guide as a technical map, not a warranty. The terrain
is yours to navigate.

---

## Changelog

Radiant's on-chain protocol is versioned by activation height (V2 = block
410,000, fee change = 415,000, etc.). This guide is versioned independently
and tracks documentation evolution. (Section numbers in changelog rows refer to the numbering at the time.)

| Date | Commit range | Summary |
|---|---|---|
| 2026-10-10 | (accuracy review) | Corrected against current sources (Radiant Core 9cd72aa, Photonic becf41a, RXinDexer ca8a6a4, pyrxd 6207b5b8, mainnet txs): V2 dMint is live and mined; dMint ref offsets (`d8` at byte 5, `d0` at 42) and per-deploy push widths; mint nonce width is not covenant-checked (supersedes the 4-vs-8 rule in earlier rows); V2 deploy CBOR is `v: 2, p: [1, 4]` + `dmint` map; CBOR cap raised above Photonic's 512 KiB content limit (supersedes the 256 KB cap above); `loc_hash` labelled a guide/pyrxd convention; RXinDexer `GET /glyphs/{ref}` with `ref`/`ref_hex`; `estimatefee` takes no arguments and is not a safe fee source; testnet/regtest RPC ports; `rpcallowip` scoped to the app network; secrets passed to errors as separate arguments; radiantjs is now `@radiant-core/radiantjs`. |
| 2026-06-06 | (pyrxd 0.6.0) | Covenant-author + indexer-integration learnings. (1) **FT ref = genesis outpoint**: §7 now states the 36-byte FT ref is the FT-commit/mint origin, identical in every holder UTXO and constant across transfers — never the reveal/current txid. (2) **NFT conservation has no consensus "exactly one" rule** (new §7 subsection): consensus enforces only output-refs⊆input-refs and disallow-siblings, so burning an NFT (zero output copies) is valid and "exactly one output" is covenant/wallet-enforced only. An NFT *can* be held in a covenant; an FT cannot. (3) **FT-in-covenant Layer-2 weld**: extended "Avoid Phantom Refs" with the `codeScriptHashValueSum` gate — an FT conserves only to outputs sharing its exact code-script, so a covenant must gate the FT *spend path* (covenant prologue + intact `bd d0 <ref> dec0…` epilogue + hash-compared settlement), not hold the FT. (4) **Resolving a ref via RXinDexer** (new §9 subsection): REST-vs-ElectrumX-ws deployment, the 72-hex wire-ref key (bare txid 404s), the display-vs-internal txid byte-order asymmetry (`token_id`/`glyph_id` fields), fail-closed semantics, and trusting the live endpoint over a source checkout. (5) **WAVE + TIMELOCK detail**: §10 protocol table + §19 now document WAVE's `attrs.name` canonical shape (top-level `name` is not RXinDexer-indexed) and the Encrypted/Timelocked-Reveal flow (`[2,8,9]`, XChaCha20-Poly1305, commit-`sha256(CEK)`-then-`OP_RETURN`-reveal, REP-3009). |
| 2026-05-13 | (pyrxd 0.5.1) | Cross-reference the four mainnet golden-vector test classes that pyrxd 0.5.1 ships — one per wire-format builder pinned in §17. Reading them is the shortest path to seeing what a "byte-equal to mainnet" assertion looks like in working code; downstream SDK authors in other languages can mirror or cross-check against the same fixtures. Added `### Reference implementation: pyrxd's golden-vector tests` subsection in §17 with a builder → test-class → source-file mapping for FT, NFT, commit (FT + NFT branches), CBOR reveal payload (incl. 65,569 B binary fixture), V1 dMint contract script, and V1 dMint mint-tx scriptSig + reward. No protocol-level changes; documentation cross-link only. |
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
- **Glyph protocol addition** (new opcode, new protocol ID, new required CBOR field): audit sections 5 (On-Chain Images), 7 (Fungible Tokens), 9 (CBOR Payload Format), 16 (Common Errors).
- **Pinata/IPFS API change**: audit `uploadFileToPinata` and the IPFS Integration section.
- **Electron-Wallet / Ledger firmware update**: audit the Hardware Wallet pointer and [`radiant-ledger-guide`](https://github.com/MudwoodLabs/radiant-ledger-guide) cross-reference.
- **dMint contract changes** (a new V2 shape or DAA mode): update the §8 dMint section, the V1 vs V2 table and Verified Working Transactions.
