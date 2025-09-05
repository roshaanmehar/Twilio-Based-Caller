import OutreachService from "./outreachService.js"
import TrackingService from "./trackingService.js"
import { getCollection, toObjectId } from "../database/mongodb.js"
import OUTREACH_CONFIG from "../config/constants.js"
import chalk from "chalk"

export class ScheduledOutreachService {
  constructor(elevenLabsConfig, geminiConfig, zapierConfig) {
    this.outreachService = new OutreachService(elevenLabsConfig, geminiConfig, zapierConfig)
    this.trackingService = new TrackingService()
    this.isProcessing = false
    this.schedulerInterval = null
    this.activeCallPromises = new Map() // Track active calls to prevent duplicates
  }

  // Initialize the service
  async initialize() {
    await this.trackingService.initializeTrackingCollections()
    console.log(chalk.green("✅ Scheduled Outreach Service initialized"))

    // Start the independent scheduler
    this.startIndependentScheduler()
  }

  // Start scheduled call campaign (just adds records to tracking)
  async startCallCampaign(databaseName, collectionName, recordIds, userId = "system") {
    try {
      console.log(chalk.cyan(`🚀 Starting scheduled call campaign for ${recordIds.length} records`))

      const result = await this.trackingService.addToCallTracking(databaseName, collectionName, recordIds, userId)

      console.log(chalk.green(`✅ Call campaign setup complete:`))
      console.log(chalk.white(`   Records added: ${result.recordsAdded}`))
      console.log(chalk.white(`   Records reset: ${result.recordsReset}`))
      console.log(chalk.white(`   Records skipped: ${result.recordsSkipped}`))

      return result
    } catch (error) {
      console.error(chalk.red("❌ Error starting call campaign:"), error.message)
      throw error
    }
  }

  // Start email campaign (instant sending)
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

          // Update main record
          await mainCollection.updateOne(
            { _id: objectId },
            {
              $set: {
                "outreach.email.lastEmailStatus": "sent",
                "outreach.email.emailsSentCount": emailAddresses.length,
                "outreach.email.lastEmailAt": new Date(),
                "outreach.email.lastEmailSubject": emailData.subject,
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

  // Process all scheduled tasks (calls and emails)
  async processScheduledTasks() {
    try {
      console.log(chalk.gray(`🕐 ${new Date().toLocaleString()} - Checking for scheduled tasks...`))

      // Process calls for each cadence step concurrently
      const callPromises = []
      for (let cadenceStep = 0; cadenceStep < 4; cadenceStep++) {
        callPromises.push(this.processCallsForCadenceStep(cadenceStep))
      }

      // Wait for all call processing to complete
      await Promise.all(callPromises)

      // Process emails (cadence step 4)
      await this.processScheduledEmails()
    } catch (error) {
      console.error(chalk.red("❌ Error processing scheduled tasks:"), error.message)
    }
  }

  // Process calls for a specific cadence step
  async processCallsForCadenceStep(cadenceStep) {
    try {
      const readyRecords = await this.trackingService.getRecordsReadyForCalling(cadenceStep)

      if (readyRecords.length === 0) {
        return
      }

      console.log(chalk.blue(`📞 Processing ${readyRecords.length} calls for cadence step ${cadenceStep}`))

      // Mark records as in progress immediately to prevent duplicate processing
      await this.markRecordsInProgress(readyRecords)

      // Process calls concurrently
      const callPromises = readyRecords.map(async (trackingRecord) => {
        const recordKey = `${trackingRecord.recordId}_${cadenceStep}`

        // Skip if already processing this record
        if (this.activeCallPromises.has(recordKey)) {
          console.log(chalk.yellow(`⏭️ Skipping ${trackingRecord.businessName} - already in progress`))
          return
        }

        // Mark as active
        const callPromise = this.processScheduledCall(trackingRecord)
        this.activeCallPromises.set(recordKey, callPromise)

        try {
          await callPromise
        } finally {
          // Remove from active calls when done
          this.activeCallPromises.delete(recordKey)
        }
      })

      await Promise.all(callPromises)
    } catch (error) {
      console.error(chalk.red(`❌ Error processing calls for cadence step ${cadenceStep}:`), error.message)
    }
  }

  // Mark records as in progress to prevent duplicate processing
  async markRecordsInProgress(trackingRecords) {
    try {
      const callCollection = getCollection(
        OUTREACH_CONFIG.DATABASE.TRACKING_DB_NAME,
        OUTREACH_CONFIG.DATABASE.CALL_TRACKING_COLLECTION,
      )

      const recordIds = trackingRecords.map((record) => record._id)

      await callCollection.updateMany(
        { _id: { $in: recordIds } },
        {
          $set: {
            "call.nextScheduleAt": new Date(Date.now() + 10 * 60 * 1000), // Set 10 minutes in future to prevent immediate reprocessing
            "call.isActive": true,
            lastUpdatedAt: new Date(),
          },
        },
      )

      console.log(chalk.gray(`🔒 Marked ${recordIds.length} records as in progress`))
    } catch (error) {
      console.error(chalk.red("❌ Error marking records in progress:"), error.message)
    }
  }

  // Process single scheduled call
  async processScheduledCall(trackingRecord) {
    try {
      console.log(
        chalk.blue(
          `📞 Making call attempt ${trackingRecord.currentCadenceStep + 1} for ${trackingRecord.businessName}`,
        ),
      )

      // Use contactInfo for phone numbers - with fallback to main record
      const contactInfo = trackingRecord.contactInfo || { phoneNumbers: [], emails: [] }

      // If contactInfo is empty, fetch from main record
      if (contactInfo.phoneNumbers.length === 0) {
        console.log(chalk.yellow(`📋 ContactInfo empty, fetching from main record for ${trackingRecord.businessName}`))
        const mainCollection = getCollection(trackingRecord.databaseName, trackingRecord.collectionName)
        const mainRecord = await mainCollection.findOne({ _id: await toObjectId(trackingRecord.recordId) })

        if (mainRecord) {
          // Copy phone numbers from main record
          if (mainRecord.phonenumber) {
            const formattedPhone = this.outreachService.formatPhoneNumber(mainRecord.phonenumber)
            contactInfo.phoneNumbers.push(formattedPhone)
          }

          // Copy emails from main record
          if (mainRecord.email) {
            if (Array.isArray(mainRecord.email)) {
              contactInfo.emails.push(...mainRecord.email.filter((email) => email && email.includes("@")))
            } else if (typeof mainRecord.email === "string" && mainRecord.email.includes("@")) {
              contactInfo.emails.push(mainRecord.email)
            }
          }

          // Update tracking record with contactInfo
          await this.trackingService.updateContactInfo(trackingRecord._id, contactInfo)
          console.log(
            chalk.blue(`📋 Updated contactInfo for ${trackingRecord.businessName}:`, JSON.stringify(contactInfo)),
          )
        }
      }

      const phoneNumbers = contactInfo.phoneNumbers || []
      if (phoneNumbers.length === 0) {
        throw new Error("No phone numbers available in contactInfo")
      }

      const phoneNumber = this.outreachService.formatPhoneNumber(phoneNumbers[0])
      console.log(chalk.blue(`📱 Using phone number from contactInfo: ${phoneNumber}`))

      // Make the call
      const callInitResult = await this.outreachService.initiateCall(phoneNumber, trackingRecord.businessName)
      const callResults = await this.outreachService.waitForCallCompletion(callInitResult.conversationId)

      const callResult = {
        attemptNumber: trackingRecord.currentCadenceStep + 1, // Use cadence step + 1 for proper numbering
        status: callResults.callSuccessful ? "successful" : "failed",
        duration: callResults.callDuration,
        conversationId: callResults.conversationId,
        isPartneredWithInfinityClub: callResults.isPartneredWithInfinityClub,
      }

      // Update tracking record
      const updateResult = await this.trackingService.updateCallTracking(trackingRecord._id, callResult)

      // Sync to main record
      const updatedRecord = await this.getUpdatedTrackingRecord(trackingRecord._id)
      if (updatedRecord) {
        await this.trackingService.syncToMainRecord(updatedRecord)
      }

      console.log(chalk.green(`✅ Call completed for ${trackingRecord.businessName}`))
    } catch (error) {
      console.error(chalk.red(`❌ Error in scheduled call for ${trackingRecord.recordId}:`), error.message)

      // Check if this was a call initiation failure vs timeout
      const isInitiationFailure = error.message.includes("initiating call") || error.response?.status >= 400
      const isTimeout = error.message.includes("timeout") || error.message.includes("did not complete")

      if (isInitiationFailure) {
        console.log(
          chalk.yellow(`📞 Call initiation failed - not counting as attempt for ${trackingRecord.businessName}`),
        )
        // Reset the nextScheduleAt to allow retry
        await this.trackingService.resetCallSchedule(trackingRecord._id)
        return
      }

      // For timeouts or other call failures, mark as failed attempt
      const failedResult = {
        attemptNumber: trackingRecord.currentCadenceStep + 1,
        status: "failed",
        duration: 0,
        conversationId: null,
        isPartneredWithInfinityClub: null,
      }

      await this.trackingService.updateCallTracking(trackingRecord._id, failedResult)

      // Sync to main record
      const updatedRecord = await this.getUpdatedTrackingRecord(trackingRecord._id)
      if (updatedRecord) {
        await this.trackingService.syncToMainRecord(updatedRecord)
      }
    }
  }

  // Process scheduled emails (cadence step 4)
  async processScheduledEmails() {
    try {
      const readyRecords = await this.trackingService.getRecordsReadyForEmail()

      if (readyRecords.length === 0) {
        return
      }

      console.log(chalk.blue(`📧 Processing ${readyRecords.length} scheduled emails`))

      for (const trackingRecord of readyRecords) {
        try {
          await this.processScheduledEmail(trackingRecord)
        } catch (error) {
          console.error(chalk.red(`❌ Error processing email for ${trackingRecord.recordId}:`), error.message)
        }
      }
    } catch (error) {
      console.error(chalk.red("❌ Error processing scheduled emails:"), error.message)
    }
  }

  // Process single scheduled email
  async processScheduledEmail(trackingRecord) {
    try {
      console.log(chalk.blue(`📧 Sending scheduled email for ${trackingRecord.businessName}`))

      // Use contactInfo for emails - with fallback to main record
      const contactInfo = trackingRecord.contactInfo || { phoneNumbers: [], emails: [] }

      // If contactInfo emails are empty, fetch from main record
      if (contactInfo.emails.length === 0) {
        console.log(
          chalk.yellow(`📋 No emails in contactInfo, fetching from main record for ${trackingRecord.businessName}`),
        )
        const mainCollection = getCollection(trackingRecord.databaseName, trackingRecord.collectionName)
        const mainRecord = await mainCollection.findOne({ _id: await toObjectId(trackingRecord.recordId) })

        if (mainRecord && mainRecord.email) {
          if (Array.isArray(mainRecord.email)) {
            contactInfo.emails.push(...mainRecord.email.filter((email) => email && email.includes("@")))
          } else if (typeof mainRecord.email === "string" && mainRecord.email.includes("@")) {
            contactInfo.emails.push(mainRecord.email)
          }

          // Update tracking record with contactInfo
          await this.trackingService.updateContactInfo(trackingRecord._id, contactInfo)
          console.log(
            chalk.blue(
              `📋 Updated email contactInfo for ${trackingRecord.businessName}:`,
              JSON.stringify(contactInfo.emails),
            ),
          )
        }
      }

      const emailAddresses = contactInfo.emails || []
      if (emailAddresses.length === 0) {
        throw new Error("No email addresses available in contactInfo")
      }

      // Generate email
      const emailData = await this.outreachService.generatePersonalizedEmail(trackingRecord.businessName)

      let totalSent = 0
      const totalAttempted = emailAddresses.length

      // Send emails with delay
      for (let i = 0; i < emailAddresses.length; i++) {
        const emailAddress = emailAddresses[i]
        try {
          console.log(chalk.blue(`📧 Sending email ${i + 1}/${emailAddresses.length} to ${emailAddress}`))
          const result = await this.outreachService.sendEmail(emailAddress, emailData, trackingRecord.businessName)

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

      // Update tracking record
      const emailResult = {
        success: totalSent > 0,
        totalSent: totalSent,
        totalAttempted: totalAttempted,
        subject: emailData.subject,
      }

      await this.trackingService.updateEmailTracking(trackingRecord._id, emailResult)

      // Sync to main record
      const updatedRecord = await this.getUpdatedTrackingRecord(trackingRecord._id)
      if (updatedRecord) {
        await this.trackingService.syncToMainRecord(updatedRecord)
      }

      console.log(
        chalk.green(
          `✅ Scheduled email completed for ${trackingRecord.businessName} (${totalSent}/${totalAttempted} sent)`,
        ),
      )
    } catch (error) {
      console.error(chalk.red(`❌ Error in scheduled email for ${trackingRecord.recordId}:`), error.message)

      // Check if this was an email generation failure
      const isGenerationFailure = error.message.includes("generating") || error.message.includes("overloaded")

      const failedResult = {
        success: false,
        error: error.message,
        subject: isGenerationFailure ? "Email Generation Failed" : "Email Send Failed",
        totalSent: 0,
        totalAttempted: trackingRecord.contactInfo?.emails?.length || 0,
      }

      await this.trackingService.updateEmailTracking(trackingRecord._id, failedResult)
    }
  }

  // Get updated tracking record
  async getUpdatedTrackingRecord(trackingId) {
    try {
      const callCollection = getCollection(
        OUTREACH_CONFIG.DATABASE.TRACKING_DB_NAME,
        OUTREACH_CONFIG.DATABASE.CALL_TRACKING_COLLECTION,
      )
      const objectId = await toObjectId(trackingId)
      return await callCollection.findOne({ _id: objectId })
    } catch (error) {
      console.error(chalk.red(`❌ Error getting updated tracking record ${trackingId}:`), error.message)
      return null
    }
  }

  // Get campaign status
  async getCampaignStatus(recordIds = null) {
    return await this.trackingService.getTrackingStatus(recordIds)
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
