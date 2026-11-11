# Octopus DSH: customer introduction script

English | [中文](2026-11-11-octopus-enterprise-introduction.zh.md)

<a id="summary"></a>
## Summary

A 20-slide reference script for introducing the local agent-workbench trend to an existing customer, using Octopus DSH as our implementation example. It is a customer-discussion draft, not a launch announcement, a finished PPTX or a promise of a complete enterprise control platform. Audience: business sponsors, IT/security owners and engineering teams considering a qualified pilot.

The source decks inform the progression from business problems to solution, deployment and evidence. All slide copy below is original and limited by the [capability assessment](2026-11-11-octopus-dumate-capability-assessment.md). Speaker and production notes are not customer-facing interface copy.

<a id="contents"></a>
## Contents

- [Story and presentation approach](#story)
- [Slide-by-slide copy](#slides)
- [Evidence and production checklist](#proof)
- [Dev Note](#dev-note)

<a id="story"></a>
## Story and presentation approach

Use three chapters: why the workbench matters; how people and engineers use it; how to deploy and verify one business scenario. Suggested discussion length is 20–30 minutes, an editorial target rather than a measured task duration. Use a light sea-green visual language, one message per slide, actual Octopus screenshots and original diagrams. Show evidence in the pattern “input → execution → output → acceptance”.

Keep the strongest distinction concrete: the customer can inspect and change the execution system and own its business plugins. Do not organize the story around supposedly exclusive abilities such as writing reports or making presentations. Those common abilities are useful demonstrations, not evidence that other products cannot perform them.

<a id="slides"></a>
## Slide-by-slide copy

### 01 — A workbench your team can shape

**Main copy:** Local agent workbenches: from using an AI tool to owning reusable execution capabilities. Octopus DSH is our example, developed on DeepSeek Harness.

**On screen:** Customer workflows; inspectable implementation; organization-specific extensions.

**Visual:** An original three-part diagram: people, workbench and business systems. Place the Octopus name separately from the upstream project name.

**Speaker:** We are introducing a way of organizing AI work. The relevant question is which parts your team needs to control, extend and verify.

**Production boundary:** Identify the upstream basis; do not imply an independent foundation model or a newly launched enterprise suite.

### 02 — The goal is a completed piece of work

**Main copy:** A useful answer is one step. Business delivery also needs the right inputs, authorized actions, an output and a way to check it.

**On screen:** Define the result; connect the required resources; verify completion.

**Visual:** One task crossing documents, data and a human decision, ending in a reviewed artifact.

**Speaker:** Start with the customer’s existing workflow. Measure whether the finished output meets its acceptance criteria.

**Production boundary:** Do not promise that every task succeeds autonomously.

### 03 — Four recurring obstacles

**Main copy:** The obstacles are sensitive data, disconnected systems, scattered working methods and uncertain execution results.

**On screen:** Where may data go? Which systems can be reached? What can be reused? What proves success?

**Visual:** Four cards with one concrete customer question on each.

**Speaker:** These questions are more useful than a long list of tools. They tell us what a pilot must prove.

**Production boundary:** Use customer-confirmed examples; do not invent industry requirements.

### 04 — Who this approach fits

**Main copy:** Octopus fits teams that need custom integrations and can maintain or commission engineering work around them.

**On screen:** Distinct business rules; inspectable execution; an owner for deployment and maintenance.

**Visual:** A fit checklist showing business owner, engineer and IT/security owner.

**Speaker:** Source access creates options and responsibilities. Integration, model services and operational support still need owners.

**Production boundary:** Do not describe the current product as a ready-made centrally governed solution for every enterprise.

### 05 — Product panorama

**Main copy:** People enter through a desktop, a configured web deployment or IM; the workbench composes execution, tools and business extensions.

**On screen:** Entry layer; sessions/goals/teams; Skills/MCP/domain plugins; model endpoints; files and execution records.

**Visual:** Original five-layer diagram. Mark server deployment and specialized integrations as optional compositions.

**Speaker:** The desktop and server are deployment choices. They do not automatically share an enterprise identity or every conversation.

**Production boundary:** Do not draw a nonexistent organization control center as an existing component.

### 06 — Personal assistants and role-based teams

**Main copy:** A person can use an assistant for a task; a team can retain roles, model choices and working context for repeated collaboration.

**On screen:** Saved assistant profiles; standing or ad-hoc teams; scoped memory and responsibilities.

**Visual:** Actual assistant catalog beside an actual saved-team roster.

**Speaker:** We call these reusable role configurations. A corporate employee account, mailbox and organization-wide authorization remain integration concerns.

**Production boundary:** Use “role assistant” or “standing team”; avoid implying provisioned HR identities.

### 07 — One task, with visible checkpoints

**Main copy:** State the objective, provide authorized materials, execute, ask when necessary, deliver the output and check it.

**On screen:** Goal and inputs; tool results and intermediate files; human decisions; accepted output.

**Visual:** Six-step storyboard using one real synthetic-data demonstration.

**Speaker:** A completed model turn is not necessarily a completed business action. We inspect the output and the action receipt.

**Production boundary:** Do not substitute animation or a progress bar for completion evidence.

### 08 — An execution foundation engineers can inspect

**Main copy:** DeepSeek Harness supplies the agent foundation; Octopus composes workbench features and custom extensions around it.

**On screen:** Tool and code execution; context and session persistence; delegated work; configurable execution policies.

**Visual:** A simplified execution diagram with a separate “human authorization” checkpoint.

**Speaker:** Inspecting the implementation helps engineers locate failures and decide what may run. Persistent state alone does not promise automatic recovery after every restart.

**Production boundary:** Do not claim per-task VM isolation or automatic Harness self-evolution.

### 09 — Reusable assets have different jobs

**Main copy:** Skills describe methods; MCP connects tools; knowledge libraries provide materials; plugins implement controlled business behavior.

**On screen:** Methods; system connections; document evidence; executable business rules.

**Visual:** Four cards, each with an actual example and a clear owner.

**Speaker:** Put mandatory constraints into executable policy. A document telling an agent to behave safely is not itself enforcement.

**Production boundary:** Avoid claiming an enterprise approval marketplace from the local plugin list.

### 10 — Demonstration: work from documents

**Main copy:** Select a local library or attach supported documents, locate relevant passages and produce a result that can be checked against the source.

**On screen:** Original materials; retrieved passages; draft output; human review.

**Visual:** Actual Ask Knowledge UI, one source passage and one resulting artifact.

**Speaker:** Use synthetic or approved documents. Demonstrate what was read and explicitly flag unsupported or partially extracted content.

**Production boundary:** Do not promise semantic search, full OCR or organizational document ACLs without qualification.

### 11 — Demonstration: tables before questions

**Main copy:** Import a supported table, inspect the data and ask a concrete question. In commerce mode, review staged changes before exporting a local file.

**On screen:** Source selection; visible analysis; staged result; controlled export.

**Visual:** Actual Ask Data import flow and a staged commerce export using sample data.

**Speaker:** Show the supported data path. The commerce example uses fixed local tables; it is not a live shop-management integration.

**Production boundary:** No invented live ERP writes or arbitrary-join claims.

### 12 — Demonstration: a visible team

**Main copy:** A lead delegates writing and review, teammates exchange work, and the user can inspect tasks, messages and outputs.

**On screen:** Lead coordinates; writer produces; reviewer checks; user accepts.

**Visual:** Use the actual collaboration pod and actual task/result artifacts, with no fabricated activity.

**Speaker:** Different roles make responsibility clearer; they do not guarantee independent judgement or isolated filesystems.

**Production boundary:** Do not imply automatic per-teammate worktrees or distributed scheduling.

### 13 — Human decisions from desktop or IM

**Main copy:** An agent can save a structured question. Desktop answers, or configured Feishu choice buttons while online, can continue the relevant conversation.

**On screen:** Saved question; explicit choice; authenticated answer; visible continuation.

**Visual:** Actual question card and an authorized Feishu test card, with identities redacted.

**Speaker:** Feishu free text and decision buttons have different routing. Offline callback delivery is not promised.

**Production boundary:** Only show the Feishu card after real app permission and callback acceptance.

### 14 — Automation with an evidence trail

**Main copy:** A periodic task should identify its source, execute authorized actions and retain a result that distinguishes completed, failed and uncertain outcomes.

**On screen:** Trigger; bounded action; exact output check; deduplication; recovery ownership.

**Visual:** Original timeline of the authorized internal server/WeChat acceptance, marked “integration demonstration”.

**Speaker:** That example uses server timers and a business worker. It demonstrates an integration pattern; it is not a built-in WeChat connector in every desktop install.

**Production boundary:** Show only actual receipts; do not generalize one accepted run into a service-level guarantee.

### 15 — Map where data and actions go

**Main copy:** Local deployment gives the team control choices. The actual model, tool and IM connections determine where information travels.

**On screen:** Authorized files; private or approved model endpoint; tool/network rules; explicit external notifications.

**Visual:** Original data-flow diagram with inside/outside arrows and separate model/IM routes.

**Speaker:** Review source, dependencies and deployment permissions. An internal network does not make an unknown plugin safe.

**Production boundary:** No blanket data-never-leaves, complete DLP, certification or universal sandbox claim.

### 16 — Two deployment choices

**Main copy:** Use a local desktop for interactive work; use an explicitly configured Linux service when a server must remain available for IM-driven work.

**On screen:** Desktop: user workspace and local interaction. Server: administrator provisioned identity, permissions, state and monitoring.

**Visual:** A two-column deployment diagram; show model services as separate configurable endpoints.

**Speaker:** Desktop-only tools and macOS-specific optional packages do not automatically work on Linux. Model inference capacity is a separate resource decision.

**Production boundary:** No prebuilt Kubernetes control plane, domestic-platform certification or automatic HA promise.

### 17 — Connect one business system well

**Main copy:** Choose the integration mechanism that the system and its owner can support: API/MCP first where available, qualified scripts or browser actions where necessary.

**On screen:** Explicit login ownership; narrow read/write scope; validated output; visible failure.

**Visual:** A customer-specific connector card showing inputs, permitted actions and completion evidence.

**Speaker:** Page-injected buttons and an enterprise application publishing platform are possible separate development scopes, not present-tense promises.

**Production boundary:** Do not claim any system connects without engineering, authorization or validation.

### 18 — Show what is real and label the rest

**Main copy:** Demonstrate current interfaces, qualified internal integrations and proposed business scenarios as three different evidence levels.

**On screen:** Existing feature demonstration; internal integration acceptance; customer pilot proposal.

**Visual:** Three evidence cards, each with a source, scope and acceptance note.

**Speaker:** We can show real capability without inventing customer stories. Industry benefits become claims only after that customer’s measured acceptance.

**Production boundary:** No borrowed customer names, logos, certificates or improvement percentages.

### 19 — A pilot with a clear finish line

**Main copy:** Select one workflow and agree the data, actions, permissions, failure handling and acceptance criteria before expanding.

**On screen:** Workflow discovery; connector validation; observed use; permission review; handover.

**Visual:** Five-step delivery path with plugin/configuration/test/evidence artifacts at the end.

**Speaker:** Measure correct completion, human correction, duplicate or uncertain actions, elapsed time and resource cost against a baseline. Set targets with the customer.

**Production boundary:** Do not quote a fixed rollout duration or saving before the workflow is assessed.

### 20 — Questions worth answering before a pilot

**Main copy:** Which data stays internal? Which model will run? Which actions may the agent take? Who maintains the plugin? What proves a completed task?

**On screen:** Compared with enterprise suites: reusable execution is available; enterprise governance is a separate scope. Compared with ordinary assistants: the deciding value is code access and organization-specific engineering.

**Visual:** A concise FAQ beside one agreed candidate workflow.

**Speaker:** The next discussion should choose a workflow and an acceptance owner, not promise every feature in another vendor’s brochure.

**Production boundary:** Keep this slide aligned with the separate capability assessment and the actual release being demonstrated.

<a id="proof"></a>
## Evidence and production checklist

- Record the demonstrated build, platform, enabled preset and required optional dependencies. Desktop seed membership alone does not prove the installed flow.
- Use synthetic documents and tables; remove account identifiers, customer data, credentials and private chat history from screenshots.
- For each demonstrated action, retain its input, actual tool path, output and independent acceptance result. A suggested screenshot in this script is not an existing asset.
- Keep industry-specific work and any Bridge-style extension labelled as proposed until its implementation and customer acceptance exist.
- Produce an original visual identity and diagrams. Borrow the explanatory sequence, not vendor artwork, wording, customer claims or metrics.

<a id="dev-note"></a>
## Dev Note

This document is the reviewable copy for a later presentation build. It changes no runtime behavior or package defaults. For the 42-item technical comparison, version scope and source owners, use the [capability assessment](2026-11-11-octopus-dumate-capability-assessment.md).
