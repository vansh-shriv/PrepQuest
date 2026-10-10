// Names shared by the API (producer, result ingester) and the judge worker (consumer).

/** BullMQ lanes (doc 12 §7): submissions outrank runs. Contest/interview lanes arrive with those features. */
export const QUEUE_SUBMIT = "judge-submit";
export const QUEUE_RUN = "judge-run";

/** Redis stream the worker appends {@link JudgeEvent}s to; the API's trusted ingester persists them. */
export const RESULT_STREAM = "judge:results";
export const RESULT_GROUP = "api-ingester";

/** Total attempts for a job; infrastructure errors (IE) are retried, user verdicts never are. */
export const JOB_ATTEMPTS = 3;
