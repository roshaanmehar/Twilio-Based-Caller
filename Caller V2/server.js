import express from "express"
import dotenv from "dotenv"
import { createServer } from "http"
import { connectToMongoDB } from "./database/mongodb.js"
import OutreachService from "./services/outreachService.js"
import ScheduledOutreachService from "./services/scheduledOutreachService.js"
import CampaignCreationService from "./services/campaignCreationService.js"
import OUTREACH_CONFIG from "./config/constants.js"

// Load environment variables FIRST
dotenv.config()

// SET SERVER TIMEZONE TO UK TIME
process.env.TZ = "Europe/London"

console.log(`🇬🇧 Server timezone set to: ${process.env.TZ}`)
console.log(
  `🕐 Current UK time: ${new Date().toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}`,
)

// Check if required environment variables are present
const requiredEnvVars = [
  // Account 1 (Agent 1)
  "ELEVEN_LABS_API_KEY_1", // First account API key
  "ELEVEN_LABS_AGENT_ID_1",
  "ELEVEN_LABS_PHONE_NUMBER_ID_1",

  // Account 2 (Agent 2)
  "ELEVEN_LABS_API_KEY_2", // Second account API key
  "ELEVEN_LABS_AGENT_ID_2",
  "ELEVEN_LABS_PHONE_NUMBER_ID_2",

  "ZAPIER_EMAIL_WEBHOOK_URL",
  "GEMINI_API_KEY",
  "MONGODB_CONNECTION_STRING",
]

console.log("Checking environment variables...")
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`)
    process.exit(1)
  } else {
    console.log(
      `✅ ${envVar}: ${envVar.includes("TOKEN") || envVar.includes("KEY") || envVar.includes("URL") || envVar.includes("CONNECTION") ? "***hidden***" : process.env[envVar]}`,
    )
  }
}

// Function to find an available port
const findAvailablePort = (startPort = 8080) => {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.listen(startPort, () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        findAvailablePort(startPort + 1)
          .then(resolve)
          .catch(reject)
      } else {
        reject(err)
      }
    })
  })
}

// Initialize Express app
const initializeApp = async () => {
  // Connect to MongoDB
  await connectToMongoDB()

  // Initialize services
  const outreachService = new OutreachService(
    {
      agent1: {
        apiKey: process.env.ELEVEN_LABS_API_KEY_1, // Account 1 API key
        agentId: process.env.ELEVEN_LABS_AGENT_ID_1,
        phoneNumberId: process.env.ELEVEN_LABS_PHONE_NUMBER_ID_1,
      },
      agent2: {
        apiKey: process.env.ELEVEN_LABS_API_KEY_2, // Account 2 API key
        agentId: process.env.ELEVEN_LABS_AGENT_ID_2,
        phoneNumberId: process.env.ELEVEN_LABS_PHONE_NUMBER_ID_2,
      },
    },
    {
      apiKey: process.env.GEMINI_API_KEY,
    },
    {
      webhookUrl: process.env.ZAPIER_EMAIL_WEBHOOK_URL,
    },
  )

  const scheduledOutreachService = new ScheduledOutreachService(
    {
      agent1: {
        apiKey: process.env.ELEVEN_LABS_API_KEY_1, // Account 1 API key
        agentId: process.env.ELEVEN_LABS_AGENT_ID_1,
        phoneNumberId: process.env.ELEVEN_LABS_PHONE_NUMBER_ID_1,
      },
      agent2: {
        apiKey: process.env.ELEVEN_LABS_API_KEY_2, // Account 2 API key
        agentId: process.env.ELEVEN_LABS_AGENT_ID_2,
        phoneNumberId: process.env.ELEVEN_LABS_PHONE_NUMBER_ID_2,
      },
    },
    {
      apiKey: process.env.GEMINI_API_KEY,
    },
    {
      webhookUrl: process.env.ZAPIER_EMAIL_WEBHOOK_URL,
    },
  )

  // Initialize NEW campaign creation service
  const campaignCreationService = new CampaignCreationService()
  await campaignCreationService.initialize()

  // Initialize scheduled outreach service
  await scheduledOutreachService.initialize()

  const app = express()

  // Add request logging middleware with UK time
  app.use((req, res, next) => {
    const ukTime = new Date().toLocaleString("en-GB", {
      timeZone: "Europe/London",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    console.log(`📥 ${ukTime} (UK) - ${req.method} ${req.url} from ${req.ip}`)
    if (req.body && Object.keys(req.body).length > 0) {
      console.log(`📦 Body:`, JSON.stringify(req.body, null, 2))
    }
    next()
  })

  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  // API ENDPOINTS FOR CAMPAIGN SYSTEM

  // Create call campaigns
  app.post("/api/v1/campaigns/calls", async (req, res) => {
    try {
      console.log(`🚀 Received call campaign request from ${req.ip}`)

      const { records, attempts, emailConfig, databaseName, collectionName, userId } = req.body

      // Validate required fields
      if (!records || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({
          success: false,
          error: "records array is required and must not be empty",
        })
      }

      if (!attempts || !Array.isArray(attempts) || attempts.length === 0) {
        return res.status(400).json({
          success: false,
          error: "attempts array is required and must not be empty",
        })
      }

      if (!databaseName || !collectionName) {
        return res.status(400).json({
          success: false,
          error: "databaseName and collectionName are required",
        })
      }

      console.log(`🚀 Creating call campaigns for ${records.length} records`)

      const result = await campaignCreationService.createCallCampaigns(
        { records, attempts, emailConfig },
        databaseName,
        collectionName,
        userId,
      )

      return res.json({
        success: result.success,
        message: result.success
          ? `Call campaigns created for ${result.successfulCampaigns}/${result.totalRecords} records`
          : "Failed to create call campaigns",
        data: {
          totalRecords: result.totalRecords,
          successfulCampaigns: result.successfulCampaigns,
          failedCampaigns: result.failedCampaigns,
          skippedCampaigns: result.skippedCampaigns,
          campaignTrackingIds: result.campaignTrackingIds,
          maxCallAttempts: OUTREACH_CONFIG.CALLS.MAX_ATTEMPTS,
          maxFutureDays: OUTREACH_CONFIG.CALLS.MAX_FUTURE_DAYS,
        },
        results: result.results,
        errors: result.errors,
        skipped: result.skipped, // NEW: Show which records were skipped and why
      })
    } catch (error) {
      console.error("❌ Error creating call campaigns:", error.message)
      return res.status(500).json({
        success: false,
        message: "Failed to create call campaigns",
        error: error.message,
      })
    }
  })

  // Create email campaigns
  app.post("/api/v1/campaigns/emails", async (req, res) => {
    try {
      console.log(`📧 Received email campaign request from ${req.ip}`)

      const { records, scheduledAt, databaseName, collectionName, userId } = req.body

      // Validate required fields
      if (!records || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({
          success: false,
          error: "records array is required and must not be empty",
        })
      }

      if (!scheduledAt) {
        return res.status(400).json({
          success: false,
          error: "scheduledAt is required",
        })
      }

      if (!databaseName || !collectionName) {
        return res.status(400).json({
          success: false,
          error: "databaseName and collectionName are required",
        })
      }

      console.log(`📧 Creating email campaigns for ${records.length} records`)

      const result = await campaignCreationService.createEmailCampaigns(
        { records, scheduledAt },
        databaseName,
        collectionName,
        userId,
      )

      return res.json({
        success: result.success,
        message: result.success
          ? `Email campaigns created for ${result.successfulCampaigns}/${result.totalRecords} records`
          : "Failed to create email campaigns",
        data: {
          totalRecords: result.totalRecords,
          successfulCampaigns: result.successfulCampaigns,
          failedCampaigns: result.failedCampaigns,
          skippedCampaigns: result.skippedCampaigns,
          campaignTrackingIds: result.campaignTrackingIds,
          maxEmailAttempts: OUTREACH_CONFIG.EMAILS.MAX_ATTEMPTS,
          maxFutureDays: OUTREACH_CONFIG.EMAILS.MAX_FUTURE_DAYS,
        },
        results: result.results,
        errors: result.errors,
        skipped: result.skipped, // NEW: Show which records were skipped and why
      })
    } catch (error) {
      console.error("❌ Error creating email campaigns:", error.message)
      return res.status(500).json({
        success: false,
        message: "Failed to create email campaigns",
        error: error.message,
      })
    }
  })

  // Get campaign status
  app.get("/api/v1/campaigns/status", async (req, res) => {
    try {
      const { trackingIds, campaignType = "call" } = req.query
      const trackingIdArray = trackingIds ? trackingIds.split(",") : null

      console.log(`📊 Getting campaign status for type: ${campaignType}`)

      const status = await campaignCreationService.getCampaignStatus(trackingIdArray, campaignType)

      return res.json({
        success: true,
        message: "Campaign status retrieved successfully",
        data: status,
      })
    } catch (error) {
      console.error("❌ Error getting campaign status:", error.message)
      return res.status(500).json({
        success: false,
        message: "Failed to get campaign status",
        error: error.message,
      })
    }
  })

  // NEW: Check original record status
  app.get("/api/v1/records/status", async (req, res) => {
    try {
      const { recordId, databaseName, collectionName } = req.query

      if (!recordId || !databaseName || !collectionName) {
        return res.status(400).json({
          success: false,
          error: "recordId, databaseName, and collectionName are required",
        })
      }

      console.log(`📋 Checking original record status: ${recordId}`)

      const status = await campaignCreationService.checkOriginalRecordStatus(recordId, databaseName, collectionName)

      return res.json({
        success: status.found,
        message: status.found ? "Record status retrieved successfully" : "Record not found",
        data: status,
      })
    } catch (error) {
      console.error("❌ Error checking record status:", error.message)
      return res.status(500).json({
        success: false,
        message: "Failed to check record status",
        error: error.message,
      })
    }
  })

  // NEW: Check record eligibility for campaigns
  app.get("/api/v1/records/eligibility", async (req, res) => {
    try {
      const { recordId, databaseName, collectionName, campaignType = "call" } = req.query

      if (!recordId || !databaseName || !collectionName) {
        return res.status(400).json({
          success: false,
          error: "recordId, databaseName, and collectionName are required",
        })
      }

      console.log(`🔍 Checking record eligibility: ${recordId} for ${campaignType} campaign`)

      const eligibility = await campaignCreationService.checkRecordEligibility(
        recordId,
        databaseName,
        collectionName,
        campaignType,
      )

      return res.json({
        success: true,
        message: "Record eligibility checked successfully",
        data: eligibility,
      })
    } catch (error) {
      console.error("❌ Error checking record eligibility:", error.message)
      return res.status(500).json({
        success: false,
        message: "Failed to check record eligibility",
        error: error.message,
      })
    }
  })

  // Get system configuration
  app.get("/api/v1/system/config", (req, res) => {
    res.json({
      success: true,
      message: "System configuration retrieved",
      data: {
        timezone: process.env.TZ,
        currentTime: new Date().toLocaleString("en-GB", { timeZone: "Europe/London" }),
        calls: {
          maxAttempts: OUTREACH_CONFIG.CALLS.MAX_ATTEMPTS,
          maxFutureDays: OUTREACH_CONFIG.CALLS.MAX_FUTURE_DAYS,
        },
        emails: {
          maxAttempts: OUTREACH_CONFIG.EMAILS.MAX_ATTEMPTS,
          maxFutureDays: OUTREACH_CONFIG.EMAILS.MAX_FUTURE_DAYS,
        },
        database: {
          trackingDbName: OUTREACH_CONFIG.DATABASE.TRACKING_DB_NAME,
          callCampaignsCollection: OUTREACH_CONFIG.DATABASE.CALL_CAMPAIGNS_COLLECTION,
          emailCampaignsCollection: OUTREACH_CONFIG.DATABASE.EMAIL_CAMPAIGNS_COLLECTION,
        },
      },
    })
  })

  // Get Kanban data for call campaigns
  app.get("/api/v1/kanban/calls", async (req, res) => {
    try {
      const { status, userId } = req.query

      const status_filter = await campaignCreationService.getCampaignStatus(null, "call")

      // Filter by status if provided
      let campaigns = status_filter.campaigns
      if (status) {
        campaigns = campaigns.filter((campaign) => campaign.overallStatus === status)
      }

      // Filter by userId if provided
      if (userId) {
        campaigns = campaigns.filter((campaign) => campaign.userId === userId)
      }

      return res.json({
        success: true,
        message: "Kanban call campaigns retrieved",
        data: {
          campaigns: campaigns,
          statusCounts: status_filter.statusCounts,
          totalCampaigns: campaigns.length,
        },
      })
    } catch (error) {
      console.error("❌ Error getting Kanban call campaigns:", error.message)
      return res.status(500).json({
        success: false,
        message: "Failed to get Kanban call campaigns",
        error: error.message,
      })
    }
  })

  // Get Kanban data for email campaigns
  app.get("/api/v1/kanban/emails", async (req, res) => {
    try {
      const { status, userId } = req.query

      const status_filter = await campaignCreationService.getCampaignStatus(null, "email")

      // Filter by status if provided
      let campaigns = status_filter.campaigns
      if (status) {
        campaigns = campaigns.filter((campaign) => campaign.overallStatus === status)
      }

      // Filter by userId if provided
      if (userId) {
        campaigns = campaigns.filter((campaign) => campaign.userId === userId)
      }

      return res.json({
        success: true,
        message: "Kanban email campaigns retrieved",
        data: {
          campaigns: campaigns,
          statusCounts: status_filter.statusCounts,
          totalCampaigns: campaigns.length,
        },
      })
    } catch (error) {
      console.error("❌ Error getting Kanban email campaigns:", error.message)
      return res.status(500).json({
        success: false,
        message: "Failed to get Kanban email campaigns",
        error: error.message,
      })
    }
  })

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({
      status: "OK",
      timezone: process.env.TZ,
      currentTime: new Date().toLocaleString("en-GB", {
        timeZone: "Europe/London",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      timestamp: new Date().toISOString(),
      environment: {
        // Account 1 (Agent 1)
        elevenLabsAccount1Configured: !!process.env.ELEVEN_LABS_API_KEY_1,
        agent1Configured: !!process.env.ELEVEN_LABS_AGENT_ID_1,
        phoneNumber1Configured: !!process.env.ELEVEN_LABS_PHONE_NUMBER_ID_1,

        // Account 2 (Agent 2)
        elevenLabsAccount2Configured: !!process.env.ELEVEN_LABS_API_KEY_2,
        agent2Configured: !!process.env.ELEVEN_LABS_AGENT_ID_2,
        phoneNumber2Configured: !!process.env.ELEVEN_LABS_PHONE_NUMBER_ID_2,

        zapierWebhookConfigured: !!process.env.ZAPIER_EMAIL_WEBHOOK_URL,
        geminiConfigured: !!process.env.GEMINI_API_KEY,
        mongodbConfigured: !!process.env.MONGODB_CONNECTION_STRING,
      },
      campaigns: {
        trackingDatabase: OUTREACH_CONFIG.DATABASE.TRACKING_DB_NAME,
        maxCallAttempts: OUTREACH_CONFIG.CALLS.MAX_ATTEMPTS,
        maxEmailAttempts: OUTREACH_CONFIG.EMAILS.MAX_ATTEMPTS,
        maxFutureDays: OUTREACH_CONFIG.CALLS.MAX_FUTURE_DAYS,
      },
    })
  })

  // Test endpoint
  app.get("/test", (req, res) => {
    console.log(`🧪 Test endpoint hit from ${req.ip}`)
    res.json({
      success: true,
      message: "Backend server is working!",
      timezone: process.env.TZ,
      currentTime: new Date().toLocaleString("en-GB", { timeZone: "Europe/London" }),
      timestamp: new Date().toISOString(),
      clientIP: req.ip,
      endpoints: [
        "POST /api/v1/campaigns/calls",
        "POST /api/v1/campaigns/emails",
        "GET /api/v1/campaigns/status",
        "GET /api/v1/records/status",
        "GET /api/v1/records/eligibility",
        "GET /api/v1/system/config",
        "GET /api/v1/kanban/calls",
        "GET /api/v1/kanban/emails",
        "GET /health",
        "GET /test",
      ],
    })
  })

  // 404 handler
  app.use((req, res) => {
    console.log(`❌ Unmatched route: ${req.method} ${req.originalUrl}`)
    res.status(404).json({
      error: "Route not found",
      method: req.method,
      url: req.originalUrl,
      availableRoutes: [
        "POST /api/v1/campaigns/calls",
        "POST /api/v1/campaigns/emails",
        "GET /api/v1/campaigns/status",
        "GET /api/v1/records/status",
        "GET /api/v1/records/eligibility",
        "GET /api/v1/system/config",
        "GET /api/v1/kanban/calls",
        "GET /api/v1/kanban/emails",
        "GET /health",
        "GET /test",
      ],
    })
  })

  // Start the server
  const PORT = process.env.PORT || (await findAvailablePort(8080))

  const startServer = async () => {
    try {
      const server = app.listen(PORT, "0.0.0.0", () => {
        console.log(`🚀 Backend server running on port ${PORT}`)
        console.log(`🌐 Access locally: http://localhost:${PORT}`)
        console.log(`🧪 Test endpoint: http://localhost:${PORT}/test`)
        console.log(`📊 Health check: http://localhost:${PORT}/health`)
        console.log(`🆕 API endpoints: /api/v1/campaigns/calls, /api/v1/campaigns/emails`)
        console.log(`📋 Kanban endpoints: /api/v1/kanban/calls, /api/v1/kanban/emails`)
        console.log(`🔍 NEW: Record status endpoints: /api/v1/records/status, /api/v1/records/eligibility`)
        console.log(
          `🇬🇧 Server running in UK timezone: ${new Date().toLocaleString("en-GB", { timeZone: "Europe/London" })}`,
        )
      })

      process.on("SIGINT", () => {
        console.log("Shutting down gracefully...")
        server.close(() => {
          process.exit(0)
        })
      })
    } catch (error) {
      console.error("Error starting server:", error)
    }
  }

  await startServer()

  console.log("\n🔧 Available Features:")
  console.log("1. 🆕 Enhanced Call Campaigns - Custom dates, times, and agent selection")
  console.log("2. 🆕 Enhanced Email Campaigns - Custom scheduling with filtered emails")
  console.log("3. 📊 Enhanced Campaign Tracking - Individual record status for Kanban")
  console.log("4. 📋 Kanban API Endpoints - Ready for frontend integration")
  console.log("5. ⚙️ Configurable Limits - Environment-driven attempt limits")
  console.log("6. 🗄️ Clean Database Structure - outreach_tracking with call_campaigns & email_campaigns")
  console.log("7. 🇬🇧 Native UK Time Support - No conversion needed!")
  console.log("8. 🚫 NEW: Duplicate Prevention - Records can't be added to campaigns twice")
  console.log("9. 📋 NEW: Record Status Tracking - Original documents updated with campaign status")
}

// Initialize the application
initializeApp().catch(console.error)
