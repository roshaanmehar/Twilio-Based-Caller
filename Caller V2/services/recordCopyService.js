import { getCollection, toObjectId } from "../database/mongodb.js"
import OUTREACH_CONFIG from "../config/constants.js"
import chalk from "chalk"

export class RecordCopyService {
  constructor() {
    this.trackingDbName = OUTREACH_CONFIG.DATABASE.TRACKING_DB_NAME
    this.callCampaignsCollection = OUTREACH_CONFIG.DATABASE.CALL_CAMPAIGNS_COLLECTION
    this.emailCampaignsCollection = OUTREACH_CONFIG.DATABASE.EMAIL_CAMPAIGNS_COLLECTION
  }

  // Copy record from main DB to call_campaigns collection
  async copyRecordToCallTracking(originalRecordId, databaseName, collectionName, campaignConfig, userId = null) {
    try {
      console.log(chalk.blue(`📋 Copying record ${originalRecordId} to call tracking...`))

      // Fetch original record from main database
      const mainCollection = getCollection(databaseName, collectionName)
      const objectId = await toObjectId(originalRecordId)
      const originalRecord = await mainCollection.findOne({ _id: objectId })

      if (!originalRecord) {
        throw new Error(`Record ${originalRecordId} not found in ${databaseName}.${collectionName}`)
      }

      // Process attempts - they're already parsed as UK time from validation
      const processedAttempts = campaignConfig.attempts.map((attempt) => {
        const scheduledAt = new Date(attempt.scheduledAt)

        console.log(
          chalk.blue(
            `📅 Processing attempt ${attempt.attemptNumber}: ${scheduledAt.toLocaleString("en-GB", { timeZone: "Europe/London" })} (UK)`,
          ),
        )

        return {
          attemptNumber: attempt.attemptNumber,
          agentId: attempt.agentId,
          scheduledAt: scheduledAt, // Already in UK time
          status: "pending",
          executedAt: null,
          callResults: {},
        }
      })

      // FIXED: Process email config properly with scheduledAt
      let processedEmailConfig
      if (campaignConfig.emailConfig && campaignConfig.emailConfig.enabled) {
        // Parse the scheduled time if provided
        let emailScheduledAt = null
        if (campaignConfig.emailConfig.scheduledAt) {
          emailScheduledAt = new Date(campaignConfig.emailConfig.scheduledAt)
          console.log(
            chalk.blue(
              `📧 Email scheduled at: ${emailScheduledAt.toLocaleString("en-GB", { timeZone: "Europe/London" })} (UK)`,
            ),
          )
        }

        processedEmailConfig = {
          enabled: true,
          emailAddresses: campaignConfig.emailConfig.emailAddresses || [],
          sendAfterCalls: campaignConfig.emailConfig.sendAfterCalls || false,
          status: "pending",
          scheduledAt: emailScheduledAt, // FIXED: Use the actual scheduled time!
          executedAt: null,
        }
      } else {
        processedEmailConfig = {
          enabled: false,
          emailAddresses: [],
          sendAfterCalls: false,
          status: "disabled",
          scheduledAt: null,
          executedAt: null,
        }
      }

      // Create tracking record structure
      const trackingRecord = {
        originalRecordId: originalRecordId,
        userId: userId,

        // Copy of original record data (snapshot)
        recordData: {
          businessname: originalRecord.businessname,
          phonenumber: originalRecord.phonenumber,
          email: originalRecord.email,
          address: originalRecord.address,
          postcode: originalRecord.postcode,
          website: originalRecord.website,
          category: originalRecord.category,
          subcategory: originalRecord.subcategory,
          // Copy any other fields that exist
          ...Object.fromEntries(Object.entries(originalRecord).filter(([key]) => !["_id", "outreach"].includes(key))),
        },

        // Campaign configuration with properly processed attempts
        campaignConfig: {
          maxAttempts: campaignConfig.maxAttempts || OUTREACH_CONFIG.CALLS.MAX_ATTEMPTS,
          attempts: processedAttempts,
        },

        // Email configuration - FIXED to include proper scheduledAt
        emailConfig: processedEmailConfig,

        // Overall record status for Kanban
        overallStatus: "scheduled",

        // Metadata
        sourceDatabase: databaseName,
        sourceCollection: collectionName,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
      }

      console.log(chalk.gray(`📊 Final tracking record attempts (UK time):`))
      trackingRecord.campaignConfig.attempts.forEach((attempt) => {
        console.log(
          chalk.gray(
            `   Attempt ${attempt.attemptNumber}: ${attempt.scheduledAt.toLocaleString("en-GB", { timeZone: "Europe/London" })} (UK)`,
          ),
        )
      })

      // Log email scheduling info
      if (trackingRecord.emailConfig.enabled && trackingRecord.emailConfig.scheduledAt) {
        console.log(
          chalk.gray(
            `📧 Email scheduled for: ${trackingRecord.emailConfig.scheduledAt.toLocaleString("en-GB", { timeZone: "Europe/London" })} (UK)`,
          ),
        )
      } else if (trackingRecord.emailConfig.enabled) {
        console.log(chalk.gray(`📧 Emails enabled but no specific schedule (will send after calls)`))
      }

      // Insert into call_campaigns collection
      const trackingCollection = getCollection(this.trackingDbName, this.callCampaignsCollection)
      const result = await trackingCollection.insertOne(trackingRecord)

      console.log(chalk.green(`✅ Record copied to call tracking with ID: ${result.insertedId}`))

      return {
        trackingId: result.insertedId.toString(),
        businessName: originalRecord.businessname,
        phoneNumber: originalRecord.phonenumber,
      }
    } catch (error) {
      console.error(chalk.red(`❌ Error copying record ${originalRecordId} to call tracking:`), error.message)
      throw error
    }
  }

  // Copy record from main DB to email_campaigns collection
  async copyRecordToEmailTracking(originalRecordId, databaseName, collectionName, emailConfig, userId = null) {
    try {
      console.log(chalk.blue(`📋 Copying record ${originalRecordId} to email tracking...`))

      // Fetch original record from main database
      const mainCollection = getCollection(databaseName, collectionName)
      const objectId = await toObjectId(originalRecordId)
      const originalRecord = await mainCollection.findOne({ _id: objectId })

      if (!originalRecord) {
        throw new Error(`Record ${originalRecordId} not found in ${databaseName}.${collectionName}`)
      }

      // Scheduled date is already parsed as UK time from validation
      const scheduledAt = new Date(emailConfig.scheduledAt)
      console.log(
        chalk.blue(`📅 Email scheduled at: ${scheduledAt.toLocaleString("en-GB", { timeZone: "Europe/London" })} (UK)`),
      )

      // Create email tracking record structure
      const trackingRecord = {
        originalRecordId: originalRecordId,
        userId: userId,

        // Copy of original record data (snapshot)
        recordData: {
          businessname: originalRecord.businessname,
          phonenumber: originalRecord.phonenumber,
          email: originalRecord.email,
          address: originalRecord.address,
          postcode: originalRecord.postcode,
          website: originalRecord.website,
          category: originalRecord.category,
          subcategory: originalRecord.subcategory,
          // Copy any other fields that exist
          ...Object.fromEntries(Object.entries(originalRecord).filter(([key]) => !["_id", "outreach"].includes(key))),
        },

        // Email campaign configuration
        emailConfig: {
          emailAddresses: emailConfig.emailAddresses,
          maxAttempts: emailConfig.maxAttempts || OUTREACH_CONFIG.EMAILS.MAX_ATTEMPTS,
          scheduledAt: scheduledAt, // Already in UK time
          attempts: Array.from(
            { length: emailConfig.maxAttempts || OUTREACH_CONFIG.EMAILS.MAX_ATTEMPTS },
            (_, index) => ({
              attemptNumber: index + 1,
              scheduledAt: scheduledAt, // All attempts start at same time for now
              status: "pending",
              executedAt: null,
              emailResults: {},
            }),
          ),
        },

        // Overall status for Kanban
        overallStatus: "scheduled",

        // Metadata
        sourceDatabase: databaseName,
        sourceCollection: collectionName,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
      }

      // Insert into email_campaigns collection
      const trackingCollection = getCollection(this.trackingDbName, this.emailCampaignsCollection)
      const result = await trackingCollection.insertOne(trackingRecord)

      console.log(chalk.green(`✅ Record copied to email tracking with ID: ${result.insertedId}`))

      return {
        trackingId: result.insertedId.toString(),
        businessName: originalRecord.businessname,
        emailAddresses: emailConfig.emailAddresses,
      }
    } catch (error) {
      console.error(chalk.red(`❌ Error copying record ${originalRecordId} to email tracking:`), error.message)
      throw error
    }
  }

  // UPDATED: Update main record with campaign-specific status (separate for calls and emails)
  async updateMainRecordCampaignStatus(originalRecordId, databaseName, collectionName, status, campaignType = "call") {
    try {
      const mainCollection = getCollection(databaseName, collectionName)
      const objectId = await toObjectId(originalRecordId)

      const updateData = {
        $set: {
          "outreach.lastUpdatedAt": new Date(),
        },
      }

      // UPDATED: Set campaign-specific status fields
      if (campaignType === "call") {
        updateData.$set["outreach.call.campaignStatus"] = status
        updateData.$set["outreach.call.lastCampaignUpdate"] = new Date()
        console.log(chalk.blue(`📞 Updating call campaign status to: ${status}`))
      } else if (campaignType === "email") {
        updateData.$set["outreach.email.campaignStatus"] = status
        updateData.$set["outreach.email.lastCampaignUpdate"] = new Date()
        console.log(chalk.blue(`📧 Updating email campaign status to: ${status}`))
      }

      // Also update general outreach status for backward compatibility
      // But don't override if other campaigns are active
      const currentRecord = await mainCollection.findOne({ _id: objectId })
      const callStatus = currentRecord?.outreach?.call?.campaignStatus || "idle"
      const emailStatus = currentRecord?.outreach?.email?.campaignStatus || "idle"

      // Set general status based on most active campaign
      let generalStatus = "idle"
      if (campaignType === "call" && status === "processing") {
        generalStatus = "processing"
      } else if (campaignType === "email" && status === "processing") {
        generalStatus = "processing"
      } else if (callStatus === "processing" || emailStatus === "processing") {
        generalStatus = "processing"
      } else if (callStatus === "completed" || emailStatus === "completed") {
        generalStatus = "processed"
      } else if (status === "completed") {
        generalStatus = "processed"
      } else if (status === "failed") {
        generalStatus = "failed"
      }

      updateData.$set["outreach.status"] = generalStatus

      await mainCollection.updateOne({ _id: objectId }, updateData)
      console.log(
        chalk.green(`✅ Updated main record ${originalRecordId} ${campaignType} campaign status to: ${status}`),
      )
      console.log(chalk.gray(`   General outreach status: ${generalStatus}`))
    } catch (error) {
      console.error(chalk.red(`❌ Error updating main record ${originalRecordId}:`), error.message)
      throw error
    }
  }

  // LEGACY: Keep for backward compatibility
  async updateMainRecordStatus(originalRecordId, databaseName, collectionName, status, campaignType = "call") {
    return await this.updateMainRecordCampaignStatus(
      originalRecordId,
      databaseName,
      collectionName,
      status,
      campaignType,
    )
  }

  // Get tracking record by ID
  async getCallTrackingRecord(trackingId) {
    try {
      const trackingCollection = getCollection(this.trackingDbName, this.callCampaignsCollection)
      const objectId = await toObjectId(trackingId)
      return await trackingCollection.findOne({ _id: objectId })
    } catch (error) {
      console.error(chalk.red(`❌ Error getting call tracking record ${trackingId}:`), error.message)
      throw error
    }
  }

  // Get email tracking record by ID
  async getEmailTrackingRecord(trackingId) {
    try {
      const trackingCollection = getCollection(this.trackingDbName, this.emailCampaignsCollection)
      const objectId = await toObjectId(trackingId)
      return await trackingCollection.findOne({ _id: objectId })
    } catch (error) {
      console.error(chalk.red(`❌ Error getting email tracking record ${trackingId}:`), error.message)
      throw error
    }
  }

  // Initialize tracking collections (create indexes)
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
}

export default RecordCopyService
