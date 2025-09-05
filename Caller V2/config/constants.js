// Configuration constants for outreach campaigns

export const OUTREACH_CONFIG = {
  // Agent configuration
  AGENTS: {
    AGENT_1_ATTEMPTS: [1, 3], // Agent 1 handles attempts 1 and 3
    AGENT_2_ATTEMPTS: [2, 4], // Agent 2 handles attempts 2 and 4
    DESCRIPTION: "Alternating agent system: Agent 1 for attempts 1&3, Agent 2 for attempts 2&4",
  },

  // Call scheduling configuration
  CALLS: {
    // Production schedule (uncomment for production)
    // SCHEDULE: [
    //   { day: 1, hour: 10, minute: 0 }, // Day 1 at 10:00 AM UK time
    //   { day: 2, hour: 14, minute: 0 }, // Day 2 at 2:00 PM UK time
    //   { day: 8, hour: 11, minute: 0 }, // Day 8 at 11:00 AM UK time
    //   { day: 9, hour: 15, minute: 0 }, // Day 9 at 3:00 PM UK time
    // ],

    // Testing schedule (intervals relative to campaign start time)
    SCHEDULE: [
      { minutes: 0 }, // Attempt 1: Immediate (Agent 1)
      { minutes: 3 }, // Attempt 2: 5 minutes after campaign start (Agent 2)
      { minutes: 6 }, // Attempt 3: 10 minutes after campaign start (Agent 1)
      { minutes: 9 }, // Attempt 4: 15 minutes after campaign start (Agent 2)
    ],

    // Maximum number of call attempts - NOW CONFIGURABLE
    MAX_ATTEMPTS: Number.parseInt(process.env.MAX_CALL_ATTEMPTS) || 2,

    // Maximum days in future for scheduling
    MAX_FUTURE_DAYS: Number.parseInt(process.env.MAX_FUTURE_DAYS) || 30,

    // Delay between processing different records in a batch (in milliseconds)
    PROCESSING_DELAY: 15000, // 15 seconds

    // Scheduler configuration - when to start making calls each day
    SCHEDULER: {
      // Production: Start calls at specific time each day (UK time)
      // DAILY_START_TIME: { hour: 9, minute: 0 }, // 9:00 AM UK time
      // DAILY_END_TIME: { hour: 17, minute: 0 }, // 5:00 PM UK time
      // DAYS_OF_WEEK: [1, 2, 3, 4, 5], // Monday to Friday (0=Sunday, 6=Saturday)

      // Testing: Check every minute for ready calls
      CHECK_INTERVAL_MINUTES: Number.parseInt(process.env.SCHEDULER_POLL_INTERVAL) || 1, // Check every 1 minute
      ENABLED: true,
    },
  },

  // Email configuration
  EMAILS: {
    // Send email after all calls are completed (cadence step 4)
    SEND_AFTER_CALLS: true,

    // Maximum number of email attempts - NOW CONFIGURABLE
    MAX_ATTEMPTS: Number.parseInt(process.env.EMAIL_ATTEMPT_COUNT) || 3,

    // Maximum days in future for scheduling
    MAX_FUTURE_DAYS: Number.parseInt(process.env.MAX_FUTURE_DAYS) || 30,

    // Processing delay between emails for same record (reduced from 90s to 15s)
    EMAIL_DELAY_SECONDS: 15, // 15 seconds between emails

    // Instant email sending
    INSTANT_SEND: true,
  },

  // Database configuration - SIMPLIFIED TO USE ONLY CALL_CAMPAIGNS AND EMAIL_CAMPAIGNS
  DATABASE: {
    TRACKING_DB_NAME: "outreach_tracking",
    CALL_CAMPAIGNS_COLLECTION: "call_campaigns", // Individual call campaign records for Kanban
    EMAIL_CAMPAIGNS_COLLECTION: "email_campaigns", // Individual email campaign records for Kanban
    // Legacy collections (keep for backward compatibility)
    CALL_TRACKING_COLLECTION: "call_campaigns", // Same as call campaigns
    EMAIL_TRACKING_COLLECTION: "email_campaigns", // Same as email campaigns
  },

  // Working hours (for production scheduling) - UK TIME
  WORKING_HOURS: {
    START: 9, // 9 AM UK time
    END: 17, // 5 PM UK time
  },
}

export default OUTREACH_CONFIG
