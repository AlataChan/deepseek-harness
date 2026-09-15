---
name: commerce-inventory-pricing
description: Stock and price decisions in the bound store export, covering low-stock and stockout triage, restock quantities from sales pace, slow movers and the choice between leaving, marking down, or pausing them, permanent price changes, and dated percentage promotions, all staged for review within the store's guardrails. Not needed for explaining why sales moved (commerce-sales-analysis), listing text (commerce-listing-copy), or campaign drafts (commerce-marketing-campaigns).
---

# Commerce inventory and pricing

Below, "stock" means the `available` units in the imported inventory table, and "pace" means units sold per day over a named window of the orders table.

Tell the merchant what needs a decision, give the figures behind each one, and stage the move they choose. Nothing changes in the store: an approved export writes a CSV file the merchant uploads.

## Where each figure comes from

- Take stock and low-stock flags from `commerce_inventory_health`, current prices and variants from `commerce_get_listing` or `commerce_search_listings`, and pace from `commerce_analysis_query` over `orders` for a named window ending at the latest `ordered_at` date.
- Staging is held for a listing id that no commerce read returned in this session, so read before you stage.
- Show a figure you work out (days of stock left, units to cover a date, a price move in percent) with its inputs beside it.
- The exports carry no cost, margin, competitor price, or traffic data. Say so when a decision needs them, and do not estimate them.
- A listing with variants holds price and stock per variant: a price change, promotion, or restock on the parent is held and names the variant ids to use.

## Stock decisions

- Rank low-stock and stockout items by sales at stake, pace times price, from returned figures.
- Stage a restock with `commerce_stage_restock` and an explicit `quantity` per listing, with the reasoning in the `summary` ("60 units covers about three weeks at the 3 a day sold since 2026-08-01"). The quantity is added to current stock, and a quantity above the store's limit is held by the guardrail gate.
- Reorder points and automatic replenishment are settings in the store's own system: report what the data shows and do not claim to set them.

## Slow movers

- When stock is not moving, offer the three dispositions by name: leave it, mark it down, or pause the listing in the store.
- Put the deciding numbers beside them (stock left, pace, and price) and say which way they point.
- Stage a markdown as a promotion or a price change, below. Pausing a listing is a store action outside these tools: say so and leave it to the merchant.

## Price changes and promotions

- Anchor on the merchant's stated goal (clear stock, hold volume, lift price) and propose the smallest move that plausibly meets it; offer a shorter window or a narrower scope before a deeper cut.
- A move limited to dates is `commerce_stage_promotion` with `listing_ids`, `discount_pct`, `starts_on`, and `ends_on`. `commerce_stage_price_change` moves the base price from now on and is the tool only when that is what was asked.
- Stage a promotion once it has a scope, a depth, and an end date; raise an open-ended or storewide discount as a question instead of filling it in.
- The store's guardrails cap a permanent move's size and a promotion's depth. When a call is held by the guardrail gate, name the limit from the held text, propose a figure inside it, and stage that figure only once the merchant picks it. Because promotions end, a dated promotion is the alternative to offer for a permanent move over the cap.
- Write money in the currency the tools returned.

## Stage, review, and export

- Give every staged change a one-sentence `summary` on why the move is safe or worth making.
- When a staging call is held, follow its recovery step instead of retrying the same call.
- Discard a change the merchant rejects with `commerce_discard_change`. Call `commerce_export_changes` only when the merchant asks to export; the export asks the merchant for approval, writes nothing without it, and is held when stock or prices in the source changed after staging.

<!-- Adapted from merchant-agent/skills/inventory-operations/SKILL.md and merchant-agent/skills/pricing-promotions/SKILL.md in Claude Commerce Agents (Apache License 2.0); rewritten for the commerce_* tools. See the package NOTICE. -->
