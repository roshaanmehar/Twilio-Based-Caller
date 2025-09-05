import RecordCopyService from "./recordCopyService.js"
import ValidationService from "./validationService.js"
import { getCollection, toObjectId } from "../database/mongodb.js"
import OUTREACH_CONFIG from "../config/constants.js"
import chalk from "chalk"

export class CampaignCreationService {
  constructor() {
    this.recordCopyService = new RecordCopyService()
    this.validationService = new ValidationService()
    this.trackingDbName = OUTREACH_CONFIG.DATABASE.TRACKING_DB_NAME
  }

  // Check if record is already in a campaign or processed (UPDATED for separate call/email tracking)
  async checkRecordEligibility(recordId, databaseName, collectionName, campaignType = "call") {
    try {
      // Check original record status
      const mainCollection = getCollection(databaseName, collectionName)
      const objectId = await toObjectId(recordId)
      const originalRecord = await mainCollection.findOne({ _id: objectId })

      if (!originalRecord) {
        return {
          eligible: false,
          reason: "Record not found",
          status: null,
        }
      }

      // UPDATED: Check campaign-specific status instead of general outreach status
      let currentStatus = "idle"
      let statusField = ""

      if (campaignType === "call") {
        currentStatus = originalRecord.outreach?.call?.campaignStatus || "idle"
        statusField = "outreach.call.campaignStatus"
        console.log(chalk.blue(`📞 Record ${recordId} call campaign status: ${currentStatus}`))
      } else if (campaignType === "email") {
        currentStatus = originalRecord.outreach?.email?.campaignStatus || "idle"
        statusField = "outreach.email.campaignStatus"
        console.log(chalk.blue(`📧 Record ${recordId} email campaign status: ${currentStatus}`))
      }

      // Check if already in active campaign for this specific type
      if (["processing", "in_progress", "scheduled"].includes(currentStatus)) {
        return {
          eligible: false,
          reason: `Record already has active ${campaignType} campaign (status: ${currentStatus})`,
          status: currentStatus,
          statusField: statusField,
        }
      }

      // Check if already in tracking database for this campaign type
      const trackingCollectionName =
        campaignType === "call"
          ? OUTREACH_CONFIG.DATABASE.CALL_CAMPAIGNS_COLLECTION
          : OUTREACH_CONFIG.DATABASE.EMAIL_CAMPAIGNS_COLLECTION

      const trackingCollection = getCollection(this.trackingDbName, trackingCollectionName)
      const existingCampaign = await trackingCollection.findOne({
        originalRecordId: recordId,
        overallStatus: { $in: ["scheduled", "in_progress"] },
      })

      if (existingCampaign) {
        return {
          eligible: false,
          reason: `Record already has active ${campaignType} campaign in tracking database`,
          status: currentStatus,
          existingCampaignId: existingCampaign._id.toString(),
        }
      }

      // UPDATED: Record is eligible regardless of other campaign types
      const generalStatus = originalRecord.outreach?.status || "idle"
      console.log(chalk.green(`✅ Record ${recordId} is eligible for ${campaignType} campaign`))
      console.log(chalk.gray(`   General outreach status: ${generalStatus}`))
      console.log(chalk.gray(`   ${campaignType} campaign status: ${currentStatus}`))

      return {
        eligible: true,
        reason: `Record is eligible for ${campaignType} campaign`,
        status: currentStatus,
        generalStatus: generalStatus,
      }
    } catch (error) {
      console.error(chalk.red(`❌ Error checking record eligibility:`), error.message)
      return {
        eligible: false,
        reason: `Error checking eligibility: ${error.message}`,
        status: null,
      }
    }
  }

  // Create call campaigns for multiple records (ENHANCED with email scheduling)
  async createCallCampaigns(requestData, databaseName, collectionName, userId = null) {
    try {
      console.log(chalk.cyan(`🚀 Creating call campaigns for ${requestData.records.length} records...`))

      // Validate the request
      const validation = this.validationService.validateCallCampaignRequest(requestData)
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors.join(", ")}`)
      }

      const results = []
      const errors = []
      const skipped = []

      // Process each record
      for (const record of requestData.records) {
        try {
          console.log(chalk.blue(`📋 Processing record: ${record.recordId}`))

          // Check if record is eligible (not already in call campaign)
          const eligibility = await this.checkRecordEligibility(record.recordId, databaseName, collectionName, "call")

          if (!eligibility.eligible) {
            console.log(chalk.yellow(`⏭️ Skipping record ${record.recordId}: ${eligibility.reason}`))
            skipped.push({
              recordId: record.recordId,
              reason: eligibility.reason,
              currentStatus: eligibility.status,
              existingCampaignId: eligibility.existingCampaignId || null,
            })
            continue
          }

          // ENHANCED: Process email config with scheduling support
          let processedEmailConfig = { enabled: false }

          if (requestData.emailConfig && requestData.emailConfig.enabled) {
            processedEmailConfig = {
              enabled: true,
              emailAddresses: requestData.emailConfig.emailAddresses || [],
              sendAfterCalls: requestData.emailConfig.sendAfterCalls || false,
              // NEW: Support for scheduled emails
              scheduledAt: requestData.emailConfig.scheduledAt || null,
              attempts: requestData.emailConfig.attempts || [],
            }

            console.log(chalk.blue(`📧 Email config processed:`))
            console.log(chalk.white(`   Enabled: ${processedEmailConfig.enabled}`))
            console.log(chalk.white(`   Send after calls: ${processedEmailConfig.sendAfterCalls}`))
            console.log(chalk.white(`   Scheduled at: ${processedEmailConfig.scheduledAt || "Not scheduled"}`))
            console.log(chalk.white(`   Email attempts: ${processedEmailConfig.attempts.length}`))
          }

          // Prepare campaign config for this record
          const campaignConfig = {
            maxAttempts: requestData.attempts.length,
            attempts: requestData.attempts,
            emailConfig: processedEmailConfig,
          }

          // UPDATED: Update main record call campaign status FIRST (before copying to tracking)
          await this.recordCopyService.updateMainRecordCampaignStatus(
            record.recordId,
            databaseName,
            collectionName,
            "processing",
            "call",
          )

          // Copy record to call tracking
          const copyResult = await this.recordCopyService.copyRecordToCallTracking(
            record.recordId,
            databaseName,
            collectionName,
            campaignConfig,
            userId,
          )

          results.push({
            recordId: record.recordId,
            trackingId: copyResult.trackingId,
            businessName: copyResult.businessName,
            phoneNumber: copyResult.phoneNumber,
            status: "success",
            previousStatus: eligibility.status,
            emailsScheduled: processedEmailConfig.enabled && processedEmailConfig.scheduledAt ? true : false,
          })

          console.log(chalk.green(`✅ Call campaign created for ${copyResult.businessName}`))
          if (processedEmailConfig.enabled && processedEmailConfig.scheduledAt) {
            console.log(chalk.blue(`📧 Emails scheduled for: ${processedEmailConfig.scheduledAt}`))
          }
        } catch (error) {
          console.error(chalk.red(`❌ Error creating campaign for record ${record.recordId}:`), error.message)
          errors.push({
            recordId: record.recordId,
            error: error.message,
          })

          // Revert status if campaign creation failed
          try {
            await this.recordCopyService.updateMainRecordCampaignStatus(
              record.recordId,
              databaseName,
              collectionName,
              "failed",
              "call",
            )
          } catch (revertError) {
            console.error(chalk.red(`❌ Error reverting status for ${record.recordId}:`), revertError.message)
          }
        }
      }

      const summary = {
        success: results.length > 0,
        totalRecords: requestData.records.length,
        successfulCampaigns: results.length,
        failedCampaigns: errors.length,
        skippedCampaigns: skipped.length,
        campaignTrackingIds: results.map((r) => r.trackingId),
        results: results,
        errors: errors,
        skipped: skipped,
      }

      console.log(chalk.green(`🎉 Call campaigns creation completed:`))
      console.log(chalk.white(`   Successful: ${summary.successfulCampaigns}/${summary.totalRecords}`))
      console.log(chalk.white(`   Failed: ${summary.failedCampaigns}/${summary.totalRecords}`))
      console.log(chalk.white(`   Skipped: ${summary.skippedCampaigns}/${summary.totalRecords}`))

      return summary
    } catch (error) {
      console.error(chalk.red("❌ Error creating call campaigns:"), error.message)
      throw error
    }
  }

  // Create email campaigns for multiple records (UPDATED for independent email tracking)
  async createEmailCampaigns(requestData, databaseName, collectionName, userId = null) {
    try {
      console.log(chalk.cyan(`📧 Creating email campaigns for ${requestData.records.length} records...`))

      // Validate the request
      const validation = this.validationService.validateEmailCampaignRequest(requestData)
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors.join(", ")}`)
      }

      const results = []
      const errors = []
      const skipped = []

      // Process each record
      for (const record of requestData.records) {
        try {
          console.log(chalk.blue(`📋 Processing record: ${record.recordId}`))

          // UPDATED: Check if record is eligible for EMAIL campaign (independent of call status)
          const eligibility = await this.checkRecordEligibility(record.recordId, databaseName, collectionName, "email")

          if (!eligibility.eligible) {
            console.log(chalk.yellow(`⏭️ Skipping record ${record.recordId}: ${eligibility.reason}`))
            skipped.push({
              recordId: record.recordId,
              reason: eligibility.reason,
              currentStatus: eligibility.status,
              existingCampaignId: eligibility.existingCampaignId || null,
            })
            continue
          }

          // Prepare email config for this record
          const emailConfig = {
            emailAddresses: record.emailAddresses,
            maxAttempts: OUTREACH_CONFIG.EMAILS.MAX_ATTEMPTS,
            scheduledAt: requestData.scheduledAt,
          }

          // UPDATED: Update main record EMAIL campaign status FIRST (before copying to tracking)
          await this.recordCopyService.updateMainRecordCampaignStatus(
            record.recordId,
            databaseName,
            collectionName,
            "processing",
            "email",
          )

          // Copy record to email tracking
          const copyResult = await this.recordCopyService.copyRecordToEmailTracking(
            record.recordId,
            databaseName,
            collectionName,
            emailConfig,
            userId,
          )

          results.push({
            recordId: record.recordId,
            trackingId: copyResult.trackingId,
            businessName: copyResult.businessName,
            emailAddresses: copyResult.emailAddresses,
            status: "success",
            previousStatus: eligibility.status,
          })

          console.log(chalk.green(`✅ Email campaign created for ${copyResult.businessName}`))
        } catch (error) {
          console.error(chalk.red(`❌ Error creating email campaign for record ${record.recordId}:`), error.message)
          errors.push({
            recordId: record.recordId,
            error: error.message,
          })

          // Revert status if campaign creation failed
          try {
            await this.recordCopyService.updateMainRecordCampaignStatus(
              record.recordId,
              databaseName,
              collectionName,
              "failed",
              "email",
            )
          } catch (revertError) {
            console.error(chalk.red(`❌ Error reverting status for ${record.recordId}:`), revertError.message)
          }
        }
      }

      const summary = {
        success: results.length > 0,
        totalRecords: requestData.records.length,
        successfulCampaigns: results.length,
        failedCampaigns: errors.length,
        skippedCampaigns: skipped.length,
        campaignTrackingIds: results.map((r) => r.trackingId),
        results: results,
        errors: errors,
        skipped: skipped,
      }

      console.log(chalk.green(`🎉 Email campaigns creation completed:`))
      console.log(chalk.white(`   Successful: ${summary.successfulCampaigns}/${summary.totalRecords}`))
      console.log(chalk.white(`   Failed: ${summary.failedCampaigns}/${summary.totalRecords}`))
      console.log(chalk.white(`   Skipped: ${summary.skippedCampaigns}/${summary.totalRecords}`))

      return summary
    } catch (error) {
      console.error(chalk.red("❌ Error creating email campaigns:"), error.message)
      throw error
    }
  }

  // Get campaign status by tracking IDs
  async getCampaignStatus(trackingIds = null, campaignType = "call") {
    try {
      const collectionName =
        campaignType === "call"
          ? OUTREACH_CONFIG.DATABASE.CALL_CAMPAIGNS_COLLECTION
          : OUTREACH_CONFIG.DATABASE.EMAIL_CAMPAIGNS_COLLECTION

      const collection = getCollection(this.trackingDbName, collectionName)

      let query = {}
      if (trackingIds && trackingIds.length > 0) {
        const objectIds = await Promise.all(trackingIds.map((id) => toObjectId(id)))
        query = { _id: { $in: objectIds } }
      }

      const campaigns = await collection.find(query).toArray()

      // Group by status for summary
      const statusCounts = {}
      campaigns.forEach((campaign) => {
        const status = campaign.overallStatus
        statusCounts[status] = (statusCounts[status] || 0) + 1
      })

      return {
        totalCampaigns: campaigns.length,
        statusCounts: statusCounts,
        campaigns: campaigns.map((campaign) => ({
          trackingId: campaign._id.toString(),
          originalRecordId: campaign.originalRecordId,
          businessName: campaign.recordData.businessname,
          overallStatus: campaign.overallStatus,
          createdAt: campaign.createdAt,
          updatedAt: campaign.updatedAt,
          completedAt: campaign.completedAt,
          // Include campaign-specific details
          ...(campaignType === "call"
            ? {
                attemptsCompleted: campaign.campaignConfig.attempts.filter((a) => a.status === "completed").length,
                totalAttempts: campaign.campaignConfig.attempts.length,
                emailEnabled: campaign.emailConfig.enabled,
                emailScheduled: campaign.emailConfig.scheduledAt ? true : false,
              }
            : {
                emailsSent: campaign.emailConfig.attempts.filter((a) => a.status === "sent").length,
                totalEmailAttempts: campaign.emailConfig.attempts.length,
                emailAddresses: campaign.emailConfig.emailAddresses,
              }),
        })),
      }
    } catch (error) {
      console.error(chalk.red("❌ Error getting campaign status:"), error.message)
      throw error
    }
  }

  // Check record status in original database (UPDATED to show separate call/email status)
  async checkOriginalRecordStatus(recordId, databaseName, collectionName) {
    try {
      const mainCollection = getCollection(databaseName, collectionName)
      const objectId = await toObjectId(recordId)
      const record = await mainCollection.findOne({ _id: objectId })

      if (!record) {
        return {
          found: false,
          error: "Record not found",
        }
      }

      // UPDATED: Return separate call and email campaign statuses
      return {
        found: true,
        recordId: recordId,
        businessName: record.businessname,
        // General outreach status (legacy)
        outreachStatus: record.outreach?.status || "idle",
        lastUpdated: record.outreach?.lastUpdatedAt || null,
        // NEW: Separate campaign statuses
        callCampaignStatus: record.outreach?.call?.campaignStatus || "idle",
        emailCampaignStatus: record.outreach?.email?.campaignStatus || "idle",
        // Call-specific data
        lastCallStatus: record.outreach?.call?.lastCallStatus || null,
        lastCallAt: record.outreach?.call?.lastCallAt || null,
        partnershipStatus: record.outreach?.alignment?.status || null,
        // Email-specific data
        lastEmailStatus: record.outreach?.email?.lastEmailStatus || null,
        lastEmailAt: record.outreach?.email?.lastEmailAt || null,
        emailsSentCount: record.outreach?.email?.emailsSentCount || 0,
        // Contact info
        phoneNumber: record.phonenumber || null,
        email: record.email || null,
        contactInfo: record.outreach?.contactInfo || null,
      }
    } catch (error) {
      console.error(chalk.red("❌ Error checking original record status:"), error.message)
      return {
        found: false,
        error: error.message,
      }
    }
  }

  // Initialize the service (create collections and indexes)
  async initialize() {
    try {
      await this.recordCopyService.initializeTrackingCollections()
      console.log(chalk.green(`✅ Campaign Creation Service initialized`))
    } catch (error) {
      console.error(chalk.red("❌ Error initializing Campaign Creation Service:"), error.message)
      throw error
    }
  }
}

export default CampaignCreationService
