import express from "express"
import dotenv from "dotenv"
import axios from "axios"
import { createServer } from "http"
import { connectToMongoDB } from "./database/mongodb.js"
import OutreachService from "./services/outreachService.js"
import ScheduledOutreachService from "./services/scheduledOutreachService.js"
import OUTREACH_CONFIG from "./config/constants.js"

// Load environment variables FIRST
dotenv.config()

// Check if required environment variables are present
const requiredEnvVars = [
  "ELEVEN_LABS_API_KEY",
  "ELEVEN_LABS_AGENT_ID",
  "ELEVEN_LABS_PHONE_NUMBER_ID",
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
const findAvailablePort = (startPort = 3000) => {
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
      apiKey: process.env.ELEVEN_LABS_API_KEY,
      agentId: process.env.ELEVEN_LABS_AGENT_ID,
      phoneNumberId: process.env.ELEVEN_LABS_PHONE_NUMBER_ID,
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
      apiKey: process.env.ELEVEN_LABS_API_KEY,
      agentId: process.env.ELEVEN_LABS_AGENT_ID,
      phoneNumberId: process.env.ELEVEN_LABS_PHONE_NUMBER_ID,
    },
    {
      apiKey: process.env.GEMINI_API_KEY,
    },
    {
      webhookUrl: process.env.ZAPIER_EMAIL_WEBHOOK_URL,
    },
  )

  // Initialize scheduled outreach service
  await scheduledOutreachService.initialize()

  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  // Function to fetch conversation details
  const fetchConversationDetails = async (conversationId) => {
    try {
      const cleanConversationId = conversationId.replace(/^:+/, "")
      console.log(`🔍 Fetching conversation details for ID: ${cleanConversationId}`)

      const response = await axios.get(`https://api.elevenlabs.io/v1/convai/conversations/${cleanConversationId}`, {
        headers: {
          "xi-api-key": process.env.ELEVEN_LABS_API_KEY,
        },
      })

      const conversationData = response.data
      console.log("✅ Conversation details fetched successfully")

      const dataCollectionResults = conversationData.analysis?.data_collection_results || {}
      const isPartneredWithInfinityClub = dataCollectionResults.isTheRestaurantPartneredWithInfinityClub?.value || null

      return {
        conversationId: conversationData.conversation_id,
        status: conversationData.status,
        callSuccessful: conversationData.analysis?.call_successful === "success",
        transcriptSummary: conversationData.analysis?.transcript_summary,
        callDuration: conversationData.metadata?.call_duration_secs,
        startTime: conversationData.metadata?.start_time_unix_secs,
        customFields: {
          isTheRestaurantPartneredWithInfinityClub: isPartneredWithInfinityClub,
        },
        dataCollectionResults: dataCollectionResults,
        transcript: conversationData.transcript || [],
        analysis: conversationData.analysis || null,
      }
    } catch (error) {
      console.error("❌ Error fetching conversation details:", error.response?.data || error.message)
      throw new Error(`Failed to fetch conversation details: ${error.response?.data?.detail || error.message}`)
    }
  }

  // NEW: Start scheduled call campaign
  app.post("/api/campaigns/calls/start", async (req, res) => {
    try {
      const { recordIds, databaseName, collectionName, userId } = req.body

      if (!recordIds || !Array.isArray(recordIds) || recordIds.length === 0) {
        return res.status(400).json({
          error: "recordIds array is required and must not be empty",
        })
      }

      if (!databaseName || !collectionName) {
        return res.status(400).json({
          error: "databaseName and collectionName are required",
        })
      }

      console.log(`🚀 Starting scheduled call campaign for ${recordIds.length} records`)

      const result = await scheduledOutreachService.startCallCampaign(
        databaseName,
        collectionName,
        recordIds,
        userId || "system",
      )

      return res.json({
        success: result.success,
        message: result.success ? `Scheduled call campaign started for ${result.recordsAdded} records` : result.message,
        data: {
          recordsAdded: result.recordsAdded || 0,
          databaseName: databaseName,
          collectionName: collectionName,
          schedule: OUTREACH_CONFIG.CALLS.SCHEDULE,
          maxAttempts: OUTREACH_CONFIG.CALLS.MAX_ATTEMPTS,
        },
      })
    } catch (error) {
      console.error("❌ Error starting scheduled call campaign:", error.message)
      return res.status(500).json({
        success: false,
        message: "Failed to start scheduled call campaign",
        error: error.message,
      })
    }
  })

  // NEW: Start email campaign
  app.post("/api/campaigns/emails/start", async (req, res) => {
    try {
      const { recordIds, databaseName, collectionName, userId } = req.body

      if (!recordIds || !Array.isArray(recordIds) || recordIds.length === 0) {
        return res.status(400).json({
          error: "recordIds array is required and must not be empty",
        })
      }

      if (!databaseName || !collectionName) {
        return res.status(400).json({
          error: "databaseName and collectionName are required",
        })
      }

      console.log(`📧 Starting email campaign for ${recordIds.length} records`)

      const result = await scheduledOutreachService.startEmailCampaign(
        databaseName,
        collectionName,
        recordIds,
        userId || "system",
      )

      return res.json({
        success: result.success,
        message: result.success ? `Email campaign started for ${result.recordsAdded} records` : result.message,
        data: {
          recordsAdded: result.recordsAdded || 0,
          databaseName: databaseName,
          collectionName: collectionName,
        },
      })
    } catch (error) {
      console.error("❌ Error starting email campaign:", error.message)
      return res.status(500).json({
        success: false,
        message: "Failed to start email campaign",
        error: error.message,
      })
    }
  })

  // NEW: Get campaign status
  app.get("/api/campaigns/status", async (req, res) => {
    try {
      const { recordIds } = req.query
      const recordIdArray = recordIds ? recordIds.split(",") : null

      const status = await scheduledOutreachService.getCampaignStatus(recordIdArray)

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

  // NEW: Get outreach configuration
  app.get("/api/campaigns/config", (req, res) => {
    res.json({
      success: true,
      message: "Outreach configuration retrieved",
      data: {
        calls: {
          schedule: OUTREACH_CONFIG.CALLS.SCHEDULE,
          maxAttempts: OUTREACH_CONFIG.CALLS.MAX_ATTEMPTS,
          processingDelay: OUTREACH_CONFIG.CALLS.PROCESSING_DELAY,
        },
        emails: {
          sendAfterCalls: OUTREACH_CONFIG.EMAILS.SEND_AFTER_CALLS,
          processingDelay: OUTREACH_CONFIG.EMAILS.PROCESSING_DELAY,
        },
        database: OUTREACH_CONFIG.DATABASE,
        workingHours: OUTREACH_CONFIG.WORKING_HOURS,
      },
    })
  })

  // Endpoint to initiate a call using Eleven Labs direct Twilio integration
  app.post("/api/call", async (req, res) => {
    try {
      const { phoneNumber } = req.body

      if (!phoneNumber) {
        return res.status(400).json({ error: "Phone number is required" })
      }

      console.log(`🚀 Initiating call to ${phoneNumber} via Eleven Labs Twilio integration`)

      const response = await axios.post(
        "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
        {
          agent_id: process.env.ELEVEN_LABS_AGENT_ID,
          agent_phone_number_id: process.env.ELEVEN_LABS_PHONE_NUMBER_ID,
          to_number: phoneNumber,
        },
        {
          headers: {
            "xi-api-key": process.env.ELEVEN_LABS_API_KEY,
            "Content-Type": "application/json",
          },
        },
      )

      console.log("✅ Call initiated successfully via Eleven Labs:", response.data)

      return res.json({
        success: true,
        message: "Call initiated successfully",
        callSid: response.data.callSid,
        conversationId: response.data.conversation_id,
      })
    } catch (error) {
      console.error("❌ Error initiating call:", error.response?.data || error.message)
      return res.status(500).json({
        success: false,
        message: "Failed to initiate call",
        error: error.response?.data || error.message,
      })
    }
  })

  // Endpoint to get conversation details and custom field data
  app.get("/api/conversation/:conversationId", async (req, res) => {
    try {
      const { conversationId } = req.params

      if (!conversationId) {
        return res.status(400).json({ error: "Conversation ID is required" })
      }

      const conversationDetails = await fetchConversationDetails(conversationId)

      return res.json({
        success: true,
        message: "Conversation details retrieved successfully",
        data: conversationDetails,
      })
    } catch (error) {
      console.error("❌ Error fetching conversation details:", error.message)
      return res.status(500).json({
        success: false,
        message: "Failed to fetch conversation details",
        error: error.message,
      })
    }
  })

  // Endpoint to check if restaurant is partnered with Infinity Club
  app.get("/api/conversation/:conversationId/infinity-club-status", async (req, res) => {
    try {
      const { conversationId } = req.params

      if (!conversationId) {
        return res.status(400).json({ error: "Conversation ID is required" })
      }

      const conversationDetails = await fetchConversationDetails(conversationId)
      const isPartnered = conversationDetails.customFields.isTheRestaurantPartneredWithInfinityClub

      return res.json({
        success: true,
        message: "Infinity Club partnership status retrieved",
        data: {
          conversationId: conversationId,
          isTheRestaurantPartneredWithInfinityClub: isPartnered,
          callStatus: conversationDetails.status,
          callSuccessful: conversationDetails.callSuccessful,
          callDuration: conversationDetails.callDuration,
        },
      })
    } catch (error) {
      console.error("❌ Error checking Infinity Club status:", error.message)
      return res.status(500).json({
        success: false,
        message: "Failed to check Infinity Club partnership status",
        error: error.message,
      })
    }
  })

  // Enhanced test page with new campaign functionality
  app.get("/", (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>AI-Powered Outreach System with Scheduled Campaigns</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 1400px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
        .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin-bottom: 20px; }
        h1, h2 { text-align: center; color: #333; }
        input, button, textarea, select { padding: 12px; margin: 10px 0; width: 100%; box-sizing: border-box; border-radius: 5px; border: 1px solid #ddd; }
        button { background: #007bff; color: white; border: none; cursor: pointer; font-size: 16px; }
        button:hover { background: #0056b3; }
        .result { margin-top: 20px; padding: 15px; border-radius: 5px; word-wrap: break-word; max-height: 300px; overflow-y: auto; }
        .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .info { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; padding: 10px; border-radius: 5px; margin-bottom: 20px; }
        .warning { background: #fff3cd; color: #856404; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .campaign-btn { background: #28a745; }
        .campaign-btn:hover { background: #218838; }
        .email-campaign-btn { background: #ffc107; color: #333; }
        .email-campaign-btn:hover { background: #e0a800; }
        .status-btn { background: #17a2b8; }
        .status-btn:hover { background: #138496; }
        .legacy-btn { background: #6c757d; }
        .legacy-btn:hover { background: #545b62; }
        label { font-weight: bold; display: block; margin-top: 10px; }
        .feature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .three-col { grid-template-columns: 1fr 1fr 1fr; }
        @media (max-width: 768px) { .feature-grid { grid-template-columns: 1fr; } }
        .campaign-section { background: #e8f5e8; border: 2px solid #28a745; }
        .legacy-section { background: #f8f9fa; border: 2px solid #6c757d; }
        .config-info { background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px; font-family: monospace; font-size: 12px; }
        .highlight { background: #fff3cd; padding: 10px; border-radius: 5px; margin: 10px 0; border-left: 4px solid #ffc107; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 AI-Powered Outreach System with Scheduled Campaigns</h1>
        
        <div class="warning">
            <strong>⚠️ IMPORTANT:</strong> Use the <strong>"Scheduled Call Campaign"</strong> section below for proper 4-call sequences with 5-minute delays and emails after completion.
        </div>
        
        <div class="info">
            <strong>📋 System Status:</strong><br>
            ✅ Eleven Labs API: ${!!process.env.ELEVEN_LABS_API_KEY ? "Connected" : "NOT SET"}<br>
            ✅ Gemini AI: ${!!process.env.GEMINI_API_KEY ? "Connected" : "NOT SET"}<br>
            ✅ Zapier Webhook: ${!!process.env.ZAPIER_EMAIL_WEBHOOK_URL ? "Configured" : "NOT SET"}<br>
            🗄️ MongoDB: ${!!process.env.MONGODB_CONNECTION_STRING ? "Connected" : "NOT SET"}<br>
            📊 Tracking Database: ${OUTREACH_CONFIG.DATABASE.TRACKING_DB_NAME}
        </div>

        <div class="config-info">
            <strong>⚙️ Current Configuration:</strong><br>
            Call Schedule: ${JSON.stringify(OUTREACH_CONFIG.CALLS.SCHEDULE)}<br>
            Max Call Attempts: ${OUTREACH_CONFIG.CALLS.MAX_ATTEMPTS}<br>
            Processing Delay: ${OUTREACH_CONFIG.CALLS.PROCESSING_DELAY / 1000} seconds (${OUTREACH_CONFIG.CALLS.PROCESSING_DELAY / 60000} minutes)<br>
            Send Email After Calls: ${OUTREACH_CONFIG.EMAILS.SEND_AFTER_CALLS}<br>
            Working Hours: ${OUTREACH_CONFIG.WORKING_HOURS.START}:00 - ${OUTREACH_CONFIG.WORKING_HOURS.END}:00
        </div>

        <div class="config-info">
            <strong>📋 How Scheduled Campaigns Work:</strong><br>
            1. Records are added to tracking database (${OUTREACH_CONFIG.DATABASE.TRACKING_DB_NAME})<br>
            2. System checks every 60 seconds for records ready to be called<br>
            3. Calls are made according to schedule with 5-minute delays between records<br>
            4. After ALL 4 calls are completed, emails are sent to all addresses in contactInfo<br>
            5. Fresh contact info is fetched from main database before each attempt
        </div>
    </div>

    <div class="container campaign-section">
        <h2>🎯 Scheduled Campaign Management (RECOMMENDED)</h2>
        <div class="highlight">
            <strong>✅ Use This Section:</strong> For proper scheduled campaigns with 4 calls + emails after completion
        </div>
        <div class="feature-grid">
            <div>
                <h3>📞 Scheduled Call Campaign</h3>
                <form id="callCampaignForm">
                    <label for="callRecordIds">Record IDs (one per line):</label>
                    <textarea id="callRecordIds" rows="4" placeholder="683afcfca4a0cafbf8f6fd29
683afc55a4a0cafbf8f6fd28" required></textarea>
                    <label for="callDatabaseName">Database Name:</label>
                    <input type="text" id="callDatabaseName" placeholder="e.g., Manchester" required>
                    <label for="callCollectionName">Collection Name:</label>
                    <input type="text" id="callCollectionName" placeholder="e.g., restaurants" required>
                    <label for="callUserId">User ID (optional):</label>
                    <input type="text" id="callUserId" placeholder="e.g., user123">
                    <button type="submit" class="campaign-btn">📞 Start Scheduled Call Campaign</button>
                </form>
                <div id="callCampaignResult" class="result"></div>
            </div>
            
            <div>
                <h3>📧 Email Campaign</h3>
                <form id="emailCampaignForm">
                    <label for="emailRecordIds">Record IDs (one per line):</label>
                    <textarea id="emailRecordIds" rows="4" placeholder="683afcfca4a0cafbf8f6fd29
683afc55a4a0cafbf8f6fd28" required></textarea>
                    <label for="emailDatabaseName">Database Name:</label>
                    <input type="text" id="emailDatabaseName" placeholder="e.g., Manchester" required>
                    <label for="emailCollectionName">Collection Name:</label>
                    <input type="text" id="emailCollectionName" placeholder="e.g., restaurants" required>
                    <label for="emailUserId">User ID (optional):</label>
                    <input type="text" id="emailUserId" placeholder="e.g., user123">
                    <button type="submit" class="email-campaign-btn">📧 Start Email Campaign</button>
                </form>
                <div id="emailCampaignResult" class="result"></div>
            </div>
        </div>
        
        <div style="margin-top: 20px;">
            <h3>📊 Campaign Status</h3>
            <form id="statusForm">
                <label for="statusRecordIds">Record IDs (optional, comma-separated):</label>
                <input type="text" id="statusRecordIds" placeholder="Leave empty for all campaigns">
                <button type="submit" class="status-btn">📊 Get Campaign Status</button>
            </form>
            <div id="statusResult" class="result"></div>
        </div>
    </div>

    <script>
        // Scheduled Campaign form handlers
        document.getElementById('callCampaignForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const recordIdsText = document.getElementById('callRecordIds').value;
            const databaseName = document.getElementById('callDatabaseName').value;
            const collectionName = document.getElementById('callCollectionName').value;
            const userId = document.getElementById('callUserId').value;
            const resultDiv = document.getElementById('callCampaignResult');
            const button = e.target.querySelector('button');
            
            const recordIds = recordIdsText.split('\\n').map(id => id.trim()).filter(id => id.length > 0);
            
            if (recordIds.length === 0) {
                alert('Please enter at least one record ID');
                return;
            }
            
            button.disabled = true;
            button.textContent = '📞 Starting Campaign...';
            resultDiv.innerHTML = \`Starting scheduled call campaign for \${recordIds.length} records...\`;
            resultDiv.className = 'result info';

            try {
                const response = await fetch('/api/campaigns/calls/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recordIds, databaseName, collectionName, userId })
                });
                const data = await response.json();
                resultDiv.className = data.success ? 'result success' : 'result error';
                if (data.success) {
                    resultDiv.innerHTML = \`✅ Scheduled call campaign started!<br>
                        <strong>Records Added to Tracking:</strong> \${data.data.recordsAdded}<br>
                        <strong>Database:</strong> \${data.data.databaseName}<br>
                        <strong>Collection:</strong> \${data.data.collectionName}<br>
                        <strong>Schedule:</strong> \${JSON.stringify(data.data.schedule)}<br>
                        <strong>Max Attempts:</strong> \${data.data.maxAttempts}<br>
                        <br>📝 <strong>Note:</strong> Records added to tracking database. System will process them according to schedule with 5-minute delays.\`;
                } else {
                    resultDiv.innerHTML = \`❌ Campaign failed to start: \${data.message}\`;
                }
            } catch (error) {
                resultDiv.className = 'result error';
                resultDiv.innerHTML = \`❌ Network error: \${error.message}\`;
            } finally {
                button.disabled = false;
                button.textContent = '📞 Start Scheduled Call Campaign';
            }
        });

        document.getElementById('emailCampaignForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const recordIdsText = document.getElementById('emailRecordIds').value;
            const databaseName = document.getElementById('emailDatabaseName').value;
            const collectionName = document.getElementById('emailCollectionName').value;
            const userId = document.getElementById('emailUserId').value;
            const resultDiv = document.getElementById('emailCampaignResult');
            const button = e.target.querySelector('button');
            
            const recordIds = recordIdsText.split('\\n').map(id => id.trim()).filter(id => id.length > 0);
            
            if (recordIds.length === 0) {
                alert('Please enter at least one record ID');
                return;
            }
            
            button.disabled = true;
            button.textContent = '📧 Starting Campaign...';
            resultDiv.innerHTML = \`Starting email campaign for \${recordIds.length} records...\`;
            resultDiv.className = 'result info';

            try {
                const response = await fetch('/api/campaigns/emails/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recordIds, databaseName, collectionName, userId })
                });
                const data = await response.json();
                resultDiv.className = data.success ? 'result success' : 'result error';
                if (data.success) {
                    resultDiv.innerHTML = \`✅ Email campaign started!<br>
                        <strong>Records Added to Tracking:</strong> \${data.data.recordsAdded}<br>
                        <strong>Database:</strong> \${data.data.databaseName}<br>
                        <strong>Collection:</strong> \${data.data.collectionName}<br>
                        <br>📝 <strong>Note:</strong> Emails will be sent immediately.\`;
                } else {
                    resultDiv.innerHTML = \`❌ Campaign failed to start: \${data.message}\`;
                }
            } catch (error) {
                resultDiv.className = 'result error';
                resultDiv.innerHTML = \`❌ Network error: \${error.message}\`;
            } finally {
                button.disabled = false;
                button.textContent = '📧 Start Email Campaign';
            }
        });

        document.getElementById('statusForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const recordIds = document.getElementById('statusRecordIds').value;
            const resultDiv = document.getElementById('statusResult');
            const button = e.target.querySelector('button');
            
            button.disabled = true;
            button.textContent = '📊 Loading...';
            resultDiv.innerHTML = 'Fetching campaign status...';
            resultDiv.className = 'result info';

            try {
                const url = \`/api/campaigns/status\${recordIds ? \`?recordIds=\${recordIds}\` : ''}\`;
                const response = await fetch(url);
                const data = await response.json();
                resultDiv.className = data.success ? 'result success' : 'result error';
                if (data.success) {
                    const status = data.data;
                    let statusHtml = \`✅ Campaign Status Retrieved!<br><br>
                        <strong>Total Active Campaigns:</strong> \${status.totalActive}<br>
                        <strong>Active Call Campaigns:</strong> \${status.callCampaigns.length}<br>
                        <strong>Active Email Campaigns:</strong> \${status.emailCampaigns.length}<br><br>\`;
                    
                    if (status.callCampaigns.length > 0) {
                        statusHtml += '<strong>Call Campaigns:</strong><br>';
                        status.callCampaigns.forEach((campaign, index) => {
                            const nextCall = campaign.nextCallTime ? new Date(campaign.nextCallTime).toLocaleString() : 'No more calls';
                            statusHtml += \`\${index + 1}. \${campaign.businessName} - Status: \${campaign.status}, Attempt: \${campaign.currentAttempt}/\${campaign.maxAttempts}, Next Call: \${nextCall}<br>\`;
                        });
                        statusHtml += '<br>';
                    }
                    
                    if (status.emailCampaigns.length > 0) {
                        statusHtml += '<strong>Email Campaigns:</strong><br>';
                        status.emailCampaigns.forEach((campaign, index) => {
                            statusHtml += \`\${index + 1}. \${campaign.businessName} - Status: \${campaign.status}<br>\`;
                        });
                    }
                    
                    resultDiv.innerHTML = statusHtml;
                } else {
                    resultDiv.innerHTML = \`❌ Error fetching status: \${data.error}\`;
                }
            } catch (error) {
                resultDiv.className = 'result error';
                resultDiv.innerHTML = \`❌ Network error: \${error.message}\`;
            } finally {
                button.disabled = false;
                button.textContent = '📊 Get Campaign Status';
            }
        });
    </script>
</body>
</html>
    `)
  })

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      environment: {
        elevenLabsConfigured: !!process.env.ELEVEN_LABS_API_KEY,
        agentConfigured: !!process.env.ELEVEN_LABS_AGENT_ID,
        phoneNumberConfigured: !!process.env.ELEVEN_LABS_PHONE_NUMBER_ID,
        zapierWebhookConfigured: !!process.env.ZAPIER_EMAIL_WEBHOOK_URL,
        geminiConfigured: !!process.env.GEMINI_API_KEY,
        mongodbConfigured: !!process.env.MONGODB_CONNECTION_STRING,
      },
      campaigns: {
        trackingDatabase: OUTREACH_CONFIG.DATABASE.TRACKING_DB_NAME,
        callSchedule: OUTREACH_CONFIG.CALLS.SCHEDULE,
        maxCallAttempts: OUTREACH_CONFIG.CALLS.MAX_ATTEMPTS,
      },
    })
  })

  // Start the server
  const PORT = await findAvailablePort(Number.parseInt(process.env.PORT) || 3000)

  const startServer = async () => {
    try {
      const server = app.listen(PORT, "0.0.0.0", () => {
        console.log(`🚀 Server running on port ${PORT}`)
        console.log(`🌐 Access locally: http://localhost:${PORT}`)
        console.log(`🌐 Access from network: http://YOUR_VM_IP:${PORT}`)
        console.log(`🌐 Server is accepting connections from any IP address`)
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
  console.log("1. 📞 Scheduled Call Campaigns - Multiple attempts with configurable timing")
  console.log("2. 📧 Email Campaigns - Immediate email sending")
  console.log("3. 📊 Campaign Tracking - Real-time status monitoring")
  console.log("4. ⚙️ Configurable Scheduling - Easy testing and production modes")
  console.log("5. 🗄️ Dual Database System - Main records + tracking collections")
  console.log("6. 🔄 Automatic Processing Loop - Background campaign execution")
}

// Initialize the application
initializeApp().catch(console.error)
