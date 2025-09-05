import { getCollection, toObjectId } from "../database/mongodb.js"
import OUTREACH_CONFIG from "../config/constants.js"
import chalk from "chalk"

export class TrackingService {
  constructor() {
    this.trackingDbName = OUTREACH_CONFIG.DATABASE.TRACKING_DB_NAME
    this.callTrackingCollection = OUTREACH_CONFIG.DATABASE.CALL_TRACKING_COLLECTION
    this.emailTrackingCollection = OUTREACH_CONFIG.DATABASE.EMAIL_TRACKING_COLLECTION
  }

  // Initialize tracking collections (create if they don't exist)
  async initializeTrackingCollections() {
    try {
      // Ensure tracking database exists by creating collections
      const callCollection = getCollection(this.trackingDbName, this.callTrackingCollection)
      const emailCollection = getCollection(this.trackingDbName, this.emailTrackingCollection)

      // Create indexes for better performance
      await callCollection.createIndex({ recordId: 1 })
      await callCollection.createIndex({ "call.nextScheduleAt": 1 })
      await callCollection.createIndex({ status: 1 })
      await callCollection.createIndex({ currentCadenceStep: 1 })
      await callCollection.createIndex({ isPartnered: 1 })

      await emailCollection.createIndex({ recordId: 1 })
      await emailCollection.createIndex({ status: 1 })
      await emailCollection.createIndex({ "email.nextScheduleEmailAt": 1 })

      // Verify collections exist by counting documents
      const callCount = await callCollection.countDocuments({})
      const emailCount = await emailCollection.countDocuments({})

      console.log(
        chalk.green(
          `✅ Tracking collections initialized successfully: ${this.trackingDbName}.${this.callTrackingCollection} (${callCount} records), ${this.trackingDbName}.${this.emailTrackingCollection} (${emailCount} records)`,
        ),
      )
    } catch (error) {
      console.error(chalk.red("❌ Error initializing tracking collections:"), error.message)
      throw error
    }
  }

  // Calculate next call time based on cadence step
  calculateNextCallTime(cadenceStep, campaignStartTime = null) {
    const schedule = OUTREACH_CONFIG.CALLS.SCHEDULE

    if (cadenceStep >= schedule.length) {
      return null // No more calls scheduled
    }

    const scheduleItem = schedule[cadenceStep]

    // Use campaign start time if provided, otherwise use current time
    const baseTime = campaignStartTime || new Date()

    if (scheduleItem.minutes !== undefined) {
      // Testing mode: add minutes to the BASE TIME (campaign start), not current time
      return new Date(baseTime.getTime() + scheduleItem.minutes * 60 * 1000)
    } else {
      // Production mode: schedule for specific day/time
      const targetDate = new Date(baseTime)
      targetDate.setDate(baseTime.getDate() + scheduleItem.day - 1)
      targetDate.setHours(scheduleItem.hour, scheduleItem.minute, 0, 0)

      // If the time has passed today, schedule for next week
      if (targetDate <= baseTime) {
        targetDate.setDate(targetDate.getDate() + 7)
      }

      return targetDate
    }
  }

  // Check if record already exists in tracking and determine action
  async checkExistingTrackingRecord(recordId) {
    try {
      const callCollection = getCollection(this.trackingDbName, this.callTrackingCollection)
      const existingRecord = await callCollection.findOne({ recordId: recordId })

      if (!existingRecord) {
        return { exists: false, action: "create" }
      }

      // Check if email has been sent (currentCadenceStep >= 4 or status is 'emailed' or beyond)
      const emailSentStatuses = ["emailed", "partner", "archived"]
      if (emailSentStatuses.includes(existingRecord.status) || existingRecord.currentCadenceStep >= 4) {
        return {
          exists: true,
          action: "reset",
          existingRecord: existingRecord,
          reason: "Email already sent - can reset for rescrape",
        }
      } else {
        return {
          exists: true,
          action: "skip",
          existingRecord: existingRecord,
          reason: "Record exists and email not yet sent",
        }
      }
    } catch (error) {
      console.error(chalk.red(`❌ Error checking existing tracking record for ${recordId}:`), error.message)
      return { exists: false, action: "create" }
    }
  }

  // Reset tracking record for rescrape
  async resetTrackingRecord(recordId, mainRecord, userId = "system") {
    try {
      const callCollection = getCollection(this.trackingDbName, this.callTrackingCollection)
      const campaignStartTime = new Date()
      const nextCallTime = this.calculateNextCallTime(0, campaignStartTime)

      // Get fresh contactInfo from main record - ALWAYS use contactInfo
      const contactInfo = mainRecord.outreach?.contactInfo || {
        phoneNumbers: [],
        emails: [],
      }

      // Populate contactInfo if empty
      if (contactInfo.phoneNumbers.length === 0 && mainRecord.phonenumber) {
        const phoneStr = mainRecord.phonenumber.toString()
        if (!contactInfo.phoneNumbers.includes(phoneStr)) {
          contactInfo.phoneNumbers.push(phoneStr)
        }
      }

      if (contactInfo.emails.length === 0 && mainRecord.email) {
        if (Array.isArray(mainRecord.email)) {
          for (const email of mainRecord.email) {
            if (email && typeof email === "string" && email.includes("@") && !contactInfo.emails.includes(email)) {
              contactInfo.emails.push(email)
            }
          }
        } else if (
          typeof mainRecord.email === "string" &&
          mainRecord.email.includes("@") &&
          !contactInfo.emails.includes(mainRecord.email)
        ) {
          contactInfo.emails.push(mainRecord.email)
        }
      }

      const resetData = {
        status: "lead",
        currentCadenceStep: 0,
        isPartnered: false,
        call: {
          overallAttemptNumber: 0,
          nextScheduleAt: nextCallTime,
          lastCallAt: null,
          lastCallStatus: null,
          lastCallDuration: null,
          lastConversationId: null,
          isActive: false,
        },
        email: {
          emailSentCount: 0,
          nextScheduleEmailAt: null,
          lastEmailAt: null,
          lastEmailStatus: null,
          lastEmailSubject: null,
        },
        contactInfo: contactInfo,
        campaignStartTime: campaignStartTime,
        lastUpdatedAt: new Date(),
        resetAt: new Date(),
        resetBy: userId,
        callHistory: [],
        // Preserve original data
        originalData: {
          businessname: mainRecord.businessname,
          phonenumber: mainRecord.phonenumber,
          email: mainRecord.email,
          address: mainRecord.address,
          postcode: mainRecord.postcode,
          website: mainRecord.website,
          category: mainRecord.category,
          subcategory: mainRecord.subcategory,
        },
      }

      await callCollection.updateOne({ recordId: recordId }, { $set: resetData })

      console.log(chalk.blue(`🔄 Reset tracking record for ${mainRecord.businessname} (${recordId})`))
      return { success: true, action: "reset" }
    } catch (error) {
      console.error(chalk.red(`❌ Error resetting tracking record for ${recordId}:`), error.message)
      throw error
    }
  }

  // Create new tracking record
  async createTrackingRecord(recordId, mainRecord, userId = "system") {
    try {
      const campaignStartTime = new Date()
      const nextCallTime = this.calculateNextCallTime(0, campaignStartTime)

      // Get contactInfo from main record - ALWAYS use contactInfo
      const contactInfo = mainRecord.outreach?.contactInfo || {
        phoneNumbers: [],
        emails: [],
      }

      // Populate contactInfo if empty
      if (contactInfo.phoneNumbers.length === 0 && mainRecord.phonenumber) {
        const phoneStr = mainRecord.phonenumber.toString()
        if (!contactInfo.phoneNumbers.includes(phoneStr)) {
          contactInfo.phoneNumbers.push(phoneStr)
        }
      }

      if (contactInfo.emails.length === 0 && mainRecord.email) {
        if (Array.isArray(mainRecord.email)) {
          for (const email of mainRecord.email) {
            if (email && typeof email === "string" && email.includes("@") && !contactInfo.emails.includes(email)) {
              contactInfo.emails.push(email)
            }
          }
        } else if (
          typeof mainRecord.email === "string" &&
          mainRecord.email.includes("@") &&
          !contactInfo.emails.includes(mainRecord.email)
        ) {
          contactInfo.emails.push(mainRecord.email)
        }
      }

      const trackingRecord = {
        recordId: recordId,
        databaseName: mainRecord._databaseName || "unknown",
        collectionName: mainRecord._collectionName || "unknown",
        businessName: mainRecord.businessname,

        // New structure fields matching your requirements
        status: "lead", // lead, called1, called2, called3, called4, emailed, partner, archived
        currentCadenceStep: 0, // 0=first call, 1=second call, 2=third call, 3=fourth call, 4=email
        isPartnered: false,

        // Call tracking
        call: {
          overallAttemptNumber: 0,
          nextScheduleAt: nextCallTime,
          lastCallAt: null,
          lastCallStatus: null,
          lastCallDuration: null,
          lastConversationId: null,
          isActive: false,
        },

        // Email tracking
        email: {
          emailSentCount: 0,
          nextScheduleEmailAt: null,
          lastEmailAt: null,
          lastEmailStatus: null,
          lastEmailSubject: null,
        },

        // Contact information from main record
        contactInfo: contactInfo,

        // Campaign timing
        campaignStartTime: campaignStartTime,
        callHistory: [],

        // Copy additional fields from main record
        originalData: {
          businessname: mainRecord.businessname,
          phonenumber: mainRecord.phonenumber,
          email: mainRecord.email,
          address: mainRecord.address,
          postcode: mainRecord.postcode,
          website: mainRecord.website,
          category: mainRecord.category,
          subcategory: mainRecord.subcategory,
          // Add any other fields you want to preserve
        },

        // Metadata
        createdAt: new Date(),
        createdBy: userId,
        lastUpdatedAt: new Date(),
      }

      return trackingRecord
    } catch (error) {
      console.error(chalk.red(`❌ Error creating tracking record for ${recordId}:`), error.message)
      throw error
    }
  }

  // Add records to call tracking with new structure
  async addToCallTracking(databaseName, collectionName, recordIds, userId = "system") {
    try {
      const callCollection = getCollection(this.trackingDbName, this.callTrackingCollection)
      const mainCollection = getCollection(databaseName, collectionName)

      const trackingRecords = []
      const skippedRecords = []
      const resetRecords = []

      for (const recordId of recordIds) {
        const objectId = await toObjectId(recordId)

        // Check if record exists in main collection
        const mainRecord = await mainCollection.findOne({ _id: objectId })
        if (!mainRecord) {
          console.log(chalk.yellow(`⚠️ Record ${recordId} not found in main collection`))
          skippedRecords.push({ recordId, reason: "Record not found in main collection" })
          continue
        }

        // Add database and collection info to the record for tracking
        mainRecord._databaseName = databaseName
        mainRecord._collectionName = collectionName

        // Check if record already exists in tracking
        const existingCheck = await this.checkExistingTrackingRecord(recordId)

        if (existingCheck.action === "skip") {
          console.log(chalk.yellow(`⚠️ Skipping record ${recordId}: ${existingCheck.reason}`))
          skippedRecords.push({ recordId, reason: existingCheck.reason })
          continue
        } else if (existingCheck.action === "reset") {
          console.log(chalk.blue(`🔄 Resetting record ${recordId}: ${existingCheck.reason}`))
          await this.resetTrackingRecord(recordId, mainRecord, userId)
          resetRecords.push({ recordId, reason: existingCheck.reason })
          continue
        }

        // Create new tracking record
        const trackingRecord = await this.createTrackingRecord(recordId, mainRecord, userId)
        trackingRecords.push(trackingRecord)

        // Update main record with initial outreach status
        await mainCollection.updateOne(
          { _id: objectId },
          {
            $set: {
              "outreach.status": "processing",
              "outreach.lastUpdatedAt": new Date(),
              "outreach.campaignType": "scheduled_calls",
              "outreach.contactInfo": trackingRecord.contactInfo,
            },
          },
        )

        console.log(chalk.green(`✅ Created tracking record for ${mainRecord.businessname} (${recordId})`))
      }

      // Insert new tracking records
      if (trackingRecords.length > 0) {
        await callCollection.insertMany(trackingRecords)
      }

      const summary = {
        success: true,
        recordsAdded: trackingRecords.length,
        recordsReset: resetRecords.length,
        recordsSkipped: skippedRecords.length,
        trackingRecords: trackingRecords,
        skippedRecords: skippedRecords,
        resetRecords: resetRecords,
      }

      console.log(chalk.green(`✅ Call tracking summary:`))
      console.log(chalk.white(`   Added: ${summary.recordsAdded}`))
      console.log(chalk.white(`   Reset: ${summary.recordsReset}`))
      console.log(chalk.white(`   Skipped: ${summary.recordsSkipped}`))

      return summary
    } catch (error) {
      console.error(chalk.red("❌ Error adding records to call tracking:"), error.message)
      throw error
    }
  }

  // Get records ready for calling based on cadence step
  async getRecordsReadyForCalling(cadenceStep = null) {
    try {
      const callCollection = getCollection(this.trackingDbName, this.callTrackingCollection)
      const now = new Date()

      const query = {
        "call.nextScheduleAt": { $lte: now },
        "call.isActive": { $ne: true }, // Not currently being processed
        currentCadenceStep: { $lt: 4 }, // Only steps 0, 1, 2, 3 (calls), not 4 (email)
        status: { $in: ["lead", "called1", "called2", "called3"] }, // Not called4, emailed, partner, or archived
      }

      // If cadenceStep is specified, filter by it
      if (cadenceStep !== null) {
        query.currentCadenceStep = cadenceStep
      }

      const readyRecords = await callCollection.find(query).toArray()

      if (readyRecords.length > 0) {
        console.log(
          chalk.blue(
            `📞 Found ${readyRecords.length} records ready for calling${cadenceStep !== null ? ` (cadence step ${cadenceStep})` : ""}`,
          ),
        )
      }

      return readyRecords
    } catch (error) {
      console.error(chalk.red("❌ Error getting records ready for calling:"), error.message)
      throw error
    }
  }

  // Get records ready for email (cadence step 4)
  async getRecordsReadyForEmail() {
    try {
      const callCollection = getCollection(this.trackingDbName, this.callTrackingCollection)

      const readyRecords = await callCollection
        .find({
          currentCadenceStep: 4, // Email step
          status: "called4", // Completed all calls
          "email.emailSentCount": 0, // Haven't sent emails yet
        })
        .toArray()

      if (readyRecords.length > 0) {
        console.log(chalk.blue(`📧 Found ${readyRecords.length} records ready for email (cadence step 4)`))
      }

      return readyRecords
    } catch (error) {
      console.error(chalk.red("❌ Error getting records ready for email:"), error.message)
      throw error
    }
  }

  // Update tracking record after call attempt
  async updateCallTracking(trackingId, callResult) {
    try {
      const callCollection = getCollection(this.trackingDbName, this.callTrackingCollection)
      const objectId = await toObjectId(trackingId)

      // Get current record to determine next step
      const currentRecord = await callCollection.findOne({ _id: objectId })
      if (!currentRecord) {
        throw new Error(`Tracking record ${trackingId} not found`)
      }

      const currentStep = currentRecord.currentCadenceStep
      const nextStep = currentStep + 1
      const maxCallSteps = 4 // Steps 0, 1, 2, 3 are calls; step 4 is email

      // Determine new status based on current step
      const statusMap = {
        0: "called1",
        1: "called2",
        2: "called3",
        3: "called4",
      }
      const newStatus = statusMap[currentStep] || "called4"

      // Calculate next call time if not the last call attempt
      let nextCallTime = null
      if (nextStep < maxCallSteps) {
        nextCallTime = this.calculateNextCallTime(nextStep, currentRecord.campaignStartTime)
      }

      const updateData = {
        $push: {
          callHistory: {
            attemptNumber: currentStep + 1, // Use cadence step + 1 for proper attempt numbering
            cadenceStep: currentStep,
            callTime: new Date(),
            status: callResult.status,
            duration: callResult.duration,
            conversationId: callResult.conversationId,
            isPartneredWithInfinityClub: callResult.isPartneredWithInfinityClub,
          },
        },
        $set: {
          status: newStatus,
          currentCadenceStep: nextStep < maxCallSteps ? nextStep : 4, // Move to email step (4) after last call
          "call.overallAttemptNumber": currentRecord.call.overallAttemptNumber + 1,
          "call.nextScheduleAt": nextCallTime,
          "call.lastCallAt": new Date(),
          "call.lastCallStatus": callResult.status,
          "call.lastCallDuration": callResult.duration,
          "call.lastConversationId": callResult.conversationId,
          "call.isActive": false, // Mark as not active
          lastUpdatedAt: new Date(),
        },
      }

      // Update isPartnered if we got a result
      if (callResult.isPartneredWithInfinityClub !== null && callResult.isPartneredWithInfinityClub !== undefined) {
        updateData.$set.isPartnered = callResult.isPartneredWithInfinityClub
        if (callResult.isPartneredWithInfinityClub === true) {
          updateData.$set.status = "partner"
        }
      }

      await callCollection.updateOne({ _id: objectId }, updateData)

      console.log(chalk.green(`✅ Updated call tracking for record ${trackingId}:`))
      console.log(chalk.white(`   Status: ${currentRecord.status} → ${newStatus}`))
      console.log(chalk.white(`   Cadence Step: ${currentStep} → ${nextStep < maxCallSteps ? nextStep : 4}`))
      console.log(chalk.white(`   Next Call: ${nextCallTime ? nextCallTime.toLocaleString() : "Moving to email step"}`))
      console.log(chalk.white(`   Is Partnered: ${callResult.isPartneredWithInfinityClub}`))

      return {
        newStatus,
        nextStep: nextStep < maxCallSteps ? nextStep : 4,
        nextCallTime,
        isLastCall: nextStep >= maxCallSteps,
      }
    } catch (error) {
      console.error(chalk.red("❌ Error updating call tracking:"), error.message)
      throw error
    }
  }

  // Update email tracking after sending (cadence step 4 completed)
  async updateEmailTracking(trackingId, emailResult) {
    try {
      const callCollection = getCollection(this.trackingDbName, this.callTrackingCollection)
      const objectId = await toObjectId(trackingId)

      const updateData = {
        $set: {
          status: emailResult.success ? "emailed" : "called4", // Don't mark as emailed if failed
          currentCadenceStep: 4,
          "email.emailSentCount": emailResult.totalSent || 0,
          "email.lastEmailAt": new Date(),
          "email.lastEmailStatus": emailResult.success ? "sent" : "failed",
          "email.lastEmailSubject": emailResult.subject,
          lastUpdatedAt: new Date(),
        },
      }

      if (!emailResult.success && emailResult.error) {
        updateData.$set["email.lastEmailError"] = emailResult.error
      }

      await callCollection.updateOne({ _id: objectId }, updateData)
      console.log(
        chalk.green(
          `✅ Updated email tracking for record ${trackingId} - Status: ${emailResult.success ? "emailed" : "failed"}, Emails Sent: ${emailResult.totalSent || 0}`,
        ),
      )
    } catch (error) {
      console.error(chalk.red("❌ Error updating email tracking:"), error.message)
      throw error
    }
  }

  // Update contactInfo for a tracking record
  async updateContactInfo(trackingId, contactInfo) {
    try {
      const callCollection = getCollection(this.trackingDbName, this.callTrackingCollection)
      const objectId = await toObjectId(trackingId)

      await callCollection.updateOne(
        { _id: objectId },
        {
          $set: {
            contactInfo: contactInfo,
            lastUpdatedAt: new Date(),
          },
        },
      )

      console.log(chalk.blue(`✅ Updated contactInfo for tracking record ${trackingId}`))
    } catch (error) {
      console.error(chalk.red(`❌ Error updating contactInfo for ${trackingId}:`), error.message)
      throw error
    }
  }

  // Reset call schedule for failed initiation
  async resetCallSchedule(trackingId) {
    try {
      const callCollection = getCollection(this.trackingDbName, this.callTrackingCollection)
      const objectId = await toObjectId(trackingId)

      // Reset to try again in 5 minutes
      const nextTryTime = new Date(Date.now() + 5 * 60 * 1000)

      await callCollection.updateOne(
        { _id: objectId },
        {
          $set: {
            "call.nextScheduleAt": nextTryTime,
            "call.isActive": false,
            lastUpdatedAt: new Date(),
          },
        },
      )

      console.log(chalk.yellow(`🔄 Reset call schedule for tracking record ${trackingId} - retry in 5 minutes`))
    } catch (error) {
      console.error(chalk.red(`❌ Error resetting call schedule for ${trackingId}:`), error.message)
      throw error
    }
  }

  // Update main record with tracking data (sync back)
  async syncToMainRecord(trackingRecord) {
    try {
      const mainCollection = getCollection(trackingRecord.databaseName, trackingRecord.collectionName)
      const recordObjectId = await toObjectId(trackingRecord.recordId)

      const updateData = {
        $set: {
          "outreach.status": trackingRecord.status,
          "outreach.lastUpdatedAt": new Date(),
          "outreach.alignment.status": trackingRecord.isPartnered,
          "outreach.call.overallAttemptNumber": trackingRecord.call.overallAttemptNumber,
          "outreach.call.lastCallStatus": trackingRecord.call.lastCallStatus,
          "outreach.call.lastCallAt": trackingRecord.call.lastCallAt,
          "outreach.call.lastCallDuration": trackingRecord.call.lastCallDuration,
          "outreach.call.lastConversationId": trackingRecord.call.lastConversationId,
          "outreach.email.emailsSentCount": trackingRecord.email.emailSentCount,
          "outreach.email.lastEmailStatus": trackingRecord.email.lastEmailStatus,
          "outreach.email.lastEmailAt": trackingRecord.email.lastEmailAt,
          "outreach.email.lastEmailSubject": trackingRecord.email.lastEmailSubject,
          "outreach.contactInfo": trackingRecord.contactInfo,
        },
      }

      await mainCollection.updateOne({ _id: recordObjectId }, updateData)
      console.log(chalk.green(`✅ Synced tracking data to main record ${trackingRecord.recordId}`))
    } catch (error) {
      console.error(chalk.red(`❌ Error syncing to main record ${trackingRecord.recordId}:`), error.message)
      throw error
    }
  }

  // Get tracking status for records
  async getTrackingStatus(recordIds = null) {
    try {
      const callCollection = getCollection(this.trackingDbName, this.callTrackingCollection)

      const query = recordIds ? { recordId: { $in: recordIds } } : {}

      const trackingRecords = await callCollection.find(query).toArray()

      // Group by status
      const statusCounts = {}
      const cadenceStepCounts = {}
      trackingRecords.forEach((record) => {
        statusCounts[record.status] = (statusCounts[record.status] || 0) + 1
        cadenceStepCounts[record.currentCadenceStep] = (cadenceStepCounts[record.currentCadenceStep] || 0) + 1
      })

      return {
        totalRecords: trackingRecords.length,
        statusCounts: statusCounts,
        cadenceStepCounts: cadenceStepCounts,
        records: trackingRecords,
      }
    } catch (error) {
      console.error(chalk.red("❌ Error getting tracking status:"), error.message)
      throw error
    }
  }
}

export default TrackingService
