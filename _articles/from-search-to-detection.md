---
title: "From Search to Detection: What Actually Makes a Detection Production-Ready?"
summary: "A practical path from raw SPL logic to a validated, tuned detection with clear analyst action."
description: "How telemetry, hypotheses, SPL, context, tuning, validation, and analyst action turn a search into a production detection."
date: 2026-09-19
updated: 2026-09-19
status: ready
primary_domain: Detection Engineering
secondary_domains: [Splunk Engineering]
topics: [spl, detection-validation, telemetry-health, governance]
content_level: advanced
evidence_level: design-backed
article_type: technical-guide
series: Production Detection Engineering
series_order: 1
flagship: true
target_roles: [Detection Engineers, SIEM Engineers, SOC Engineers]
has_spl: true
has_diagram: true
has_dashboard: false
reading_time: 17
related_articles: [why-didnt-detection-fire, detecting-the-absence]
related_projects: [{title: "Log Onboarding and Governance", url: "/projects/log-onboarding-governance.html"}]
social_image: /assets/images/og-preview.png
related_social_post: ""
social_platform: LinkedIn
social_post_date:
social_medium: All Things Splunk
social_status: planned
---

## Why this matters

A useful search and a production detection are not opposites. A search is one of the building blocks of a detection—but search logic alone does not define the telemetry contract, account for timing, manage expected behaviour, prove coverage, or tell an analyst what to do next.

> A search answers a question about data. A production detection continuously evaluates a security hypothesis under defined telemetry, timing, context, tuning, validation, and response assumptions.

The distinction matters because syntactically correct SPL can still produce a weak security outcome. Missing command-line telemetry cannot be repaired by a better regular expression. An exclusion can lower alert volume while also removing the behaviour the rule was meant to find. A result can be technically accurate but operationally useless if it lacks the evidence an analyst needs.

This article follows one sanitized Windows process-execution scenario from exploration to an operational detection design. The SPL and field names are illustrative: actual names depend on the event source, sourcetype, add-on, field extractions, and whether the environment uses Splunk's Common Information Model (CIM).

## The problem

Suppose an engineer is asked to detect suspicious PowerShell execution. A broad starting point might be:

```spl
index=windows EventCode=4688
```

This retrieves Windows process-creation events in the selected index. It does not identify malicious behaviour. It is useful for confirming volume, inspecting field coverage, and learning how process telemetry is represented in this environment.

Narrowing the search to PowerShell is still only an investigative step:

```spl
index=windows EventCode=4688
New_Process_Name="*powershell.exe"
```

PowerShell is a legitimate administration and automation tool. The search will find routine scripts, software deployment, monitoring, troubleshooting, and interactive administration alongside potentially malicious activity. The result is more specific, but it has not yet established suspicious intent or an operating model.

The engineering progression is:

1. Define a behaviour worth detecting.
2. Establish which telemetry can represent it.
3. Write understandable search logic.
4. Add context that changes priority or interpretation.
5. Tune only where expected behaviour can be explained precisely.
6. Validate data, logic, timing, and analyst usability.
7. Operate and revisit the detection as the environment changes.

## Technical background

### Start with a detection hypothesis

For this scenario, the hypothesis is:

> An adversary may use encoded PowerShell commands to obscure script content or execution intent.

This is a statement to test, not a verdict. Encoded commands also appear in legitimate automation, deployment tooling, and administrative workflows. The hypothesis defines the behaviour of interest while leaving room for context and validation to separate expected use from activity that merits investigation.

Evidence that can help test the hypothesis includes:

- a PowerShell process was created;
- its command line contains an encoded-command switch;
- the process, parent, user, host, and time can be identified;
- the telemetry arrived within the detection's search window;
- available context shows whether this combination is expected;
- a controlled encoded-command test can be observed end to end.

This immediately exposes a dependency: if the command line is absent, this particular logic cannot evaluate the hypothesis. The right response is to fix or supplement telemetry—not pretend that a process-name match provides equivalent coverage.

### Telemetry requirements and limitations

#### Windows Security Event ID 4688

Event ID 4688 records process creation when the relevant audit policy is enabled. Depending on Windows version, collection, and parsing, useful evidence can include the new process name and identifier, creator or parent information, user context, and a process command line.

Command-line visibility is configuration-dependent. Microsoft documents that the **Include command line in process creation events** policy must be enabled; otherwise the command-line field is empty. Collection and forwarding must then preserve the event, and Splunk parsing must expose the fields needed by the search.

#### Sysmon Event ID 1

Sysmon Event ID 1 can provide richer process-creation telemetry, including the full command line, parent-process details, process identifiers such as `ProcessGuid`, integrity information, and configured hashes. That richness is not automatic evidence that every endpoint is covered: Sysmon must be deployed, its configuration must select the required events and hash algorithms, and the resulting log must reach Splunk reliably.

#### PowerShell logging

PowerShell Script Block Logging can provide content-level visibility beyond process creation, and Module Logging can record pipeline activity for selected modules. These sources can strengthen investigation and validation, but they have their own configuration, collection, volume, and sensitive-data considerations. This article uses process telemetry for the detection example rather than treating PowerShell logging as universally available.

<figure class="engineering-graphic telemetry-graphic" aria-labelledby="telemetry-title" aria-describedby="telemetry-description">
  <h3 id="telemetry-title">Three complementary views of PowerShell execution</h3>
  <p id="telemetry-description" class="graphic-description">The sources answer different questions. Availability and field coverage must be verified in the environment before detection logic relies on them.</p>
  <div class="telemetry-grid">
    <article>
      <h4><span aria-hidden="true">01</span> Windows Security 4688</h4>
      <dl>
        <div><dt>Evidence</dt><dd>Process creation, identity, process identifiers, and potentially command line or creator details.</dd></div>
        <div><dt>Dependency</dt><dd>Process-creation auditing, command-line policy, collection, forwarding, and parsing.</dd></div>
        <div><dt>Strength</dt><dd>Native Windows audit evidence with broad enterprise relevance.</dd></div>
        <div><dt>Limitation</dt><dd>Command line can be empty; field richness varies by version and configuration.</dd></div>
        <div><dt>Contribution</dt><dd>Establishes that PowerShell started and identifies the host and security context.</dd></div>
      </dl>
    </article>
    <article>
      <h4><span aria-hidden="true">02</span> Sysmon Event ID 1</h4>
      <dl>
        <div><dt>Evidence</dt><dd>Image, command line, parent, identifiers, configured hashes, and integrity context.</dd></div>
        <div><dt>Dependency</dt><dd>Sysmon deployment, event-selection configuration, forwarding, and field extraction.</dd></div>
        <div><dt>Strength</dt><dd>Rich process lineage and correlation detail for investigation.</dd></div>
        <div><dt>Limitation</dt><dd>Not universally deployed; configuration and coverage can differ across endpoints.</dd></div>
        <div><dt>Contribution</dt><dd>Strengthens process and parent context around the encoded-command behaviour.</dd></div>
      </dl>
    </article>
    <article>
      <h4><span aria-hidden="true">03</span> PowerShell logging</h4>
      <dl>
        <div><dt>Evidence</dt><dd>Script blocks and selected module or pipeline activity when the relevant logging is enabled.</dd></div>
        <div><dt>Dependency</dt><dd>Logging policy, channel collection, volume planning, and sensitive-data controls.</dd></div>
        <div><dt>Strength</dt><dd>Adds content-level evidence beyond the process command line.</dd></div>
        <div><dt>Limitation</dt><dd>May be unavailable, incomplete, high-volume, or unsuitable for every collection scope.</dd></div>
        <div><dt>Contribution</dt><dd>Helps validate or investigate what the PowerShell process attempted to execute.</dd></div>
      </dl>
    </article>
  </div>
  <figcaption>No single source is always superior. Reliable coverage comes from understanding what each configured source can—and cannot—prove.</figcaption>
</figure>

The practical lesson is simple: detection quality depends on telemetry quality. Before writing alert logic, sample the source and document which fields are present, populated, timely, and stable.

## Architecture or telemetry context

<figure class="engineering-graphic maturity-path" aria-labelledby="maturity-title" aria-describedby="maturity-description">
  <h3 id="maturity-title">Search-to-detection maturity path</h3>
  <p id="maturity-description" class="graphic-description">Scheduling a search is not the finish line. Each stage produces an engineering output that must be reviewed before the next stage can be trusted.</p>
  <ol>
    <li><span class="step-number">01</span><strong>Exploratory search</strong><span class="quality-gate">Output: understood data and field coverage</span></li>
    <li><span class="step-number">02</span><strong>Detection hypothesis</strong><span class="quality-gate">Gate: testable behaviour and required evidence</span></li>
    <li><span class="step-number">03</span><strong>Telemetry requirements</strong><span class="quality-gate">Gate: present, populated, timely, stable fields</span></li>
    <li><span class="step-number">04</span><strong>Detection SPL</strong><span class="quality-gate">Output: readable candidate logic with known gaps</span></li>
    <li><span class="step-number">05</span><strong>Context and enrichment</strong><span class="quality-gate">Output: entity, role, parent, history, and priority</span></li>
    <li><span class="step-number">06</span><strong>Bounded tuning</strong><span class="quality-gate">Gate: explained exception with owner and scope</span></li>
    <li><span class="step-number">07</span><strong>Multi-layer validation</strong><span class="quality-gate">Gate: positive, negative, timing, and analyst tests</span></li>
    <li><span class="step-number">08</span><strong>Operational detection</strong><span class="quality-gate">Output: owned, actionable, monitored capability</span></li>
  </ol>
  <figcaption>Promotion to a scheduled alert before these gates are satisfied creates automation, not production readiness.</figcaption>
</figure>

This is not merely a data pipeline. It is a chain of assumptions. A source-policy change can remove command lines. A parsing change can rename a field. Ingestion delay can place a valid event outside the scheduled window. An overly broad allowlist can discard the final signal. Production detection engineering makes those assumptions visible and testable.

## Practical example

### 1. Explore the available process telemetry

Start by learning what the data contains rather than assuming the field model:

```spl
index=windows EventCode=4688
| stats count by New_Process_Name
| sort - count
```

This distribution can expose naming variations, missing values, unexpected paths, and high-volume processes. It is an exploratory search—not an alert—and it should be run over a controlled time range appropriate to the data volume.

### 2. Inspect PowerShell executions

```spl
index=windows EventCode=4688
New_Process_Name="*powershell.exe"
| table _time host user New_Process_Name CommandLine
```

Here `New_Process_Name` and `CommandLine` are illustrative. One environment might extract `Process_Command_Line`; Sysmon data might expose `Image`, `CommandLine`, and `ParentImage`; CIM-aligned searches might use fields such as `process`, `process_name`, and `parent_process_name`. Validate the source model before copying the query.

The table answers useful questions:

- Is the command line present and populated?
- Are host and user consistently available?
- Does the process field contain a name or a full path?
- How often is PowerShell used legitimately?
- Which parent processes and accounts are common?

### 3. Build understandable candidate logic

The next example normalizes a small set of illustrative field variations and looks for an encoded-command switch as a command-line token:

```spl
index=windows EventCode=4688
| eval process_name=lower(coalesce(New_Process_Name, Image, process_name))
| eval process_command_line=coalesce(CommandLine, Process_Command_Line, process)
| eval parent_process=coalesce(ParentProcessName, ParentImage, parent_process_name)
| where process_name IN ("powershell.exe", "pwsh.exe")
    OR like(process_name, "%\\powershell.exe")
    OR like(process_name, "%\\pwsh.exe")
| eval command_line_normalized=lower(trim(process_command_line))
| where match(command_line_normalized, "(^|\\s)-(enc|encodedcommand)(\\s|:)")
```

The logic is deliberately readable. Converting the command line to lowercase handles case differences. Treating the switch as a token is more precise than searching for the substring `-enc` anywhere in the event.

It is still incomplete by design. PowerShell parameter handling may accept other unambiguous shortened forms; spacing, quoting, escape characters, wrappers, renamed executables, or missing command lines can affect matching. Broadening the expression should be driven by controlled tests and observed data—not by making a regular expression look sophisticated. Additional telemetry, such as Script Block Logging, may detect behaviour that process-command-line logic cannot.

`coalesce` also does not create a universal schema. It is suitable for demonstrating the concept across sanitized examples; a production implementation should normally target a validated sourcetype or an established normalized data model rather than mixing semantically different sources without testing.

### 4. Shape events into an analyst-ready result

After the candidate filter, aggregate repeated matching events into a result that preserves the evidence needed for triage:

```spl
| eval reason_triggered="PowerShell command line contains an encoded-command switch"
| stats earliest(_time) as first_seen
        latest(_time) as last_seen
        count as event_count
        values(parent_process) as parent_process
    by host user process_name process_command_line reason_triggered
| convert ctime(first_seen) ctime(last_seen)
| table host user process_name parent_process process_command_line
        first_seen last_seen event_count reason_triggered
```

`stats` is sufficient here; `transaction` would add cost and state without solving a relationship this example requires. Grouping by full command line can create high cardinality in a busy environment, so the production grouping and time range should be tested against expected volume. If command lines are very long or frequently unique, consider whether a normalized indicator, hash, or carefully selected grouping better supports the analyst workflow.

### Add context without turning it into a blanket verdict

The candidate result gains meaning when it is enriched with information such as:

- privileged user versus ordinary user;
- interactive account versus approved automation identity;
- workstation, jump host, domain controller, or management server role;
- parent process and execution location;
- known software-deployment workflow;
- unusual source host or first-seen combination;
- frequency and historical behaviour for this entity.

Context should improve priority and interpretation. It should not silently redefine a suspicious behaviour as safe forever. For example, an automation account can be expected to run one signed deployment script from a management host and still be suspicious when it launches encoded PowerShell from a user workstation.

## Tuning Without Making the Detection Blind

Tuning is part of detection engineering, but lower alert volume is not proof of higher quality. Every allowlist, exclusion, suppression rule, and threshold trades some sensitivity for operational focus.

A rule such as:

```text
user != service_account
```

is weak because it explains nothing about when, where, or how that account is expected to behave. It also creates a blind spot if the account is compromised or used outside its normal workflow.

A better tuning question is:

> Why is this behaviour expected for this entity under this specific condition?

That can lead to a constrained exception such as an approved account, on an approved management host, launched by an expected parent process, with a known command pattern, during a controlled workflow. Even then, record the owner, reason, scope, review date, and evidence that supports the decision.

<figure class="engineering-graphic tuning-graphic" aria-labelledby="tuning-title" aria-describedby="tuning-description">
  <h3 id="tuning-title">Safe tuning is a validation loop</h3>
  <p id="tuning-description" class="graphic-description">An exception is a controlled engineering decision, not a shortcut for removing noise.</p>
  <div class="tuning-contrast">
    <section class="unsafe-pattern" aria-label="Broad exclusion to avoid">
      <p class="pattern-label">Broad exclusion</p>
      <code>user != service_account</code>
      <p>Removes all matching activity for the identity, including unexpected hosts, parents, commands, or compromised use.</p>
    </section>
    <section class="bounded-pattern" aria-label="Constrained exception to prefer">
      <p class="pattern-label">Bounded exception</p>
      <ul><li>Account</li><li>Host role</li><li>Parent process</li><li>Command pattern</li><li>Workflow</li><li>Owner</li><li>Review date</li></ul>
      <p>Suppress only the explained combination, retain evidence, and retest the detection.</p>
    </section>
  </div>
  <ol class="tuning-loop">
    <li><span>01</span><strong>Observed noise</strong></li>
    <li><span>02</span><strong>Contextual investigation</strong></li>
    <li><span>03</span><strong>Narrow exception</strong></li>
    <li><span>04</span><strong>Positive retest</strong></li>
    <li><span>05</span><strong>Negative testing</strong></li>
    <li><span>06</span><strong>Timing validation</strong></li>
    <li><span>07</span><strong>Operational review</strong></li>
    <li><span>08</span><strong>Scheduled reassessment</strong></li>
  </ol>
  <figcaption>The loop continues after deployment: exceptions can become stale, ownership can change, and detection coverage can drift.</figcaption>
</figure>

Common tuning controls include:

- **Allowlists:** narrow, owned exceptions for demonstrably expected combinations.
- **Exclusions:** removal of events that meet precise, reviewed conditions.
- **Suppression:** prevent repeated alerts for the same entity or episode without discarding the underlying evidence.
- **Thresholds:** require a meaningful count, rate, or combination where a single event is not sufficient.
- **Known automation patterns:** match stable execution context rather than trusting an account name alone.
- **Command-line patterns:** distinguish approved scripts or arguments while accounting for change and evasion.

False positives consume analyst capacity and reduce trust. False negatives create missed coverage. Tuning must track both: test what noise is removed, then repeat positive tests to prove that the intended behaviour still triggers.

## Detection output: make the result actionable

A useful detection result should normally provide or link to:

```text
Detection name
Host
User
Process
Parent process
Command line
First seen
Last seen
Relevant enrichment
Reason triggered
Recommended investigation context
```

Raw events remain valuable evidence, but returning only raw events forces every analyst to reconstruct why the result mattered. The detection should state what condition triggered, retain the source evidence, and provide enough context to decide whether to escalate, investigate further, or close as expected behaviour.

The exact delivery mechanism—alert, notable event, risk event, or another workflow—depends on the Splunk products and operational model in use. The engineering requirement is not a specific product feature; it is a result with clear ownership and a defined response path.

## Validation approach

A production candidate should pass several different forms of validation. Passing only the first is not enough.

| Validation layer | Question | Example evidence |
| --- | --- | --- |
| Syntax validation | Does the SPL run without errors? | Search completes and commands behave as intended. |
| Data validation | Are the required sources and fields present? | Coverage report shows populated process, command-line, user, host, and parent fields for scoped endpoints. |
| Logic validation | Does the filter represent the hypothesis? | Reviewed matches contain a PowerShell encoded-command token rather than an unrelated substring. |
| Positive testing | Can a controlled known event trigger it? | An approved test execution is collected, matched, enriched, and delivered. |
| Negative testing | Does expected benign behaviour stay below the alerting boundary? | Representative administrative and automation activity is evaluated without hiding the positive test. |
| Timing validation | Does scheduling account for arrival and execution time? | Tests cover observed ingestion delay and boundary conditions around the scheduled window. |
| Operational validation | Can an analyst act on the result? | A reviewer can explain the reason, inspect evidence, identify the entity, and follow a documented next step. |

Positive tests should use approved, non-sensitive commands in a controlled environment. Record the event time, index time, host, expected fields, search execution time, and final result. Negative tests should represent actual benign patterns, not invented examples chosen simply because they do not match.

Timing deserves explicit attention. A correct event can still be missed if it arrives after a scheduled search window has closed. Measure observed delay and test events near both time boundaries. The related article [Why Didn't the Detection Fire? Understanding `_time`, `_indextime`, and Late-Arriving Data]({{ '/articles/why-didnt-detection-fire/' | relative_url }}) develops that problem in more detail.

Validation should produce repeatable evidence: test case, expected outcome, observed outcome, source event, result, reviewer, and date. That makes future changes to SPL, parsing, scheduling, or exclusions safer to assess.

## Common mistakes

1. Treating an interesting event as a detection.
2. Assuming required fields exist without checking the telemetry.
3. Writing SPL before defining the hypothesis.
4. Tuning purely to reduce alert volume.
5. Ignoring ingestion delay and scheduled-window boundaries.
6. Using broad, permanent exclusions for noisy identities or hosts.
7. Validating only that the SPL runs.
8. Returning an alert without enough analyst context.
9. Never revisiting the rule after deployment.

## Production considerations

- **Frequency and time window:** balance detection latency, ingestion delay, overlap, and search cost. Document how duplicate matches are handled.
- **Search performance:** constrain indexes, sources, and time ranges early where the data model permits. Review high-cardinality grouping and expensive regular expressions against real volume.
- **Suppression and duplicates:** suppress repeated notifications deliberately while retaining evidence and avoiding gaps between scheduled runs.
- **Ownership:** name the team responsible for data health, detection logic, tuning decisions, and analyst response.
- **Review cadence:** review rule performance, exceptions, data coverage, and response outcomes at an interval appropriate to risk and change rate.
- **Telemetry change:** monitor source configuration, forwarding, parsing, and field-population changes that can silently remove coverage.
- **Detection drift:** retest when applications, infrastructure, logging, field extractions, or attacker techniques change—and when exclusions accumulate.

A detection that worked six months ago can degrade without producing a visible error. Searches may still run successfully while a renamed field becomes null, an application changes its normal command line, an endpoint population moves to a new source, or a broad exception absorbs new behaviour. Health monitoring and periodic positive tests are controls against that silent failure.

## Key takeaway

The path from search to detection is a dependency chain:

```text
Telemetry
↓
Detection hypothesis
↓
Search logic
↓
Context
↓
Tuning
↓
Validation
↓
Operational detection
```

Failure at an earlier stage affects every stage below it. Better SPL cannot restore telemetry that was never collected. Tuning can improve precision or create a blind spot. A successful search execution does not prove effective detection. And a technically correct alert remains operationally weak if nobody can explain or act on it.

A production-ready detection is therefore not a query promoted into a schedule. It is a maintained security capability with explicit assumptions, validated evidence, bounded tuning, actionable output, and an owner.

## References

- [Microsoft: Event 4688—a new process has been created](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/auditing/event-4688)
- [Microsoft Sysinternals: Sysmon Event ID 1](https://learn.microsoft.com/en-us/sysinternals/downloads/sysmon)
- [Microsoft PowerShell: about logging](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_logging?view=powershell-5.1)
- [Splunk Search Reference: `stats`](https://help.splunk.com/en/splunk-cloud-platform/spl-search-reference/10.4.2604/search-commands/stats)
