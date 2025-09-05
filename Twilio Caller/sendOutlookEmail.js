require('dotenv').config();
const msal = require('@azure/msal-node');
const axios = require('axios');

// Configuration from .env file
const MS_GRAPH_CLIENT_ID = process.env.MS_GRAPH_CLIENT_ID;
const MS_GRAPH_TENANT_ID = process.env.MS_GRAPH_TENANT_ID;
const MS_GRAPH_CLIENT_SECRET = process.env.MS_GRAPH_CLIENT_SECRET;
const MS_GRAPH_SENDER_EMAIL = process.env.MS_GRAPH_SENDER_EMAIL;

// MSAL configuration
const msalConfig = {
    auth: {
        clientId: MS_GRAPH_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${MS_GRAPH_TENANT_ID}`,
        clientSecret: MS_GRAPH_CLIENT_SECRET,
    }
};

const cca = new msal.ConfidentialClientApplication(msalConfig);

/**
 * Acquires an access token from Azure AD.
 * @returns {Promise<string|null>} Access token or null if failed.
 */
async function getAccessToken() {
    const tokenRequest = {
        scopes: ['https://graph.microsoft.com/.default'], // .default scope for client credentials
    };
    try {
        const authResponse = await cca.acquireTokenByClientCredential(tokenRequest);
        return authResponse.accessToken;
    } catch (error) {
        console.error("Error acquiring access token:", error.response?.data || error.message || error);
        return null;
    }
}

/**
 * Sends an email using Microsoft Graph API.
 * @param {string} recipientEmail The email address of the recipient.
 * @param {string} subject The subject of the email.
 * @param {string} htmlBody The HTML content of the email body.
 * @returns {Promise<boolean>} True if email was sent successfully, false otherwise.
 */
async function sendEmail(recipientEmail, subject, htmlBody) {
    if (!MS_GRAPH_CLIENT_ID || !MS_GRAPH_TENANT_ID || !MS_GRAPH_CLIENT_SECRET || !MS_GRAPH_SENDER_EMAIL) {
        console.error("Missing one or more required environment variables. Check your .env file.");
        return false;
    }

    const accessToken = await getAccessToken();
    if (!accessToken) {
        console.error("Failed to obtain access token. Cannot send email.");
        return false;
    }

    const sendMailUrl = `https://graph.microsoft.com/v1.0/users/${MS_GRAPH_SENDER_EMAIL}/sendMail`;

    const emailMessage = {
        message: {
            subject: subject,
            body: {
                contentType: "HTML", // Can be "Text" or "HTML"
                content: htmlBody
            },
            toRecipients: [
                {
                    emailAddress: {
                        address: recipientEmail
                    }
                }
            ],
            // from: { // Optional: Usually inferred from the user context of SENDER_EMAIL
            //     emailAddress: {
            //         address: MS_GRAPH_SENDER_EMAIL
            //     }
            // }
        },
        saveToSentItems: "true" // Or "false"
    };

    try {
        await axios.post(sendMailUrl, emailMessage, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`Email successfully sent to ${recipientEmail}`);
        return true;
    } catch (error) {
        console.error(`Error sending email to ${recipientEmail}:`);
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error("Status:", error.response.status);
            console.error("Headers:", JSON.stringify(error.response.headers, null, 2));
            console.error("Data:", JSON.stringify(error.response.data, null, 2));
        } else if (error.request) {
            // The request was made but no response was received
            console.error("Request Error:", error.request);
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('Error Message:', error.message);
        }
        return false;
    }
}

// --- Main execution ---
(async () => {
    const recipientEmailArg = process.argv[2]; // Get recipient email from command line argument

    if (!recipientEmailArg) {
        console.log("Please provide the recipient's email address as a command line argument.");
        console.log("Usage: node sendOutlookEmail.js <recipient-email@example.com>");
        process.exit(1);
    }

    // Validate email format (basic check)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmailArg)) {
        console.error(`Invalid email address format: ${recipientEmailArg}`);
        process.exit(1);
    }

    console.log(`Attempting to send a test email to: ${recipientEmailArg}`);
    console.log(`From: ${MS_GRAPH_SENDER_EMAIL}`);

    const subject = "Automated Test Email via Microsoft Graph";
    const htmlBody = `
        <h1>Hello!</h1>
        <p>This is a test email sent automatically using the Microsoft Graph API and Node.js.</p>
        <p>Current time: ${new Date().toUTCString()}</p>
        <p>If you received this, the script is working!</p>
    `;

    await sendEmail(recipientEmailArg, subject, htmlBody);
})();