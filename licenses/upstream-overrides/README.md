# Supplementary License Texts

Some fixed npm distributions omit the full license file even though their package metadata declares MIT. These files supplement those distributions; they are not represented as files extracted from the original npm archive.

- Radix UI texts come from the Radix primitives repository's root MIT license (WorkOS).
- Micromark texts come from their corresponding upstream repositories. The preparation script preferred the npm metadata's gitHead where available.
- dagre-d3-es 7.0.10 uses the full text distributed with the installed 7.0.14 package from the same repository, as explicitly recorded in its file header.
- react-remove-scroll-bar 2.3.8 uses its author's publicly available root license, as explicitly recorded in its file header.

The original preparation run did not finish its aggregate provenance manifest. Do not infer that every text has a verified historical commit. `licenses/bundled/manifest.json` records each actual input path and SHA-256, the installed package version and declared repository/commit where available. A declared package commit is not proof that a supplementary license was retrieved from that commit. The two specifically qualified texts retain their source notes in full.

The runtime and regular build use only these local files. No runtime license download is performed. This inventory is an engineering attribution record, not a legal certification or a claim about unrelated upstream assets.