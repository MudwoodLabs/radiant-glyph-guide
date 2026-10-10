/**
 * Radiant Glyph scriptPubKey classifier.
 *
 * Recognizes the three mainnet-observed shapes that a Ledger-owned address can
 * custody and spend with a standard P2PKH scriptSig. Template constants derived
 * from 2309 FT holder samples across 6 tokens and 500 mainnet blocks (tip 420968
 * → 420469), see fixtures/classifier-vectors.json for golden vectors.
 *
 * Pure ES module — no crypto, no async, no dependencies. Ships to both the
 * browser (imported by index.html) and Node (imported by the test runner).
 */

export const FT_MID  = "88acbdd0";
export const FT_TAIL = "dec0e9aa76e378e4a269e69d";
export const VERSION = { p2pkh_prefix: "00" };

/** @typedef {{ type: "p2pkh"|"nft"|"ft"|"op_return"|"unknown"|"invalid",
                pkh?: string, ref?: string, raw?: string, note?: string, error?: string }} Classification */

/**
 * IMPORTANT — consensus vs classifier gap.
 *
 * A syntactic "ft" or "nft" match means the scriptPubKey looks like a
 * Glyph-wrapped P2PKH, NOT that consensus will let you spend it. For NFT
 * singletons and FT holders, consensus validates the 36-byte ref at spend
 * time against the UTXO's stored input-ref vector (interpreter.cpp:1751-1760
 * in radiant-node). An attacker can construct a 63/75-byte lookalike script
 * whose ref was never committed via a real colored-output chain — this
 * classifier will return `type: "ft"` for it, but any spend attempt will
 * fail consensus. The UI should treat the balance figure as "what the
 * script claims to hold," not "what you can actually move."
 *
 * The only way to eliminate this gap is to cross-check each ref against
 * its originating commit-tx ref vector via node RPC — which is out of
 * scope for this classifier. Wallets that care about spendability before
 * display should perform that check before showing the balance.
 */

/**
 * @param {string} spkHex — the scriptPubKey hex (no 0x prefix)
 * @returns {Classification}
 */
export function classify(spkHex) {
  const s = (spkHex || "").toLowerCase().trim();
  if (!/^[0-9a-f]*$/.test(s) || s.length % 2 !== 0) {
    return { type: "invalid", error: "not valid hex" };
  }
  const lenB = s.length / 2;

  // Plain P2PKH: 25B, 76a914 <pkh:20> 88ac
  if (lenB === 25 && s.startsWith("76a914") && s.endsWith("88ac")) {
    return { type: "p2pkh", pkh: s.slice(6, 46), raw: s };
  }

  // NFT singleton: 63B, d8 <ref:36> 75 76a914 <pkh:20> 88ac
  if (lenB === 63 && s.startsWith("d8") && s.slice(74, 76) === "75"
      && s.slice(76, 82) === "76a914" && s.endsWith("88ac")) {
    return { type: "nft", ref: s.slice(2, 74), pkh: s.slice(82, 122), raw: s };
  }

  // FT holder: 75B, 76a914 <pkh:20> 88ac bd d0 <ref:36> dec0e9aa76e378e4a269e69d
  if (lenB === 75 && s.startsWith("76a914")
      && s.slice(46, 54) === FT_MID
      && s.slice(126) === FT_TAIL) {
    return { type: "ft", pkh: s.slice(6, 46), ref: s.slice(54, 126), raw: s };
  }

  // OP_RETURN
  if (s.startsWith("6a")) return { type: "op_return", raw: s };

  return { type: "unknown", raw: s, note: `${lenB}-byte script, shape not recognized` };
}

/**
 * Reconstruct a 75-byte FT holder scriptPubKey for a (pkh, ref) pair.
 * Useful for feeding scantxoutset `raw(...)` descriptors.
 */
export function buildFtSpk(pkhHex, refHex) {
  if (!/^[0-9a-f]{40}$/i.test(pkhHex)) throw new Error("pkh must be 20 bytes hex");
  if (!/^[0-9a-f]{72}$/i.test(refHex)) throw new Error("ref must be 36 bytes hex");
  return ("76a914" + pkhHex + FT_MID + refHex + FT_TAIL).toLowerCase();
}

/** Reconstruct a 63-byte NFT singleton scriptPubKey for a (pkh, ref) pair. */
export function buildNftSpk(pkhHex, refHex) {
  if (!/^[0-9a-f]{40}$/i.test(pkhHex)) throw new Error("pkh must be 20 bytes hex");
  if (!/^[0-9a-f]{72}$/i.test(refHex)) throw new Error("ref must be 36 bytes hex");
  return ("d8" + refHex + "7576a914" + pkhHex + "88ac").toLowerCase();
}

/**
 * Split a 36-byte ref (as hex) into {txid, vout}. ref = reversed_txid(32B) + vout_LE(4B).
 */
export function refToOutpoint(refHex) {
  const txidRev = refHex.slice(0, 64);
  const voutLE  = refHex.slice(64, 72);
  let txid = "";
  for (let i = 62; i >= 0; i -= 2) txid += txidRev.slice(i, i + 2);
  const vout = parseInt(voutLE.slice(6, 8) + voutLE.slice(4, 6) + voutLE.slice(2, 4) + voutLE.slice(0, 2), 16);
  return { txid, vout };
}
