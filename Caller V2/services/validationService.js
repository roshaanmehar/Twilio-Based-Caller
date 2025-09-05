import OUTREACH_CONFIG from "../config/constants.js"
import chalk from "chalk"

export class ValidationService {
  constructor() {
    this.maxFutureDays = OUTREACH_CONFIG.CALLS.MAX_FUTURE_DAYS
  }

  // Parse date string as UK time regardless of format
  parseAsUKTime(dateString) {
    // Remove Z suffix if present - we want to treat everything as UK time
    let cleanDateString = dateString.replace(/Z$/, "")

    // If no time specified, add midnight
    if (!cleanDateString.includes("T")) {
      cleanDateString += "T00:00:00"
    }

    console.log(chalk.blue(`🇬🇧 Parsing as UK time: "${dateString}" → "${cleanDateString}"`))

    // Create date object - since server timezone is Europe/London, this will be UK time
    const ukDate = new Date(cleanDateString)

    console.log(chalk.blue(`🕐 Parsed UK time: ${ukDate.toLocaleString("en-GB", { timeZone: "Europe/London" })}`))

    return ukDate
  }

  // Validate date is not more than 30 days in future and not in past
  // Now treats ALL input as UK time
  validateScheduledDate(dateString) {
    try {
      const scheduledDate = this.parseAsUKTime(dateString)
      const now = new Date() // This is UK time since we set TZ=Europe/London

      const maxFutureDate = new Date()
      maxFutureDate.setDate(now.getDate() + this.maxFutureDays)

      // Check if date is valid
      if (isNaN(scheduledDate.getTime())) {
        return {
          valid: false,
          error: "Invalid date format. Use format: YYYY-MM-DDTHH:mm:ss (will be treated as UK time)",
        }
      }

      // Check if date is in the past (with 1 minute buffer for processing time)
      const oneMinuteAgo = new Date(now.getTime() - 60 * 1000)
      if (scheduledDate < oneMinuteAgo) {
        const ukTimeString = now.toLocaleString("en-GB", {
          timeZone: "Europe/London",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
        const scheduledUKString = scheduledDate.toLocaleString("en-GB", {
          timeZone: "Europe/London",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
        return {
          valid: false,
          error: `Scheduled date cannot be in the past. Current UK time: ${ukTimeString}, Scheduled UK time: ${scheduledUKString}`,
        }
      }

      // Check if date is more than max days in future
      if (scheduledDate > maxFutureDate) {
        return {
          valid: false,
          error: `Scheduled date cannot be more than ${this.maxFutureDays} days in the future`,
        }
      }

      return {
        valid: true,
        parsedDate: scheduledDate, // Return the parsed UK time as Date object, not ISO string
      }
    } catch (error) {
      return {
        valid: false,
        error: `Date validation error: ${error.message}`,
      }
    }
  }

  // Map friendly agent names to actual agent IDs
  mapAgentId(agentId) {
    const agentMapping = {
      agent_1: process.env.ELEVEN_LABS_AGENT_ID_1,
      agent_2: process.env.ELEVEN_LABS_AGENT_ID_2,
      // Also allow direct agent IDs
      [process.env.ELEVEN_LABS_AGENT_ID_1]: process.env.ELEVEN_LABS_AGENT_ID_1,
      [process.env.ELEVEN_LABS_AGENT_ID_2]: process.env.ELEVEN_LABS_AGENT_ID_2,
    }

    return agentMapping[agentId] || agentId
  }

  // Validate call attempts configuration
  validateCallAttempts(attempts) {
    const maxAttempts = OUTREACH_CONFIG.CALLS.MAX_ATTEMPTS
    const errors = []

    if (!Array.isArray(attempts)) {
      return {
        valid: false,
        errors: ["Attempts must be an array"],
      }
    }

    if (attempts.length === 0) {
      return {
        valid: false,
        errors: ["At least one attempt is required"],
      }
    }

    if (attempts.length > maxAttempts) {
      return {
        valid: false,
        errors: [`Maximum ${maxAttempts} attempts allowed, got ${attempts.length}`],
      }
    }

    // Validate each attempt
    attempts.forEach((attempt, index) => {
      // Check attempt number
      if (attempt.attemptNumber !== index + 1) {
        errors.push(`Attempt ${index + 1}: attemptNumber should be ${index + 1}, got ${attempt.attemptNumber}`)
      }

      // Check agent ID and map it
      if (!attempt.agentId || typeof attempt.agentId !== "string") {
        errors.push(`Attempt ${index + 1}: agentId is required and must be a string`)
      } else {
        const mappedAgentId = this.mapAgentId(attempt.agentId)
        if (!mappedAgentId) {
          errors.push(
            `Attempt ${index + 1}: Invalid agentId "${attempt.agentId}". Use "agent_1", "agent_2", or actual agent IDs`,
          )
        } else {
          // Update the attempt with the mapped agent ID
          attempt.agentId = mappedAgentId
          console.log(
            chalk.blue(
              `🔄 Mapped agent "${attempt.agentId}" to "${mappedAgentId}" for attempt ${attempt.attemptNumber}`,
            ),
          )
        }
      }

      // Check scheduled date and update with parsed UK time
      const dateValidation = this.validateScheduledDate(attempt.scheduledAt)
      if (!dateValidation.valid) {
        errors.push(`Attempt ${index + 1}: ${dateValidation.error}`)
      } else {
        // Update the attempt with the correctly parsed UK time
        attempt.scheduledAt = dateValidation.parsedDate // Keep as Date object
        console.log(
          chalk.blue(
            `🕐 Attempt ${attempt.attemptNumber} scheduled for UK time: ${dateValidation.parsedDate.toLocaleString("en-GB", { timeZone: "Europe/London" })}`,
          ),
        )
      }
    })

    // Check for duplicate attempt numbers
    const attemptNumbers = attempts.map((a) => a.attemptNumber)
    const duplicates = attemptNumbers.filter((num, index) => attemptNumbers.indexOf(num) !== index)
    if (duplicates.length > 0) {
      errors.push(`Duplicate attempt numbers found: ${duplicates.join(", ")}`)
    }

    return {
      valid: errors.length === 0,
      errors: errors,
    }
  }

  // Validate email configuration
  validateEmailConfig(emailConfig) {
    const errors = []

    if (!emailConfig) {
      return { valid: true } // Email config is optional
    }

    if (emailConfig.enabled && (!emailConfig.emailAddresses || !Array.isArray(emailConfig.emailAddresses))) {
      errors.push("emailAddresses array is required when email is enabled")
    }

    if (emailConfig.enabled && emailConfig.emailAddresses) {
      emailConfig.emailAddresses.forEach((email, index) => {
        if (!this.isValidEmail(email)) {
          errors.push(`Invalid email format at index ${index}: ${email}`)
        }
      })
    }

    // If standalone email campaign, validate scheduled date
    if (emailConfig.scheduledAt) {
      const dateValidation = this.validateScheduledDate(emailConfig.scheduledAt)
      if (!dateValidation.valid) {
        errors.push(`Email scheduling: ${dateValidation.error}`)
      } else {
        // Update with parsed UK time
        emailConfig.scheduledAt = dateValidation.parsedDate
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors,
    }
  }

  // Validate email format
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  // Validate records array
  validateRecords(records) {
    const errors = []

    if (!Array.isArray(records)) {
      return {
        valid: false,
        errors: ["Records must be an array"],
      }
    }

    if (records.length === 0) {
      return {
        valid: false,
        errors: ["At least one record is required"],
      }
    }

    records.forEach((record, index) => {
      if (!record.recordId || typeof record.recordId !== "string") {
        errors.push(`Record ${index + 1}: recordId is required and must be a string`)
      }
    })

    return {
      valid: errors.length === 0,
      errors: errors,
    }
  }

  // Validate complete call campaign request
  validateCallCampaignRequest(requestData) {
    console.log(chalk.blue("🔍 Validating call campaign request..."))

    const errors = []

    // Validate records
    const recordsValidation = this.validateRecords(requestData.records)
    if (!recordsValidation.valid) {
      errors.push(...recordsValidation.errors)
    }

    // Validate attempts (this will also map agent IDs and parse UK times)
    const attemptsValidation = this.validateCallAttempts(requestData.attempts)
    if (!attemptsValidation.valid) {
      errors.push(...attemptsValidation.errors)
    }

    // Validate email config
    const emailValidation = this.validateEmailConfig(requestData.emailConfig)
    if (!emailValidation.valid) {
      errors.push(...emailValidation.errors)
    }

    const isValid = errors.length === 0

    if (isValid) {
      console.log(chalk.green("✅ Call campaign request validation passed"))
      console.log(chalk.blue("🔄 Agent ID mapping completed:"))
      requestData.attempts.forEach((attempt) => {
        const ukTime = new Date(attempt.scheduledAt).toLocaleString("en-GB", { timeZone: "Europe/London" })
        console.log(chalk.white(`   Attempt ${attempt.attemptNumber}: ${attempt.agentId} at ${ukTime} (UK)`))
      })
    } else {
      console.log(chalk.red("❌ Call campaign request validation failed:"))
      errors.forEach((error) => console.log(chalk.red(`   - ${error}`)))
    }

    return {
      valid: isValid,
      errors: errors,
    }
  }

  // Validate complete email campaign request
  validateEmailCampaignRequest(requestData) {
    console.log(chalk.blue("🔍 Validating email campaign request..."))

    const errors = []

    // Validate records
    const recordsValidation = this.validateRecords(requestData.records)
    if (!recordsValidation.valid) {
      errors.push(...recordsValidation.errors)
    }

    // Validate scheduled date
    if (requestData.scheduledAt) {
      const dateValidation = this.validateScheduledDate(requestData.scheduledAt)
      if (!dateValidation.valid) {
        errors.push(dateValidation.error)
      } else {
        // Update with parsed UK time
        requestData.scheduledAt = dateValidation.parsedDate // Keep as Date object
      }
    }

    // Validate email addresses for each record
    requestData.records.forEach((record, index) => {
      if (!record.emailAddresses || !Array.isArray(record.emailAddresses)) {
        errors.push(`Record ${index + 1}: emailAddresses array is required`)
      } else {
        record.emailAddresses.forEach((email, emailIndex) => {
          if (!this.isValidEmail(email)) {
            errors.push(`Record ${index + 1}, email ${emailIndex + 1}: Invalid email format: ${email}`)
          }
        })
      }
    })

    const isValid = errors.length === 0

    if (isValid) {
      console.log(chalk.green("✅ Email campaign request validation passed"))
    } else {
      console.log(chalk.red("❌ Email campaign request validation failed:"))
      errors.forEach((error) => console.log(chalk.red(`   - ${error}`)))
    }

    return {
      valid: isValid,
      errors: errors,
    }
  }
}

export default ValidationService
