---
title: "Detection Health: How Do You Know Your Rule Still Works?"
summary: "Check the telemetry, fields, execution and validation behind a detection before treating silence as a healthy result."
description: "A practical Splunk detection-health model covering expected sources, data freshness, field coverage, scheduled searches and controlled validation."
date: 2026-09-30
updated: 2026-09-30
status: ready
primary_domain: Detection Engineering
secondary_domains: [Splunk Engineering, Platform Reliability]
article_type: technical-guide
evidence_level: design-backed
content_level: advanced
has_spl: true
---

## Why this matters

A detection can be enabled, scheduled and free of visible errors while effectively blind. Zero alerts may mean that the behaviour did not occur. It may also mean the required events never arrived, fields disappeared, the search was skipped, or the alert action failed.

This guide develops the All Things Splunk topic shared on NCS Aglow on 25 September 2026: “Detection Health: How Do You Know Your Rule Still Works?” It extends the [search-to-detection guide]({{ '/articles/from-search-to-detection/' | relative_url }}) into ongoing operation.

The examples are illustrative engineering designs, not a claim of deployment or measured results. Index names, field names, thresholds and source inventories must be adapted and validated in the target environment.

## Define what healthy means

Treat a detection as a chain of dependencies:

Telemetry source → ingestion → Splunk data → detection search → alert or action

Each dependency needs observable evidence. “Enabled” is a configuration state, not proof that the chain works.

| Layer | Evidence to check | What it does not prove |
| --- | --- | --- |
| Source and ingestion | Expected source is present; last event and volume fit its normal cadence | Required security fields are usable |
| Data quality | Required fields exist and contain meaningful values | The detection logic matches the intended behaviour |
| Search execution | Scheduled jobs complete within the required timing | A successful job produced the right answer |
| Validation | A controlled test produces the expected detection result | Delivery reaches the intended destination |
| Action | A test notification or action reaches its destination | An analyst has enough context to respond |

Record the detection owner, required sources and fields, schedule, search window, expected arrival delay, validation method and response destination. Define these per detection rather than assigning one global “healthy” threshold.

## Check expected sources, including missing ones

A search that groups recent events by host only reports hosts that produced matching events. A completely silent host can disappear from the results. Compare observed data with a maintained inventory of expected sources.

For a bounded Windows process-event example, create an illustrative lookup named expected_detection_sources.csv:

```csv
host,max_age_seconds,owner,enabled
win-app-01,900,Security Operations,1
win-app-02,1800,Security Operations,1
```

Use exactly one row per monitored host, consistent host identifiers, numeric positive thresholds and an explicit enablement state. The lookup should contain only hosts expected to produce this event class. These thresholds are examples, not recommendations.

```spl
index=windows EventCode=4688 earliest=-24h latest=now
| stats count AS event_count max(_time) AS last_event BY host
| inputlookup append=true expected_detection_sources.csv
| stats sum(event_count) AS event_count
        max(last_event) AS last_event
        values(max_age_seconds) AS max_age_seconds
        values(owner) AS owner
        values(enabled) AS enabled BY host
| where enabled="1"
| eval max_age_seconds=tonumber(max_age_seconds)
| eval age_seconds=now()-last_event
| eval health=case(
    isnull(max_age_seconds) OR max_age_seconds<=0, "invalid inventory",
    isnull(last_event), "no matching event in window",
    age_seconds<0, "future event timestamp",
    age_seconds>max_age_seconds, "stale",
    true(), "fresh")
| table host owner event_count last_event age_seconds max_age_seconds health
```

Appending the inventory preserves expected hosts even when they have no matching event in the search window. The aggregation combines each inventory row with its observations. Hosts without an enabled inventory entry are excluded from this particular health check.

The search answers a narrow question: did this expected host produce recent matching process events? It does not prove that its forwarder is offline, that all telemetry is missing, or that the detection itself works.

Validate the inventory separately for missing host names, duplicate entries, conflicting enablement states and nonnumeric thresholds. A malformed inventory can undermine the check itself.

## Interpret freshness carefully

The example measures event time using _time. Old events arriving now can still look stale. Incorrect clocks or timestamp parsing can produce future timestamps. Investigate ingestion delay and timestamp quality separately before assigning a root cause.

A 24-hour observation window cannot distinguish a source that has never reported from one that last reported outside that window. Choose the window for the expected cadence and freshness threshold, and account for maintenance, quiet systems and batch sources.

Avoid repeatedly scanning large raw datasets simply to refresh a dashboard. Start with the indexes and event classes the detection actually needs, measure search cost, and consider summary-based monitoring as scale requires.

## Check field coverage and volume

Recent events are useful only if they contain the evidence the rule needs. For a process detection, this might include the executable, command line, parent process, user and host. Exact field names depend on the source and its extractions.

Track the proportion of applicable events with each required field populated. Inspect sample events when coverage changes. A populated field can still contain a placeholder, truncated value or a different meaning after an extraction change.

Compare volume with the source's normal pattern. A sharp drop can justify investigation; a quiet period alone is not proof of failure. Record exceptions with an owner and an expiry or review date so temporary maintenance does not become permanent suppression.

## Check execution and delivery

Inspect scheduled-search execution history, skipped jobs, failures, duration and execution latency. Splunk's Search: Scheduler Activity dashboard provides a starting point for scheduler investigation.

Review the schedule and search window together. Late-arriving events can fall outside the window even when each scheduled job succeeds. If overlapping windows are required, also define how duplicate detections are handled.

Check alert thresholds, suppression settings, permissions and actions. A rule can return valid results while its notification is suppressed or its destination is unavailable. Separate “search completed,” “detection matched” and “action delivered” in the health record.

## Validate the complete chain safely

Use a controlled test in an approved environment. Specify the expected input, rule version, expected result, timing and destination before running it.

| Test case | Expected health outcome |
| --- | --- |
| Expected source has fresh matching events | Freshness check reports fresh |
| Expected source has no events in the window | Inventory row remains visible and reports missing |
| Latest event exceeds the threshold | Freshness check reports stale |
| Required field disappears | Data-quality check identifies reduced coverage |
| Scheduled search is skipped | Execution monitoring reports the skip |
| Controlled behaviour reaches the search | Expected detection result is produced |
| Alert destination fails | Delivery check reports failure independently |

Include benign negative cases when validating the detection logic. Repeat relevant tests after changes to telemetry, extractions, search logic, permissions, scheduling or alert actions.

Record the last successful validation with the rule version and tested scope. An old successful test is evidence about that version and those conditions, not a permanent guarantee.

The SPL above has been reviewed as an illustrative pattern. It has not been executed against a Splunk instance; validate command behaviour, lookup access and results before operational use.

## Turn health findings into action

A useful health report should identify the detection, affected source or dependency, observed condition, expected condition, first observed time and accountable owner.

Keep failure categories distinct:

- Missing or stale data: inspect the source, ingestion path and timestamp handling.
- Degraded fields: inspect source settings, add-ons and extractions.
- Execution failure or skip: inspect scheduler pressure, permissions and search cost.
- Validation mismatch: inspect rule assumptions, timing and test inputs.
- Delivery failure: inspect action configuration and destination availability.

When coverage is degraded, communicate that limitation. Zero alerts during a telemetry gap should not be presented as evidence that no suspicious activity occurred.

## Key takeaway

Detection health requires evidence across data, execution, validation and delivery. A quiet rule deserves confidence only when its dependencies are working and its intended behaviour has been tested.

Start with the five checks behind the original Aglow topic: last event seen, event volume, required fields, search execution and last successful validation. Then connect failures to an owner and a concrete investigation path.

## References

- Splunk: inputlookup command, including appending lookup rows to search results.
- Splunk: addinfo command, including an expected-host lookup example.
- Splunk: Search: Scheduler Activity, covering skipped searches and execution latency.
