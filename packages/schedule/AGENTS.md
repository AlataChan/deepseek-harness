# AGENTS.md — Schedule packages

These rules supplement the repository and package instructions for `packages/schedule/*`.

- The Host `schedule` domain writes v2 and compatibly reads v1 without open-time writes. Store active, paused and ended records with session, new_once or new targets and globally unique task ids; only explicit deletion removes a task. Browser and Agent management use the same service; read and delete must not activate a Session.
- One Host runtime scans active tasks at startup and schedules their next target; ended tasks never rearm. Persist pendingDelivery with its reserved Session id in the same task row before create. Resume or create due Sessions through the existing Session controller so preset composition and concurrent activation retain one owner.
- Preserve `after`, `at`, `every`, `daily`, `weekly`, and `cron`. Daily rules retain an explicit time and IANA zone; they are not fixed 86,400-second intervals. Skip missing local dates/times and select the earlier overlap once per date. Recurring tasks contribute only their latest missed occurrence and advance to a future target; due recurring tasks in one Session share a message.
- Enqueue with producer kind `schedule`, await Session persistence, then retire or advance the task. These writes are not atomic: a crash between them may duplicate delivery. Do not describe enqueue as model completion or add an execution-record state machine.
- Failed delivery leaves the task stored and reports the failure. Do not add a generic retry loop. Shutdown drains accepted work before closing storage.
- Historical `schedule/change` events retain the original three-kind `LegacyScheduleRecord`; the current Host decoder owns additional rule kinds. Warn when loading a Session with active historical reminders; do not scan or migrate all historical Sessions implicitly, or infer daily intent from an existing one-shot prompt.
- Keep recurrence arithmetic pure. Production uses platform wall time and segmented timers; tests use explicit samples or restored fake timers.
