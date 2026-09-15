---
name: commerce-sales-analysis
description: Explaining how the bound store is selling, meaning why sales, units, or orders moved between periods, which listing or product line drove the change, whether stock limited sales, and pace against a target the merchant has stated. Not needed when commerce_sales_summary's totals for the asked period already answer the question.
---

# Commerce sales analysis

Below, "segment" means whatever unit the question is about: a listing, a SKU, or a parent product line.

Give the merchant a takeaway they can act on, the figure behind it, and the comparison it rests on, and say which commerce tool returned each figure.

## Before any figure

- When no commerce source is bound to this session, import the merchant's exports with `commerce_import_file`, one call per table with its platform, or call `commerce_load_sample` when the merchant only wants to try the analysis.
- Read each import preview's row count and warnings. A table with warnings or few rows limits which questions the data can answer; say so before answering from it.

## Where the figures come from

- Start with `commerce_sales_summary` for the period asked about and for the comparison period: order count, units sold, gross sales, and currency.
- Use `commerce_analysis_query` for series and segments the summary does not carry: daily or weekly totals, sales by listing or parent product, and period-over-period differences. Write one read-only `SELECT` or `WITH` statement over the `orders`, `products`, and `inventory` tables, join `orders` to `products` on `listing_id` for titles and product lines, aggregate in SQL, and keep results small with `GROUP BY` and `LIMIT`.
- Take stockouts and low stock from `commerce_inventory_health`, and a listing's title, status, and variants from `commerce_search_listings` or `commerce_get_listing`.
- When a query is refused, follow the refusal's correction step. When a column you need is absent from the returned schema, the exports do not carry it: report that question as unanswerable from these files.
- Show a figure you work out from returned rows (a share, a run rate, a difference between periods) with its inputs beside it.
- The latest `ordered_at` date in `orders` is the latest date the data covers. A period that runs past it is partial; say so before comparing it with a complete one.

## The comparison

- Choose the comparison period for the question and name it: the prior period of the same length for how a week or month went, the same period last year for a swing that could be seasonal, before and after a change when the question is about that change.
- Compare a partial period with the matching part of the baseline, or say the comparison is partial against complete; give both end dates.
- When the data holds no comparable period (a first month of sales, a newly listed product), say so, give the pace on its own terms, and offer the nearest substitute the data holds, labeled as one.

## Explaining a movement

- Say first what moved, by how much, and against which baseline; then investigate.
- Confirm the movement before explaining it. A partial period, missing days in the export, or an unusual baseline accounts for many apparent drops; when one of those is the explanation, say so and stop.
- Locate it: query sales by segment for both periods and name the segment that accounts for most of the change, with its share of the change.
- Separate mix from level. Average order value falls when prices fell and also when cheaper listings made up more of the orders; say which one the returned rows show, or say that you cannot tell until the segments are queried.
- Check candidate causes against data for the same dates: stockouts or low stock from `commerce_inventory_health`, and listing status from `commerce_get_listing`. The exports carry no traffic, campaign, or price-history data, so a cause that needs them is a lead to check in the store's own reports, not a finding.
- Call something the cause only when its timing lines up and the movement sits in the segment it would affect; otherwise report a correlation and name the data that would settle it.
- Grade your confidence in words that match the evidence: a finding when the data shows it, a lead when it partly does, and "not visible in the data" when nothing does.

## Targets the merchant has stated

- A target stated in this conversation turns a summary into a pace report: the figure so far, the share of the period elapsed, and what the rest of the period must average, computed from returned figures. Do not supply a target the merchant has not stated.

## Presenting the answer

- Lead with the takeaway and its baseline ("gross sales fell 12% on the prior week, and one product line accounts for 9 of those points"), then the comparison used, then the one caveat that changes how to read the figures.
- Name the tool behind each figure and keep the currency with every money figure.
- When the movement traces to something operational, such as a stockout or a delisted product, name the affected listing and what the data shows, and leave the decision to the merchant.

<!-- Adapted from merchant-agent/skills/performance-insights/SKILL.md in Claude Commerce Agents (Apache License 2.0); rewritten for the commerce_* tools. See the package NOTICE. -->
