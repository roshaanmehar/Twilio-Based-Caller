// Configuration constants for outreach campaigns

export const OUTREACH_CONFIG = {
  // Call scheduling configuration
  CALLS: {
    // Production schedule (uncomment for production)
    // SCHEDULE: [
    //   { day: 1, hour: 10, minute: 0 }, // Day 1 at 10:00 AM
    //   { day: 2, hour: 14, minute: 0 }, // Day 2 at 2:00 PM
    //   { day: 8, hour: 11, minute: 0 }, // Day 8 at 11:00 AM
    //   { day: 9, hour: 15, minute: 0 }, // Day 9 at 3:00 PM
    // ],

    // Testing schedule (intervals relative to campaign start time)
    SCHEDULE: [
      { minutes: 0 }, // Attempt 1: Immediate
      { minutes: 5 }, // Attempt 2: 5 minutes after campaign start
      { minutes: 10 }, // Attempt 3: 10 minutes after campaign start
      { minutes: 15 }, // Attempt 4: 15 minutes after campaign start
    ],

    // Maximum number of call attempts (cadence steps 0, 1, 2, 3)
    MAX_ATTEMPTS: 4,

    // Delay between processing different records in a batch (in milliseconds)
    PROCESSING_DELAY: 15000, // 15 seconds

    // Scheduler configuration - when to start making calls each day
    SCHEDULER: {
      // Production: Start calls at specific time each day
      // DAILY_START_TIME: { hour: 9, minute: 0 }, // 9:00 AM
      // DAILY_END_TIME: { hour: 17, minute: 0 }, // 5:00 PM
      // DAYS_OF_WEEK: [1, 2, 3, 4, 5], // Monday to Friday (0=Sunday, 6=Saturday)

      // Testing: Check every minute for ready calls
      CHECK_INTERVAL_MINUTES: 1, // Check every 1 minute
      ENABLED: true,
    },
  },

  // Email configuration
  EMAILS: {
    // Send email after all calls are completed (cadence step 4)
    SEND_AFTER_CALLS: true,

    // Processing delay between emails for same record (reduced from 90s to 15s)
    EMAIL_DELAY_SECONDS: 15, // 15 seconds between emails

    // Instant email sending
    INSTANT_SEND: true,
  },

  // Database configuration
  DATABASE: {
    TRACKING_DB_NAME: "outreach_tracking",
    CALL_TRACKING_COLLECTION: "call_campaigns",
    EMAIL_TRACKING_COLLECTION: "email_campaigns",
  },

  // Working hours (for production scheduling)
  WORKING_HOURS: {
    START: 9, // 9 AM
    END: 17, // 5 PM
  },
}

export default OUTREACH_CONFIG
