import OutreachService from "./outreachService.js"
import { getCollection, toObjectId } from "../database/mongodb.js"
import OUTREACH_CONFIG from "../config/constants.js"
import chalk from "chalk"

export class ScheduledOutreachService {
  constructor(elevenLabsConfig, geminiConfig, zapierConfig) {
    this.outreachService = new OutreachService(elevenLabsConfig, geminiConfig, zapierConfig)
    this.isProcessing = false
    this.schedulerInterval = null
    this.activeCallPromises = new Map() // Track active calls to prevent duplicates
    this.trackingDbName = OUTREACH_CONFIG.DATABASE.TRACKING_DB_NAME
    this.callCampaignsCollection = OUTREACH_CONFIG.DATABASE.CALL_CAMPAIGNS_COLLECTION
    this.emailCampaignsCollection = OUTREACH_CONFIG.DATABASE.EMAIL_CAMPAIGNS_COLLECTION
  }

  // Initialize the service
  async initialize() {
    await this.initializeTrackingCollections()
    console.log(chalk.green("✅ Scheduled Outreach Service initialized"))

    // Start the independent scheduler
    this.startIndependentScheduler()
  }

  // Initialize tracking collections (create if they don't exist)
  async initializeTrackingCollections() {
    try {
      console.log(chalk.blue("🔧 Initializing tracking collections..."))

      // Initialize call_campaigns collection
      const callCollection = getCollection(this.trackingDbName, this.callCampaignsCollection)
      await callCollection.createIndex({ originalRecordId: 1 })
      await callCollection.createIndex({ userId: 1 })
      await callCollection.createIndex({ overallStatus: 1 })
      await callCollection.createIndex({ "campaignConfig.attempts.scheduledAt": 1 })
      await callCollection.createIndex({ createdAt: 1 })

      // Initialize email_campaigns collection
      const emailCollection = getCollection(this.trackingDbName, this.emailCampaignsCollection)
      await emailCollection.createIndex({ originalRecordId: 1 })
      await emailCollection.createIndex({ userId: 1 })
      await emailCollection.createIndex({ overallStatus: 1 })
      await emailCollection.createIndex({ "emailConfig.scheduledAt": 1 })
      await emailCollection.createIndex({ createdAt: 1 })

      const callCount = await callCollection.countDocuments({})
      const emailCount = await emailCollection.countDocuments({})

      console.log(chalk.green(`✅ Tracking collections initialized:`))
      console.log(chalk.white(`   ${this.callCampaignsCollection}: ${callCount} records`))
      console.log(chalk.white(`   ${this.emailCampaignsCollection}: ${emailCount} records`))
    } catch (error) {
      console.error(chalk.red("❌ Error initializing tracking collections:"), error.message)
      throw error
    }
  }

  // Start scheduled call campaign (legacy compatibility - not used in new system)
  async startCallCampaign(databaseName, collectionName, recordIds, userId = "system") {
    try {
      console.log(chalk.cyan(`🚀 Legacy call campaign not supported - use new API endpoints instead`))
      return {
        success: false,
        message: "Legacy call campaigns deprecated. Use /api/v1/campaigns/calls endpoint instead.",
        recordsAdded: 0,
      }
    } catch (error) {
      console.error(chalk.red("❌ Error in legacy call campaign:"), error.message)
      throw error
    }
  }

  // Start email campaign (instant sending) - legacy compatibility
  async startEmailCampaign(databaseName, collectionName, recordIds, userId = "system") {
    try {
      console.log(chalk.cyan(`📧 Starting instant email campaign for ${recordIds.length} records`))

      const mainCollection = getCollection(databaseName, collectionName)
      const results = []

      for (const recordId of recordIds) {
        try {
          const objectId = await toObjectId(recordId)
          const mainRecord = await mainCollection.findOne({ _id: objectId })

          if (!mainRecord) {
            console.log(chalk.yellow(`⚠️ Record ${recordId} not found`))
            results.push({ recordId, success: false, reason: "Record not found" })
            continue
          }

          // Use contactInfo for emails
          const contactInfo = mainRecord.outreach?.contactInfo || { emails: [] }
          const emailAddresses = contactInfo.emails || []

          if (emailAddresses.length === 0) {
            console.log(chalk.yellow(`⚠️ No email addresses for ${mainRecord.businessname}`))
            results.push({ recordId, success: false, reason: "No email addresses" })
            continue
          }

          // Generate and send emails instantly
          const emailData = await this.outreachService.generatePersonalizedEmail(mainRecord.businessname)

          for (let i = 0; i < emailAddresses.length; i++) {
            const emailAddress = emailAddresses[i]
            try {
              console.log(chalk.blue(`📧 Sending instant email ${i + 1}/${emailAddresses.length} to ${emailAddress}`))
              const result = await this.outreachService.sendEmail(emailAddress, emailData, mainRecord.businessname)

              if (i < emailAddresses.length - 1) {
                console.log(
                  chalk.yellow(`⏳ Waiting ${OUTREACH_CONFIG.EMAILS.EMAIL_DELAY_SECONDS} seconds before next email...`),
                )
                await new Promise((resolve) => setTimeout(resolve, OUTREACH_CONFIG.EMAILS.EMAIL_DELAY_SECONDS * 1000))
              }
            } catch (emailError) {
              console.error(chalk.red(`❌ Error sending email to ${emailAddress}:`), emailError.message)
            }
          }

          // UPDATED: Update email-specific status instead of general outreach status
          await mainCollection.updateOne(
            { _id: objectId },
            {
              $set: {
                "outreach.email.lastEmailStatus": "sent",
                "outreach.email.emailsSentCount": emailAddresses.length,
                "outreach.email.lastEmailAt": new Date(),
                "outreach.email.lastEmailSubject": emailData.subject,
                "outreach.email.campaignStatus": "completed", // NEW: Email campaign specific status
                "outreach.lastUpdatedAt": new Date(),
              },
            },
          )

          results.push({ recordId, success: true, emailsSent: emailAddresses.length })
          console.log(chalk.green(`✅ Instant emails sent for ${mainRecord.businessname}`))
        } catch (error) {
          console.error(chalk.red(`❌ Error processing email for ${recordId}:`), error.message)
          results.push({ recordId, success: false, reason: error.message })
        }
      }

      const successCount = results.filter((r) => r.success).length

      return {
        success: successCount > 0,
        recordsProcessed: results.length,
        recordsSuccess: successCount,
        recordsFailed: results.length - successCount,
        results: results,
      }
    } catch (error) {
      console.error(chalk.red("❌ Error starting email campaign:"), error.message)
      throw error
    }
  }

  // Independent scheduler that runs continuously
  async startIndependentScheduler() {
    if (!OUTREACH_CONFIG.CALLS.SCHEDULER.ENABLED) {
      console.log(chalk.yellow("⚠️ Scheduler is disabled in configuration"))
      return
    }

    console.log(chalk.cyan("🕐 Starting independent scheduler..."))
    console.log(chalk.white(`   Check interval: ${OUTREACH_CONFIG.CALLS.SCHEDULER.CHECK_INTERVAL_MINUTES} minute(s)`))

    const checkInterval = OUTREACH_CONFIG.CALLS.SCHEDULER.CHECK_INTERVAL_MINUTES * 60 * 1000

    this.schedulerInterval = setInterval(async () => {
      try {
        await this.processScheduledTasks()
      } catch (error) {
        console.error(chalk.red("❌ Error in scheduler:"), error.message)
      }
    }, checkInterval)

    // Run immediately on start
    setTimeout(() => this.processScheduledTasks(), 5000) // Wait 5 seconds after startup
  }

  // Process all scheduled tasks
  async processScheduledTasks() {
    try {
      const ukTime = new Date().toLocaleString("en-GB", {
        timeZone: "Europe/London",
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
      console.log(chalk.gray(`🕐 ${ukTime} (UK) - Checking for scheduled tasks...`))

      // Process NEW system call campaigns
      await this.processNewCallCampaigns()

      // Process NEW system email campaigns
      await this.processNewEmailCampaigns()

      // NEW: Process scheduled emails within call campaigns
      await this.processScheduledEmailsInCallCampaigns()
    } catch (error) {
      console.error(chalk.red("❌ Error processing scheduled tasks:"), error.message)
    }
  }

  // NEW: Process scheduled emails within call campaigns
  async processScheduledEmailsInCallCampaigns() {
    try {
      const callCampaignsCollection = getCollection(this.trackingDbName, this.callCampaignsCollection)
      const now = new Date()

      // Find call campaigns with scheduled emails that are ready
      const campaignsWithScheduledEmails = await callCampaignsCollection
        .find({
          "emailConfig.enabled": true,
          "emailConfig.scheduledAt": { $lte: now },
          "emailConfig.status": "pending",
          overallStatus: { $in: ["calls_completed", "completed"] }, // Only after calls are done
        })
        .toArray()

      if (campaignsWithScheduledEmails.length > 0) {
        console.log(
          chalk.blue(`📧 Processing ${campaignsWithScheduledEmails.length} scheduled emails in call campaigns`),
        )

        for (const campaign of campaignsWithScheduledEmails) {
          try {
            await this.executeScheduledEmailInCallCampaign(campaign)
          } catch (error) {
            console.error(chalk.red(`❌ Error executing scheduled email for campaign ${campaign._id}:`), error.message)
          }
        }
      }
    } catch (error) {
      console.error(chalk.red("❌ Error processing scheduled emails in call campaigns:"), error.message)
    }
  }

  // Execute scheduled email within a call campaign
  async executeScheduledEmailInCallCampaign(campaign) {
    try {
      console.log(chalk.blue(`📧 Executing scheduled email for ${campaign.recordData.businessname}`))

      const businessName = campaign.recordData.businessname
      const emailAddresses = campaign.emailConfig.emailAddresses || []

      if (emailAddresses.length === 0) {
        console.log(chalk.yellow(`⚠️ No email addresses for ${businessName}, marking as completed`))
        await this.updateEmailConfigStatus(campaign._id, "completed", "No email addresses")
        return
      }

      // Mark email as in progress
      await this.updateEmailConfigStatus(campaign._id, "in_progress")

      // Generate email
      const emailData = await this.outreachService.generatePersonalizedEmail(businessName)

      let totalSent = 0
      const totalAttempted = emailAddresses.length

      // Send emails with delay
      for (let i = 0; i < emailAddresses.length; i++) {
        const emailAddress = emailAddresses[i]
        try {
          console.log(chalk.blue(`📧 Sending scheduled email ${i + 1}/${emailAddresses.length} to ${emailAddress}`))
          const result = await this.outreachService.sendEmail(emailAddress, emailData, businessName)

          if (result.success) {
            totalSent++
          }

          if (i < emailAddresses.length - 1) {
            console.log(
              chalk.yellow(`⏳ Waiting ${OUTREACH_CONFIG.EMAILS.EMAIL_DELAY_SECONDS} seconds before next email...`),
            )
            await new Promise((resolve) => setTimeout(resolve, OUTREACH_CONFIG.EMAILS.EMAIL_DELAY_SECONDS * 1000))
          }
        } catch (error) {
          console.error(chalk.red(`❌ Error sending email to ${emailAddress}:`), error.message)
        }
      }

      // Update email config with results
      await this.updateEmailConfigResults(campaign._id, {
        totalSent,
        totalAttempted,
        subject: emailData.subject,
        success: totalSent > 0,
      })

      // UPDATED: Update original record with email-specific status
      await this.updateOriginalRecord(
        campaign,
        {
          totalSent,
          totalAttempted,
          subject: emailData.subject,
          success: totalSent > 0,
        },
        "email",
      )

      // Mark email as completed
      await this.updateEmailConfigStatus(campaign._id, totalSent > 0 ? "completed" : "failed")

      // Update overall campaign status to completed
      await this.updateCampaignStatus(campaign._id, "completed", "call")

      console.log(chalk.green(`✅ Scheduled email completed for ${businessName} (${totalSent}/${totalAttempted} sent)`))
    } catch (error) {
      console.error(chalk.red(`❌ Error executing scheduled email for campaign ${campaign._id}:`), error.message)
      await this.updateEmailConfigStatus(campaign._id, "failed", error.message)
    }
  }

  // Update email config status within call campaign
  async updateEmailConfigStatus(campaignId, status, error = null) {
    try {
      const callCampaignsCollection = getCollection(this.trackingDbName, this.callCampaignsCollection)
      const objectId = await toObjectId(campaignId)

      const updateData = {
        $set: {
          "emailConfig.status": status,
          "emailConfig.executedAt": new Date(),
          updatedAt: new Date(),
        },
      }

      if (error) {
        updateData.$set["emailConfig.error"] = error
      }

      await callCampaignsCollection.updateOne({ _id: objectId }, updateData)
      console.log(chalk.green(`✅ Updated email config status to: ${status}`))
    } catch (error) {
      console.error(chalk.red(`❌ Error updating email config status:`), error.message)
    }
  }

  // Update email config results within call campaign
  async updateEmailConfigResults(campaignId, emailResults) {
    try {
      const callCampaignsCollection = getCollection(this.trackingDbName, this.callCampaignsCollection)
      const objectId = await toObjectId(campaignId)

      const updateData = {
        $set: {
          "emailConfig.results": emailResults,
          "emailConfig.executedAt": new Date(),
          updatedAt: new Date(),
        },
      }

      await callCampaignsCollection.updateOne({ _id: objectId }, updateData)
    } catch (error) {
      console.error(chalk.red(`❌ Error updating email config results:`), error.message)
    }
  }

  // Process NEW system call campaigns
  async processNewCallCampaigns() {
    try {
      const readyCallCampaigns = await this.getReadyCallCampaigns()

      if (readyCallCampaigns.length === 0) {
        return
      }

      console.log(chalk.blue(`🆕 Processing ${readyCallCampaigns.length} new call campaigns`))

      // Process campaigns concurrently
      const campaignPromises = readyCallCampaigns.map(async (campaign) => {
        try {
          await this.executeCallCampaign(campaign)
        } catch (error) {
          console.error(chalk.red(`❌ Error executing call campaign ${campaign._id}:`), error.message)
        }
      })

      await Promise.all(campaignPromises)
    } catch (error) {
      console.error(chalk.red("❌ Error processing new call campaigns:"), error.message)
    }
  }

  // Process NEW system email campaigns
  async processNewEmailCampaigns() {
    try {
      const readyEmailCampaigns = await this.getReadyEmailCampaigns()

      if (readyEmailCampaigns.length === 0) {
        return
      }

      console.log(chalk.blue(`🆕 Processing ${readyEmailCampaigns.length} new email campaigns`))

      // Process campaigns concurrently
      const campaignPromises = readyEmailCampaigns.map(async (campaign) => {
        try {
          await this.executeEmailCampaign(campaign)
        } catch (error) {
          console.error(chalk.red(`❌ Error executing email campaign ${campaign._id}:`), error.message)
        }
      })

      await Promise.all(campaignPromises)
    } catch (error) {
      console.error(chalk.red("❌ Error processing new email campaigns:"), error.message)
    }
  }

  // Get ready call campaigns from call_campaigns collection
  async getReadyCallCampaigns() {
    try {
      const callCampaignsCollection = getCollection(this.trackingDbName, this.callCampaignsCollection)

      const now = new Date() // This is now UK time!
      console.log(chalk.gray(`🕐 Current UK time: ${now.toLocaleString("en-GB", { timeZone: "Europe/London" })}`))

      // First, let's get all campaigns and examine their data types
      const allCampaigns = await callCampaignsCollection.find({}).toArray()
      console.log(chalk.gray(`📊 Total campaigns in database: ${allCampaigns.length}`))

      // Debug: Show detailed information about each campaign
      allCampaigns.forEach((campaign, index) => {
        console.log(chalk.gray(`   Campaign ${index + 1}:`))
        console.log(chalk.gray(`     Business: ${campaign.recordData.businessname}`))
        console.log(chalk.gray(`     Status: ${campaign.overallStatus}`))
        console.log(chalk.gray(`     Attempts:`))

        campaign.campaignConfig.attempts.forEach((attempt) => {
          const scheduledTime = new Date(attempt.scheduledAt)
          const isReady = scheduledTime <= now && attempt.status === "pending"
          const timeDiff = now.getTime() - scheduledTime.getTime()

          console.log(chalk.gray(`       Attempt ${attempt.attemptNumber}:`))
          console.log(chalk.gray(`         Status: ${attempt.status}`))
          console.log(
            chalk.gray(
              `         Scheduled: ${scheduledTime.toLocaleString("en-GB", { timeZone: "Europe/London" })} (UK)`,
            ),
          )
          console.log(chalk.gray(`         Time diff: ${timeDiff}ms (${Math.round(timeDiff / 1000)}s)`))
          console.log(chalk.gray(`         Ready: ${isReady}`))
        })
      })

      // Now try the MongoDB query with better error handling
      let readyCampaigns = []

      try {
        readyCampaigns = await callCampaignsCollection
          .find({
            overallStatus: { $in: ["scheduled", "in_progress"] },
            "campaignConfig.attempts": {
              $elemMatch: {
                status: "pending",
                scheduledAt: { $lte: now },
              },
            },
          })
          .toArray()

        console.log(chalk.blue(`🔍 MongoDB query found ${readyCampaigns.length} ready campaigns`))
      } catch (queryError) {
        console.error(chalk.red("❌ Error in MongoDB query:"), queryError.message)

        // Fallback: manually filter campaigns
        console.log(chalk.yellow("⚠️ Using manual filtering as fallback"))
        readyCampaigns = allCampaigns.filter((campaign) => {
          if (!["scheduled", "in_progress"].includes(campaign.overallStatus)) {
            return false
          }

          return campaign.campaignConfig.attempts.some((attempt) => {
            const scheduledTime = new Date(attempt.scheduledAt)
            return attempt.status === "pending" && scheduledTime <= now
          })
        })

        console.log(chalk.blue(`🔍 Manual filtering found ${readyCampaigns.length} ready campaigns`))
      }

      // Additional debugging for ready campaigns
      if (readyCampaigns.length > 0) {
        console.log(chalk.green(`✅ Ready campaigns found:`))
        readyCampaigns.forEach((campaign, index) => {
          const readyAttempts = campaign.campaignConfig.attempts.filter((attempt) => {
            const scheduledTime = new Date(attempt.scheduledAt)
            return attempt.status === "pending" && scheduledTime <= now
          })

          console.log(
            chalk.green(
              `   ${index + 1}. ${campaign.recordData.businessname} - ${readyAttempts.length} ready attempts`,
            ),
          )
        })
      }

      return readyCampaigns
    } catch (error) {
      console.error(chalk.red("❌ Error getting ready call campaigns:"), error.message)
      if (error.message.includes("ENOTFOUND") || error.message.includes("ECONNABORTED")) {
        console.log(chalk.yellow("⚠️ MongoDB connection issue - will retry on next scheduler run"))
      }
      return []
    }
  }

  // Get ready email campaigns from email_campaigns collection
  async getReadyEmailCampaigns() {
    try {
      const emailCampaignsCollection = getCollection(this.trackingDbName, this.emailCampaignsCollection)

      const now = new Date() // This is now UK time!

      // Find campaigns that are ready to execute
      const readyCampaigns = await emailCampaignsCollection
        .find({
          overallStatus: "scheduled",
          "emailConfig.scheduledAt": { $lte: now },
        })
        .toArray()

      return readyCampaigns
    } catch (error) {
      console.error(chalk.red("❌ Error getting ready email campaigns:"), error.message)
      if (error.message.includes("ENOTFOUND") || error.message.includes("ECONNABORTED")) {
        console.log(chalk.yellow("⚠️ MongoDB connection issue - will retry on next scheduler run"))
      }
      return []
    }
  }

  // Execute a call campaign
  async executeCallCampaign(campaign) {
    try {
      // Find the next pending attempt
      const now = new Date()
      const pendingAttempt = campaign.campaignConfig.attempts.find(
        (attempt) => attempt.status === "pending" && new Date(attempt.scheduledAt) <= now,
      )

      if (!pendingAttempt) {
        console.log(chalk.yellow(`⚠️ No ready attempts found for ${campaign.recordData.businessname}`))
        return
      }

      console.log(
        chalk.blue(
          `📞 Executing call attempt ${pendingAttempt.attemptNumber} for ${campaign.recordData.businessname} with agent ${pendingAttempt.agentId}`,
        ),
      )

      // Mark campaign as in progress
      await this.updateCampaignStatus(campaign._id, "in_progress", "call")

      // Mark attempt as in progress
      await this.updateAttemptStatus(campaign._id, pendingAttempt.attemptNumber, "in_progress", "call")

      // Get phone number
      const phoneNumber = campaign.recordData.phonenumber
      if (!phoneNumber) {
        throw new Error("No phone number found in campaign record")
      }

      const formattedPhone = this.outreachService.formatPhoneNumber(phoneNumber)
      const businessName = campaign.recordData.businessname

      // Make the call
      const callInitResult = await this.outreachService.initiateCall(
        formattedPhone,
        businessName,
        pendingAttempt.attemptNumber,
      )

      const callResults = await this.outreachService.waitForCallCompletion(
        callInitResult.conversationId,
        callInitResult.agentConfig,
      )

      // Update attempt with results
      await this.updateAttemptResults(campaign._id, pendingAttempt.attemptNumber, callResults, callInitResult, "call")

      // UPDATED: Update original record with call-specific status
      await this.updateOriginalRecord(campaign, callResults, "call")

      // Check if all attempts are completed
      const updatedCampaign = await this.getCampaignById(campaign._id, "call")
      const allAttemptsCompleted = updatedCampaign.campaignConfig.attempts.every(
        (attempt) => attempt.status === "completed" || attempt.status === "failed",
      )

      if (allAttemptsCompleted) {
        if (updatedCampaign.emailConfig.enabled) {
          if (updatedCampaign.emailConfig.scheduledAt) {
            // Emails are scheduled for a specific time
            await this.updateCampaignStatus(campaign._id, "calls_completed", "call")
            console.log(chalk.yellow(`📧 All calls completed for ${businessName}, emails scheduled for later`))
          } else {
            // Send emails immediately after calls
            await this.updateCampaignStatus(campaign._id, "calls_completed", "call")
            console.log(chalk.yellow(`📧 All calls completed for ${businessName}, emails will be sent next`))
          }
        } else {
          await this.updateCampaignStatus(campaign._id, "completed", "call")
          console.log(chalk.green(`✅ Campaign completed for ${businessName}`))
        }
      }

      console.log(chalk.green(`✅ Call attempt completed for ${businessName} using ${callInitResult.agentUsed}`))
    } catch (error) {
      console.error(chalk.red(`❌ Error executing call campaign ${campaign._id}:`), error.message)

      // Mark attempt as failed
      const now = new Date()
      const pendingAttempt = campaign.campaignConfig.attempts.find(
        (attempt) => attempt.status === "pending" && new Date(attempt.scheduledAt) <= now,
      )

      if (pendingAttempt) {
        await this.updateAttemptStatus(campaign._id, pendingAttempt.attemptNumber, "failed", "call", error.message)
      }
    }
  }

  // Execute an email campaign
  async executeEmailCampaign(campaign) {
    try {
      console.log(chalk.blue(`📧 Executing email campaign for ${campaign.recordData.businessname}`))

      // Mark campaign as in progress
      await this.updateCampaignStatus(campaign._id, "in_progress", "email")

      const businessName = campaign.recordData.businessname
      const emailAddresses = campaign.emailConfig.emailAddresses

      if (!emailAddresses || emailAddresses.length === 0) {
        throw new Error("No email addresses found in campaign record")
      }

      // Generate email
      const emailData = await this.outreachService.generatePersonalizedEmail(businessName)

      let totalSent = 0
      const totalAttempted = emailAddresses.length

      // Send emails with delay
      for (let i = 0; i < emailAddresses.length; i++) {
        const emailAddress = emailAddresses[i]
        try {
          console.log(chalk.blue(`📧 Sending email ${i + 1}/${emailAddresses.length} to ${emailAddress}`))
          const result = await this.outreachService.sendEmail(emailAddress, emailData, businessName)

          if (result.success) {
            totalSent++
          }

          if (i < emailAddresses.length - 1) {
            console.log(
              chalk.yellow(`⏳ Waiting ${OUTREACH_CONFIG.EMAILS.EMAIL_DELAY_SECONDS} seconds before next email...`),
            )
            await new Promise((resolve) => setTimeout(resolve, OUTREACH_CONFIG.EMAILS.EMAIL_DELAY_SECONDS * 1000))
          }
        } catch (error) {
          console.error(chalk.red(`❌ Error sending email to ${emailAddress}:`), error.message)
        }
      }

      // Update campaign with email results
      await this.updateEmailCampaignResults(campaign._id, {
        totalSent,
        totalAttempted,
        subject: emailData.subject,
        success: totalSent > 0,
      })

      // UPDATED: Update original record with email-specific status
      await this.updateOriginalRecord(
        campaign,
        {
          totalSent,
          totalAttempted,
          subject: emailData.subject,
          success: totalSent > 0,
        },
        "email",
      )

      // Mark campaign as completed
      await this.updateCampaignStatus(campaign._id, totalSent > 0 ? "completed" : "failed", "email")

      console.log(
        chalk.green(
          `✅ Email campaign completed for ${campaign.recordData.businessname} (${totalSent}/${totalAttempted} sent)`,
        ),
      )
    } catch (error) {
      console.error(chalk.red(`❌ Error executing email campaign ${campaign._id}:`), error.message)
      await this.updateCampaignStatus(campaign._id, "failed", "email", error.message)
    }
  }

  // Update campaign status
  async updateCampaignStatus(campaignId, status, campaignType, error = null) {
    try {
      const collectionName = campaignType === "call" ? this.callCampaignsCollection : this.emailCampaignsCollection

      const collection = getCollection(this.trackingDbName, collectionName)
      const objectId = await toObjectId(campaignId)

      const updateData = {
        $set: {
          overallStatus: status,
          updatedAt: new Date(),
        },
      }

      if (status === "completed" || status === "failed") {
        updateData.$set.completedAt = new Date()
      }

      if (error) {
        updateData.$set.error = error
      }

      await collection.updateOne({ _id: objectId }, updateData)
      console.log(chalk.green(`✅ Updated campaign ${campaignId} status to: ${status}`))
    } catch (error) {
      console.error(chalk.red(`❌ Error updating campaign status:`), error.message)
    }
  }

  // Update attempt status
  async updateAttemptStatus(campaignId, attemptNumber, status, campaignType, error = null) {
    try {
      const collectionName = campaignType === "call" ? this.callCampaignsCollection : this.emailCampaignsCollection

      const collection = getCollection(this.trackingDbName, collectionName)
      const objectId = await toObjectId(campaignId)

      const updateData = {
        $set: {
          [`campaignConfig.attempts.${attemptNumber - 1}.status`]: status,
          [`campaignConfig.attempts.${attemptNumber - 1}.executedAt`]: new Date(),
          updatedAt: new Date(),
        },
      }

      if (error) {
        updateData.$set[`campaignConfig.attempts.${attemptNumber - 1}.error`] = error
      }

      await collection.updateOne({ _id: objectId }, updateData)
    } catch (error) {
      console.error(chalk.red(`❌ Error updating attempt status:`), error.message)
    }
  }

  // Update attempt results
  async updateAttemptResults(campaignId, attemptNumber, callResults, callInitResult, campaignType) {
    try {
      const collectionName = campaignType === "call" ? this.callCampaignsCollection : this.emailCampaignsCollection

      const collection = getCollection(this.trackingDbName, collectionName)
      const objectId = await toObjectId(campaignId)

      const updateData = {
        $set: {
          [`campaignConfig.attempts.${attemptNumber - 1}.status`]: callResults.callSuccessful ? "completed" : "failed",
          [`campaignConfig.attempts.${attemptNumber - 1}.executedAt`]: new Date(),
          [`campaignConfig.attempts.${attemptNumber - 1}.callResults`]: {
            callSuccessful: callResults.callSuccessful,
            duration: callResults.callDuration,
            conversationId: callResults.conversationId,
            isPartneredWithInfinityClub: callResults.isPartneredWithInfinityClub,
            agentUsed: callInitResult.agentUsed,
            callSid: callInitResult.callSid,
          },
          updatedAt: new Date(),
        },
      }

      await collection.updateOne({ _id: objectId }, updateData)
    } catch (error) {
      console.error(chalk.red(`❌ Error updating attempt results:`), error.message)
    }
  }

  // Update email campaign results
  async updateEmailCampaignResults(campaignId, emailResults) {
    try {
      const collection = getCollection(this.trackingDbName, this.emailCampaignsCollection)
      const objectId = await toObjectId(campaignId)

      const updateData = {
        $set: {
          "emailConfig.results": emailResults,
          "emailConfig.executedAt": new Date(),
          updatedAt: new Date(),
        },
      }

      await collection.updateOne({ _id: objectId }, updateData)
    } catch (error) {
      console.error(chalk.red(`❌ Error updating email campaign results:`), error.message)
    }
  }

  // UPDATED: Update original record with campaign-specific status tracking
  async updateOriginalRecord(campaign, results, campaignType) {
    try {
      const mainCollection = getCollection(campaign.sourceDatabase, campaign.sourceCollection)
      const objectId = await toObjectId(campaign.originalRecordId)

      const updateData = {
        $set: {
          "outreach.lastUpdatedAt": new Date(),
        },
      }

      if (campaignType === "call") {
        updateData.$set = {
          ...updateData.$set,
          "outreach.call.lastCallStatus": results.callSuccessful ? "successful" : "failed",
          "outreach.call.lastCallAt": new Date(),
          "outreach.call.lastCallDuration": results.callDuration,
          "outreach.call.lastConversationId": results.conversationId,
          "outreach.call.campaignStatus": "completed", // NEW: Call campaign specific status
          "outreach.alignment.status": results.isPartneredWithInfinityClub,
        }
      } else if (campaignType === "email") {
        updateData.$set = {
          ...updateData.$set,
          "outreach.email.lastEmailStatus": results.success ? "sent" : "failed",
          "outreach.email.emailsSentCount": results.totalSent,
          "outreach.email.lastEmailAt": new Date(),
          "outreach.email.lastEmailSubject": results.subject,
          "outreach.email.campaignStatus": "completed", // NEW: Email campaign specific status
        }
      }

      await mainCollection.updateOne({ _id: objectId }, updateData)
      console.log(chalk.green(`✅ Updated original record ${campaign.originalRecordId} for ${campaignType} campaign`))
    } catch (error) {
      console.error(chalk.red(`❌ Error updating original record:`), error.message)
    }
  }

  // Get campaign by ID
  async getCampaignById(campaignId, campaignType) {
    try {
      const collectionName = campaignType === "call" ? this.callCampaignsCollection : this.emailCampaignsCollection

      const collection = getCollection(this.trackingDbName, collectionName)
      const objectId = await toObjectId(campaignId)
      return await collection.findOne({ _id: objectId })
    } catch (error) {
      console.error(chalk.red(`❌ Error getting campaign by ID:`), error.message)
      return null
    }
  }

  // Get campaign status (legacy compatibility)
  async getCampaignStatus(recordIds = null) {
    try {
      const callCollection = getCollection(this.trackingDbName, this.callCampaignsCollection)

      const query = recordIds ? { originalRecordId: { $in: recordIds } } : {}
      const campaigns = await callCollection.find(query).toArray()

      // Group by status
      const statusCounts = {}
      campaigns.forEach((campaign) => {
        const status = campaign.overallStatus
        statusCounts[status] = (statusCounts[status] || 0) + 1
      })

      return {
        totalRecords: campaigns.length,
        statusCounts: statusCounts,
        records: campaigns,
      }
    } catch (error) {
      console.error(chalk.red("❌ Error getting campaign status:"), error.message)
      throw error
    }
  }

  // Stop scheduler
  stopScheduler() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval)
      this.schedulerInterval = null
      console.log(chalk.red("🛑 Scheduler stopped"))
    }
  }
}

export default ScheduledOutreachService
