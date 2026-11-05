---
description: "Host-wide durable automation tasks with six timings and three Session destinations."
kind: "package-reference"
---

# @deepseek-ai/dsh-schedule

English | [中文](README.zh.md)

## Summary

Host-wide durable automation tasks with six timings and three Session destinations.

<a id="use-this-package"></a>

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

One Schedule service owns creation, paged listing, catalog, view, edit, immediate run, saved delivery history, and clearing ended tasks. Management reads do not activate Sessions. Human remotes carry no acting Session; model consumers pass their actual Session as involved metadata, without granting human authority.

Creation requires a title of at most 120 characters, a non-empty prompt, and a `timing` object selecting `after`, `at`, `every`, `daily`, `weekly`, or `cron`. Fixed intervals are at least 60 seconds. Daily, weekly and five-field Vixie cron rules retain an explicit IANA zone, skip missing local times and choose the earlier overlap. Recurrences deliver only their latest missed occurrence.

Targets are `session`, `new_once`, and `new`; omission defaults to `new_once`. `new_once` creates one Session on delivery and then reuses it; `new` creates a fresh Session for each delivery. Existing destinations cannot be archived or owned by delegated agents. New Session creation uses the existing Session controller and the acting Session's original header cwd when no cwd was supplied; an effective execution cwd never replaces that identity.

`edit` accepts an update patch or deletion. `expectedUpdatedAt` compares against the stored revision; use `null` for a row without one. Every accepted edit advances its revision even across clock rollback. Paused and ended rows remain readable. Resuming a missed recurrence selects a future occurrence; a past one-shot needs replacement timing. Immediate run leaves the scheduled occurrence intact. Cancellation is checked before the durable write, including after FIFO waits; it does not roll back an admitted write.

<a id="understand-the-implementation"></a>

## Understand the implementation

The `schedule` domain writes version 2 and reads version 1 through `compatibleVersions: [1]`. Version-1 `sessionId` becomes a session target and `inactive` becomes `ended` only in memory. Open performs no rewrite; the next mutation writes the current row without the old binding. Historical version-1 `schedule/change` Session events remain inert and unchanged.

Before creating a delivery Session, the runtime persists `pendingDelivery` in the same task row with a reserved Session identity. A cold restart adopts that identity through `sessionController.create` and `resolveAgent`. Delivery enqueues source kind `schedule` without a user RPC id, waits for Session persistence, then updates the same task's receipt and recurrence. These are separate durable writes; at-least-once delivery can repeat after a crash. Delivery supersedes an open waiting question through ordinary inbox handling and never grants Goal human authority.

History is newest-first and bounded by an explicit page size of 1–100. Legacy receipts receive their existing target Session identity at read time; missing receipts are never reconstructed. Retention defaults to 30 days and 200 records, configurable by `deliveryHistoryDays` and `deliveryHistoryRecords`, and applies only on append.

<a id="model-experience"></a>

<a id="further-exploration"></a>

## Further Exploration

- [Schedule subsystem](../../../docs/subsystems/schedule.md).

## Model Experience

### Task tools and delivery

#### What the model sees

A visible tool contributes its fixed schema prefix. Each result is one lossless JSON text block containing the committed task, paged list, deletion, conflict or error. Results append to Session history until compaction; their token cost follows content and page size, preserving the earlier reusable prefix. Due input uses the existing scheduled-reminder framing and source kind `schedule`.

#### Token effect

Catalog reads issue no model request. Tool results and deliveries cost their actual rendered text.

#### KV Cache effect

Logged results append to history; changed tool registrations may invalidate the schema prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The Host must be running. Delivery may repeat across a crash; deleting a task never retracts queued input. History retention cannot reconstruct missing earlier receipts or establish model execution completion.

### Dev Note

<a id="dev-note"></a>

None.
