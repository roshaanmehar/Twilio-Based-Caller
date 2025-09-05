import { getCollection, toObjectId } from "../database/mongodb.js"
import axios from "axios"
import chalk from "chalk"

export class OutreachService {
  constructor(elevenLabsConfig, geminiConfig, zapierConfig) {
    this.elevenLabsConfig = elevenLabsConfig
    this.geminiConfig = geminiConfig
    this.zapierConfig = zapierConfig
  }

  // Determine which agent to use based on attempt number
  getAgentForAttempt(attemptNumber) {
    // Attempt 1 & 3: Agent 1, Attempt 2 & 4: Agent 2
    const useAgent1 = attemptNumber === 1 || attemptNumber === 3
    const agentConfig = useAgent1 ? this.elevenLabsConfig.agent1 : this.elevenLabsConfig.agent2
    const agentName = useAgent1 ? "Agent 1" : "Agent 2"

    console.log(chalk.blue(`🤖 Using ${agentName} for attempt ${attemptNumber}`))

    return {
      config: agentConfig,
      name: agentName,
    }
  }

  // Check if record is eligible for outreach
  async isEligibleForOutreach(record) {
    const status = record.outreach?.status
    if (status === "processed" || status === "failed") {
      console.log(chalk.yellow(`⏭️ Skipping record ${record._id}: Status is ${status}`))
      return false
    }

    if (status !== "idle") {
      console.log(chalk.yellow(`⏭️ Skipping record ${record._id}: Status is ${status} (not idle)`))
      return false
    }

    if (!record.phonenumber) {
      console.log(chalk.yellow(`⏭️ Skipping record ${record._id}: No phone number`))
      return false
    }

    return true
  }

  // Format phone number to E.164 format
  formatPhoneNumber(phoneNumber) {
    // Convert to string and remove any non-digits
    let cleaned = phoneNumber.toString().replace(/\D/g, "")

    // If it doesn't start with country code, assume UK (+44)
    if (!cleaned.startsWith("44") && cleaned.length <= 11) {
      // Remove leading 0 if present and add UK country code
      if (cleaned.startsWith("0")) {
        cleaned = "44" + cleaned.substring(1)
      } else {
        cleaned = "44" + cleaned
      }
    }

    return "+" + cleaned
  }

  // Initiate call using Eleven Labs with agent selection
  async initiateCall(phoneNumber, businessName, attemptNumber = 1) {
    try {
      const agent = this.getAgentForAttempt(attemptNumber)

      console.log(chalk.blue(`📞 Initiating call to ${phoneNumber} for ${businessName} using ${agent.name}`))

      const response = await axios.post(
        "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
        {
          agent_id: agent.config.agentId,
          agent_phone_number_id: agent.config.phoneNumberId,
          to_number: phoneNumber,
          dynamicVariables: {
            businessName: businessName || "valued business partner",
          },
        },
        {
          headers: {
            "xi-api-key": agent.config.apiKey,
            "Content-Type": "application/json",
          },
        },
      )

      console.log(chalk.green(`✅ Call initiated successfully for ${businessName} using ${agent.name}`))
      return {
        success: true,
        callSid: response.data.callSid,
        conversationId: response.data.conversation_id,
        agentUsed: agent.name,
        agentConfig: agent.config,
      }
    } catch (error) {
      console.error(chalk.red(`❌ Error initiating call for ${businessName}:`), error.response?.data || error.message)
      throw error
    }
  }

  // FIXED: Properly parse partnership data from nested object structure
  parsePartnershipData(dataCollectionResults) {
    let isPartneredWithInfinityClub = null

    // Method 1: Direct boolean value
    if (typeof dataCollectionResults.isTheRestaurantPartneredWithInfinityClub === "boolean") {
      isPartneredWithInfinityClub = dataCollectionResults.isTheRestaurantPartneredWithInfinityClub
      console.log(chalk.blue(`🤝 Partnership status found (direct): ${isPartneredWithInfinityClub}`))
    }
    // Method 2: Object with value property (MOST COMMON)
    else if (
      dataCollectionResults.isTheRestaurantPartneredWithInfinityClub &&
      typeof dataCollectionResults.isTheRestaurantPartneredWithInfinityClub === "object" &&
      dataCollectionResults.isTheRestaurantPartneredWithInfinityClub.value !== undefined
    ) {
      isPartneredWithInfinityClub = dataCollectionResults.isTheRestaurantPartneredWithInfinityClub.value
      console.log(chalk.blue(`🤝 Partnership status found: ${isPartneredWithInfinityClub}`))
    }
    // Method 3: Search through all keys for partnership-related data
    else {
      for (const [key, value] of Object.entries(dataCollectionResults)) {
        const keyLower = key.toLowerCase()
        if (keyLower.includes("partner") || keyLower.includes("infinity")) {
          if (typeof value === "boolean") {
            isPartneredWithInfinityClub = value
            console.log(chalk.blue(`🤝 Partnership status found: ${isPartneredWithInfinityClub}`))
            break
          } else if (value && typeof value === "object" && value.value !== undefined) {
            isPartneredWithInfinityClub = value.value
            console.log(chalk.blue(`🤝 Partnership status found: ${isPartneredWithInfinityClub}`))
            break
          }
        }
      }
    }

    // Final validation - ensure it's a boolean
    if (isPartneredWithInfinityClub !== null && typeof isPartneredWithInfinityClub !== "boolean") {
      console.log(chalk.yellow(`⚠️ Converting partnership value to boolean`))
      if (typeof isPartneredWithInfinityClub === "string") {
        const lowerValue = isPartneredWithInfinityClub.toLowerCase()
        if (lowerValue === "true" || lowerValue === "yes") {
          isPartneredWithInfinityClub = true
        } else if (lowerValue === "false" || lowerValue === "no") {
          isPartneredWithInfinityClub = false
        } else {
          isPartneredWithInfinityClub = null
        }
      } else {
        isPartneredWithInfinityClub = null
      }
    }

    return isPartneredWithInfinityClub
  }

  // Wait for call completion and get results (FIXED partnership data parsing)
  async waitForCallCompletion(conversationId, agentConfig, maxWaitTime = 400) {
    const startTime = Date.now()
    const pollInterval = 10000 // 10 seconds
    let callCompleted = false
    let conversationDetails = null

    console.log(chalk.cyan(`⏰ Monitoring call ${conversationId}...`))

    while (!callCompleted && Date.now() - startTime < maxWaitTime * 1000) {
      try {
        const response = await axios.get(`https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`, {
          headers: {
            "xi-api-key": agentConfig.apiKey,
          },
        })

        conversationDetails = response.data

        if (conversationDetails.status === "done" || conversationDetails.status === "failed") {
          callCompleted = true
          console.log(chalk.green(`✅ Call completed with status: ${conversationDetails.status}`))
        } else {
          await new Promise((resolve) => setTimeout(resolve, pollInterval))
        }
      } catch (pollError) {
        console.log(chalk.yellow(`⚠️ Polling error, retrying...`))
        await new Promise((resolve) => setTimeout(resolve, pollInterval))
      }
    }

    if (!callCompleted) {
      console.error(chalk.red(`❌ Call monitoring timeout after ${maxWaitTime} seconds`))
      throw new Error(`Call did not complete within ${maxWaitTime} seconds`)
    }

    // Extract and parse partnership data
    const analysisData = conversationDetails.analysis || {}
    const dataCollectionResults = analysisData.data_collection_results || {}
    const isPartneredWithInfinityClub = this.parsePartnershipData(dataCollectionResults)

    const callSuccessful =
      conversationDetails.call_successful === true ||
      analysisData.call_successful === "success" ||
      conversationDetails.analysis?.call_successful === "success"

    console.log(
      chalk.green(
        `✅ Call completed: ${callSuccessful ? "Success" : "Failed"}, Duration: ${conversationDetails.metadata?.call_duration_secs || "N/A"}s, Partnership: ${isPartneredWithInfinityClub}`,
      ),
    )

    return {
      status: conversationDetails.status,
      callSuccessful: callSuccessful,
      transcriptSummary: conversationDetails.transcript_summary || analysisData.transcript_summary,
      callDuration: conversationDetails.metadata?.call_duration_secs,
      isPartneredWithInfinityClub: isPartneredWithInfinityClub,
      dataCollectionResults: dataCollectionResults,
      conversationId: conversationId,
      fullAnalysis: analysisData,
    }
  }

  // Generate personalized email using Gemini (independent, not follow-up)
  async generatePersonalizedEmail(businessName) {
    try {
      console.log(chalk.blue(`🤖 Generating personalized email for ${businessName}`))

      const systemPrompt = `You are an expert business development email writer. Generate a professional introductory email about InfinityClub partnership opportunities.

IMPORTANT: You must respond with a valid JSON object in this exact format:
{
  "subject": "Email subject line here",
  "body": "Email body content here",
  "tone": "professional",
  "priority": "normal"
}

Context:
- Business Name: ${businessName}
- This is an INTRODUCTORY email
- Keep the email VERY concise (2-3 short paragraphs maximum)

Email Guidelines:
- Address the email to ${businessName}
- Introduce InfinityClub as a rewards sharing app for businesses
- Mention 1-2 key benefits: increased customer loyalty, new customer acquisition
- KEEP IT SHORT - no more than 150 words total
- DO NOT include any placeholders like [your name] or [team name]
- DO NOT mention any attachments or phone numbers
- Sign off simply as "Sincerely, Infinity Club"
- Make it personalized to ${businessName} but BRIEF

Write a concise, professional introduction email with NO PLACEHOLDERS.`

      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${this.geminiConfig.apiKey}`,
        {
          contents: [
            {
              parts: [
                {
                  text: systemPrompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 1024,
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      )

      const generatedText = response.data.candidates[0].content.parts[0].text

      // Try to extract JSON from the response
      let emailData
      try {
        const jsonMatch = generatedText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          emailData = JSON.parse(jsonMatch[0])
        } else {
          throw new Error("No JSON found in response")
        }
      } catch (parseError) {
        console.log(chalk.yellow("⚠️ Failed to parse JSON, creating fallback email..."))
        emailData = {
          subject: `Partnership Opportunity: InfinityClub for ${businessName}`,
          body: `Dear ${businessName} Team,

We're reaching out to introduce InfinityClub, a rewards sharing app designed to help businesses like yours increase customer loyalty and drive revenue growth. Our platform helps you retain existing customers and attract new ones through our rewards network.

If you're interested in learning more about how InfinityClub can benefit your business, please let us know.

Sincerely,
Infinity Club`,
          tone: "professional",
          priority: "normal",
        }
      }

      console.log(chalk.green("✅ Personalized email generated successfully"))
      return emailData
    } catch (error) {
      console.error(chalk.red("❌ Error generating personalized email:"), error.response?.data || error.message)
      throw error
    }
  }

  // Send email via Zapier
  async sendEmail(recipientEmail, emailData, businessName) {
    try {
      console.log(chalk.blue(`📧 Sending email to ${recipientEmail} for ${businessName}`))

      const zapierPayload = {
        to: recipientEmail,
        subject: emailData.subject,
        body: emailData.body,
        tone: emailData.tone || "professional",
        priority: emailData.priority || "normal",
        generated_by: "Gemini AI - Outreach Campaign",
        business_name: businessName,
        campaign_type: "InfinityClub Partnership Outreach",
      }

      const response = await axios.post(this.zapierConfig.webhookUrl, zapierPayload, {
        headers: { "Content-Type": "application/json" },
      })

      console.log(chalk.green(`✅ Email sent successfully to ${businessName}`))
      return {
        success: true,
        subject: emailData.subject,
        zapierResponse: response.data,
      }
    } catch (error) {
      console.error(chalk.red(`❌ Error sending email to ${businessName}:`), error.response?.data || error.message)
      return {
        success: false,
        error: error.message,
        subject: emailData.subject,
      }
    }
  }

  // Update MongoDB record after outreach (ENHANCED to store partnership data properly)
  async updateRecord(
    databaseName,
    collectionName,
    recordId,
    callResults,
    emailResults,
    phoneNumber,
    emailAddresses,
    contactInfo,
  ) {
    try {
      const collection = getCollection(databaseName, collectionName)
      const objectId = await toObjectId(recordId)

      // Determine overall outreach status
      const callWasSuccessful = callResults.callSuccessful === true
      const emailWasSent = emailResults && emailResults.success === true

      // Set overall status to "processed" only when BOTH call AND email succeed
      let outreachStatus = "failed"
      if (callWasSuccessful && emailWasSent) {
        outreachStatus = "processed"
      }

      // Determine call status
      const lastCallStatus = callWasSuccessful ? "successful" : "failed"

      console.log(chalk.magenta(`📊 Updating record with:`))
      console.log(chalk.white(`   Call Status: ${lastCallStatus}`))
      console.log(chalk.white(`   🤝 Partnership Status: ${callResults.isPartneredWithInfinityClub}`))
      console.log(chalk.white(`   Emails Sent: ${emailResults?.totalSent || 0}/${emailResults?.totalAttempted || 0}`))
      console.log(chalk.white(`   Overall Status: ${outreachStatus}`))

      // First, ensure contactInfo exists
      await collection.updateOne(
        { _id: objectId },
        {
          $set: {
            "outreach.status": outreachStatus,
            "outreach.lastUpdatedAt": new Date(),
            "outreach.alignment.status": callResults.isPartneredWithInfinityClub, // Store partnership status
            "outreach.alignment.lastCheckedAt": new Date(), // When we last checked partnership
            "outreach.call.isActive": false,
            "outreach.call.lastCallAt": new Date(),
            "outreach.call.lastCallDuration": callResults.callDuration,
            "outreach.call.lastCallStatus": lastCallStatus,
            "outreach.call.lastConversationId": callResults.conversationId,
            "outreach.email.isActive": false,
          },
          $inc: {
            "outreach.call.overallAttemptNumber": 1,
          },
        },
      )

      // Now update contactInfo separately to avoid conflicts
      if (!contactInfo) {
        contactInfo = {
          phoneNumbers: [],
          emails: [],
        }
      }

      // Add phone number if not already in the array
      if (phoneNumber && !contactInfo.phoneNumbers.includes(phoneNumber)) {
        contactInfo.phoneNumbers.push(phoneNumber)
      }

      // Add email addresses if not already in the array
      if (emailAddresses && emailAddresses.length > 0) {
        for (const email of emailAddresses) {
          if (!contactInfo.emails.includes(email)) {
            contactInfo.emails.push(email)
          }
        }
      }

      // Update contactInfo as a whole object
      await collection.updateOne(
        { _id: objectId },
        {
          $set: {
            "outreach.contactInfo": contactInfo,
          },
        },
      )

      // Add call results to outreach data (ENHANCED to include full analysis)
      if (callResults.dataCollectionResults) {
        await collection.updateOne(
          { _id: objectId },
          {
            $set: {
              "outreach.callResults": callResults.dataCollectionResults,
              "outreach.fullAnalysis": callResults.fullAnalysis, // Store full analysis for debugging
            },
          },
        )
      }

      // Update email-related fields
      if (emailResults) {
        const emailUpdate = {
          "outreach.email.lastEmailAt": new Date(),
          "outreach.email.lastEmailSubject": emailResults.subject,
        }

        if (emailResults.success) {
          emailUpdate["outreach.email.emailsSentCount"] = emailResults.totalSent || 1
          emailUpdate["outreach.email.totalEmailsAttempted"] = emailResults.totalAttempted || 1
          emailUpdate["outreach.email.lastEmailStatus"] = "sent"
        } else {
          emailUpdate["outreach.email.lastEmailStatus"] = "failed"
          emailUpdate["outreach.email.lastEmailError"] = emailResults.error
          emailUpdate["outreach.email.totalEmailsAttempted"] = emailResults.totalAttempted || 1
        }

        await collection.updateOne(
          { _id: objectId },
          {
            $set: emailUpdate,
          },
        )
      } else {
        await collection.updateOne(
          { _id: objectId },
          {
            $set: {
              "outreach.email.lastEmailStatus": "not_attempted",
            },
          },
        )
      }

      console.log(chalk.green(`✅ Record ${recordId} updated successfully`))
      return true
    } catch (error) {
      console.error(chalk.red(`❌ Error updating record ${recordId}:`), error.message)
      throw error
    }
  }

  // Process single record
  async processRecord(databaseName, collectionName, record, attemptNumber = 1) {
    try {
      console.log(
        chalk.cyan(`\n🔄 Processing record: ${record.businessname} (${record._id}) - Attempt ${attemptNumber}`),
      )

      // Check eligibility
      if (!(await this.isEligibleForOutreach(record))) {
        return {
          success: false,
          reason: "Not eligible for outreach",
          recordId: record._id,
        }
      }

      // Get EXISTING contact info from outreach object - NO HARDCODING
      const contactInfo = record.outreach?.contactInfo || {
        phoneNumbers: [],
        emails: [],
      }

      console.log(chalk.gray(`📋 Existing contactInfo from record:`), JSON.stringify(contactInfo))

      // Only add from main record fields if contactInfo is empty
      if (contactInfo.phoneNumbers.length === 0 && record.phonenumber) {
        const formattedPhone = this.formatPhoneNumber(record.phonenumber)
        contactInfo.phoneNumbers.push(formattedPhone)
        console.log(chalk.blue(`📱 Added phone number from record.phonenumber: ${formattedPhone}`))
      }

      if (contactInfo.emails.length === 0 && record.email) {
        if (Array.isArray(record.email)) {
          for (const email of record.email) {
            if (email && typeof email === "string" && email.includes("@")) {
              contactInfo.emails.push(email)
              console.log(chalk.blue(`📧 Added email from record.email array: ${email}`))
            }
          }
        } else if (typeof record.email === "string" && record.email.includes("@")) {
          contactInfo.emails.push(record.email)
          console.log(chalk.blue(`📧 Added email from record.email string: ${record.email}`))
        }
      }

      console.log(chalk.gray(`📋 Final contactInfo to use:`), JSON.stringify(contactInfo))

      // Update record with contactInfo
      const collection = getCollection(databaseName, collectionName)
      await collection.updateOne(
        { _id: record._id },
        {
          $set: {
            "outreach.contactInfo": contactInfo,
            "outreach.lastUpdatedAt": new Date(),
          },
        },
      )

      // Use phone number from contactInfo
      const phoneNumbers = contactInfo.phoneNumbers
      if (phoneNumbers.length === 0) {
        return {
          success: false,
          reason: "No phone numbers available in contactInfo",
          recordId: record._id,
        }
      }

      const phoneNumber = this.formatPhoneNumber(phoneNumbers[0])
      console.log(chalk.blue(`📱 Using phone number from contactInfo: ${phoneNumber}`))

      // Initiate call with attempt number for agent selection
      const callInitResult = await this.initiateCall(phoneNumber, record.businessname, attemptNumber)

      // Wait for call completion with the correct agent config
      const callResults = await this.waitForCallCompletion(callInitResult.conversationId, callInitResult.agentConfig)

      // Generate personalized email (independent, not follow-up)
      const emailData = await this.generatePersonalizedEmail(record.businessname)

      // Get emails from contactInfo - NEVER hardcode
      const contactEmails = contactInfo.emails || []
      console.log(chalk.blue(`📧 Using emails from contactInfo:`), JSON.stringify(contactEmails))

      // Only send emails for immediate outreach (not scheduled campaigns)
      let emailResults
      let emailAddresses
      if (contactEmails.length > 0) {
        console.log(chalk.blue(`📧 Sending emails to ${contactEmails.length} addresses for ${record.businessname}`))

        const allEmailResults = []

        // Send emails one by one to ensure separate Zapier requests
        for (let i = 0; i < contactEmails.length; i++) {
          const emailAddress = contactEmails[i]
          try {
            console.log(chalk.blue(`📧 Sending individual email ${i + 1}/${contactEmails.length} to ${emailAddress}`))
            const result = await this.sendEmail(emailAddress, emailData, record.businessname)
            allEmailResults.push({
              success: result.success,
              error: result.error || null,
              subject: result.subject,
              emailAddress: emailAddress,
              timestamp: new Date().toISOString(),
            })

            // Small delay between emails to ensure separate requests
            if (i < contactEmails.length - 1) {
              console.log(chalk.yellow(`⏳ Waiting 90 seconds before sending next email...`))
              await new Promise((resolve) => setTimeout(resolve, 90000))
            }
          } catch (error) {
            console.error(chalk.red(`❌ Error sending email to ${emailAddress}:`), error.message)
            allEmailResults.push({
              success: false,
              error: error.message,
              subject: emailData.subject,
              emailAddress: emailAddress,
              timestamp: new Date().toISOString(),
            })
          }
        }

        const successfulEmails = allEmailResults.filter((result) => result.success)

        emailResults = {
          success: successfulEmails.length > 0,
          totalSent: successfulEmails.length,
          totalAttempted: allEmailResults.length,
          results: allEmailResults,
          subject: emailData.subject,
        }

        emailAddresses = contactEmails
        console.log(chalk.green(`✅ Sent ${successfulEmails.length}/${allEmailResults.length} emails successfully`))
      } else {
        console.log(chalk.yellow(`⚠️ No email addresses in contactInfo for ${record.businessname}, skipping email`))
      }

      // Update record in database
      await this.updateRecord(
        databaseName,
        collectionName,
        record._id,
        callResults,
        emailResults,
        phoneNumber,
        emailAddresses,
        contactInfo,
      )

      console.log(chalk.green(`✅ Successfully processed ${record.businessname}`))

      return {
        success: true,
        recordId: record._id,
        businessName: record.businessname,
        callResults: callResults,
        emailResults: emailResults,
        phoneNumber: phoneNumber,
        emailAddresses: emailAddresses,
        contactInfo: contactInfo,
      }
    } catch (error) {
      console.error(chalk.red(`❌ Error processing record ${record._id}:`), error.message)

      // Update record with failed status
      try {
        const failedCallResults = {
          callSuccessful: false,
          status: "failed",
          error: error.message,
          isPartneredWithInfinityClub: null,
          dataCollectionResults: {},
        }

        // Get existing contactInfo
        const collection = getCollection(databaseName, collectionName)
        const existingRecord = await collection.findOne({ _id: record._id })
        const contactInfo = existingRecord?.outreach?.contactInfo || {
          phoneNumbers: record.phonenumber ? [record.phonenumber] : [],
          emails: [],
        }

        await this.updateRecord(
          databaseName,
          collectionName,
          record._id,
          failedCallResults,
          null,
          record.phonenumber ? this.formatPhoneNumber(record.phonenumber) : null,
          null,
          contactInfo,
        )
      } catch (updateError) {
        console.error(chalk.red(`❌ Error updating failed record ${record._id}:`), updateError.message)
      }

      return {
        success: false,
        recordId: record._id,
        businessName: record.businessname,
        error: error.message,
      }
    }
  }

  // Process multiple records sequentially
  async processMultipleRecords(databaseName, collectionName, recordIds) {
    const results = []

    console.log(chalk.cyan(`🚀 Starting outreach campaign for ${recordIds.length} records`))

    for (let i = 0; i < recordIds.length; i++) {
      const recordId = recordIds[i]

      try {
        console.log(chalk.cyan(`\n📋 Processing record ${i + 1}/${recordIds.length}: ${recordId}`))

        // Fetch record from database
        const collection = getCollection(databaseName, collectionName)
        const objectId = await toObjectId(recordId)
        const record = await collection.findOne({ _id: objectId })

        if (!record) {
          console.log(chalk.red(`❌ Record ${recordId} not found`))
          results.push({
            success: false,
            recordId: recordId,
            error: "Record not found",
          })
          continue
        }

        // Process the record
        const result = await this.processRecord(databaseName, collectionName, record)
        results.push(result)

        // Add delay between calls to avoid rate limiting
        if (i < recordIds.length - 1) {
          console.log(chalk.yellow(`⏳ Waiting 30 seconds before next call...`))
          await new Promise((resolve) => setTimeout(resolve, 30000))
        }
      } catch (error) {
        console.error(chalk.red(`❌ Error processing record ${recordId}:`), error.message)
        results.push({
          success: false,
          recordId: recordId,
          error: error.message,
        })
      }
    }

    console.log(chalk.green(`\n🎉 Outreach campaign completed! Processed ${results.length} records`))
    console.log(chalk.green(`✅ Successful: ${results.filter((r) => r.success).length}`))
    console.log(chalk.red(`❌ Failed: ${results.filter((r) => !r.success).length}`))

    return results
  }
}

export default OutreachService
