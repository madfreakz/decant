# Decant — Wine Menu Scanner

PWA at /Users/markfok/projects/decant. Mobile-web wine menu scanner that uses Mark's synthesized taste profile + 405 Vivino-rated wines to recommend bottles from a restaurant wine list.

## Stack

Next.js 15 + React 19 + Tailwind 4 + `@google/genai`. Deployed to Vercel. Same shape as ai-digest.

## Env vars

- `GEMINI_API_KEY` — Decant's own Gemini key (own Google Cloud project for per-project usage/cost tracking; no longer shared with ai-digest). Local `.env.local` uses the shared `gemini-dev-scratch` key.
- `VIVINO_SESSION_COOKIE` — current `_ruby-web_session` (refresh from Chrome DevTools if 401s)
- `VIVINO_USER_ID=15328411`

## Architecture

1. Camera → photo(s) → Gemini Flash vision OCR → structured wine list per page
2. Dedupe → recognition pass (vs. 405 rated wines) + scoring pass (1 Gemini call, all wines + taste profile)
3. SSE stream Verdict → Vivino enrichment progressively fills top 5

Vivino is enrichment, never blocking. If cookie expires, app gracefully degrades.

## Key reused logic

Ported from `~/projects/vivino-mcp-server/src/`:
- `client.ts` → `lib/vivino.ts` (axios + cookie + 700ms throttle + CSRF)
- `tools/search.ts` → search wines
- `tools/wines.ts` → details + taste profile

## Before touching any Gemini call

Read `~/Documents/Obsidian Vault/Knowledge/Engineering/gemini-production-rules.md` first. It holds the rules that apply to every Gemini app, not just this one: output-token budgets sized to worst-case output (the 3072 ceiling here truncated ordinary wine lists for months), thinking-budget floors per model tier, throw-don't-return-empty, validating model output, and fencing untrusted input. Decant's worst bug was a rule ai-digest had already written down and never shared.

## Pitfalls

- **Vivino cookie expiry:** on 401/403, skip enrichment. Don't crash. Refresh cookie from Chrome DevTools.
- **OCR errors on stylized menus:** show parsed wines as editable chips before scoring.
- **Wine name disambiguation:** always search winery + name + vintage. Low confidence → skip Vivino, keep LLM score.
- **Recognition false positives:** require winery+grape match OR Levenshtein < 3, never name-only.
- **iOS Safari PWA state loss:** persist scan state to localStorage after every page scan.

## Design system (load-bearing — don't drift)

- Palette: `#0F0A08` ink, `#F5EFE6` cream, `#7A1220` bordeaux, `#A8855B` aged-gold, `#3E5C44` bottle-green, `#8B7355` kraft, `#D9CFC2` paper-shadow
- Typography: `GT Sectra` (or Reckless Neue) for display, `Söhne Buch` (or Inter) for UI, `GT Sectra Mono` for numerals
- Signature: the **wax seal** (64px bordeaux disc with embossed "D" in Sectra italic) is the brand mark, app icon, loading indicator, and Verdict stamp
- Motion: every transition 1.3× longer than feels necessary. Decant is patient.
- Light mode default; auto-switch to dark for restaurants.

## Deploy

`git push` to main → Vercel auto-deploys. Don't use `vercel --prod`. Same as ai-digest pattern.

## Reference

Plan file: `/Users/markfok/.claude/plans/think-through-this-vibe-zippy-haven.md`
