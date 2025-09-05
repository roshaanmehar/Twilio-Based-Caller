# 🤖 AI CALLER

**Enterprise AI-Powered Calling & Email Campaign Management System**

A robust Node.js backend service for managing automated calling campaigns using ElevenLabs AI agents and email outreach with intelligent scheduling and tracking.

---

## ✨ Key Features

### 📞 **AI-Powered Calling**
- **Dual ElevenLabs Agent System** - Automatic load balancing between two AI agents
- **Smart Scheduling** - Configurable call attempts with UK timezone support
- **Call Tracking** - Real-time campaign monitoring and status updates
- **Duplicate Prevention** - Intelligent record management to prevent duplicate calls

### 📧 **Email Campaigns**
- **Zapier Integration** - Seamless email sending via webhook
- **Microsoft Graph API** - Direct email sending capabilities
- **Campaign Tracking** - Monitor email delivery and engagement
- **Bulk Operations** - Handle large-scale email campaigns

### 🎯 **Campaign Management**
- **Multi-Channel Outreach** - Combine calls and emails in unified campaigns
- **Flexible Scheduling** - Schedule campaigns for optimal contact times
- **Status Monitoring** - Real-time campaign progress tracking
- **User Management** - Multi-user support with isolated campaigns

### 🇬🇧 **UK-Native Operations**
- **Timezone Aware** - All operations in UK timezone (Europe/London)
- **Working Hours** - Respects UK business hours for scheduling
- **Local Formatting** - UK-formatted phone numbers and timestamps

---

## 🚀 Quick Start

### Prerequisites
\`\`\`bash
Node.js 18+
MongoDB Database
ElevenLabs API Accounts (2 recommended)
\`\`\`

### Installation
\`\`\`bash
cd "Caller V2"
npm install
npm start
\`\`\`

### Docker Deployment
\`\`\`bash
docker build -t caller-v2 .
docker run -p 8080:8080 caller-v2
\`\`\`

---

## 🔧 Configuration

### Required Environment Variables

\`\`\`env
# ElevenLabs Agent 1 (Handles attempts 1 & 3)
ELEVEN_LABS_API_KEY_1=your_api_key_1
ELEVEN_LABS_AGENT_ID_1=your_agent_id_1
ELEVEN_LABS_PHONE_NUMBER_ID_1=your_phone_id_1

# ElevenLabs Agent 2 (Handles attempts 2 & 4)
ELEVEN_LABS_API_KEY_2=your_api_key_2
ELEVEN_LABS_AGENT_ID_2=your_agent_id_2
ELEVEN_LABS_PHONE_NUMBER_ID_2=your_phone_id_2

# Database & Integrations
MONGODB_CONNECTION_STRING=mongodb://localhost:27017/caller
ZAPIER_EMAIL_WEBHOOK_URL=https://hooks.zapier.com/your-webhook
GEMINI_API_KEY=your_gemini_api_key

# Microsoft Graph (Optional)
MS_GRAPH_CLIENT_ID=your_client_id
MS_GRAPH_TENANT_ID=your_tenant_id
MS_GRAPH_CLIENT_SECRET=your_client_secret
MS_GRAPH_SENDER_EMAIL=sender@yourdomain.com

# System Configuration
PORT=8080
TZ=Europe/London
MAX_CALL_ATTEMPTS=4
SCHEDULER_POLL_INTERVAL=60000
\`\`\`

---

## 📡 API Endpoints

### Campaign Management

#### Create Call Campaign
\`\`\`http
POST /api/v1/campaigns/calls
\`\`\`
\`\`\`json
{
  "records": [
    {
      "id": "record_123",
      "name": "John Doe",
      "phone": "+44123456789"
    }
  ],
  "attempts": [
    {
      "scheduledAt": "2024-01-15T10:00:00Z",
      "agentId": "agent_1"
    }
  ],
  "databaseName": "your_database",
  "collectionName": "your_collection",
  "userId": "user_123"
}
\`\`\`

#### Create Email Campaign
\`\`\`http
POST /api/v1/campaigns/emails
\`\`\`

#### Get Campaign Status
\`\`\`http
GET /api/v1/campaigns/status?userId=user_123&status=pending
\`\`\`

### Record Management

#### Check Record Status
\`\`\`http
GET /api/v1/records/status?recordId=record_123&databaseName=db&collectionName=collection
\`\`\`

#### Check Campaign Eligibility
\`\`\`http
GET /api/v1/records/eligibility?recordId=record_123&databaseName=db&collectionName=collection
\`\`\`

### System & Monitoring

#### Health Check
\`\`\`http
GET /health
\`\`\`

#### System Configuration
\`\`\`http
GET /api/v1/system/config
\`\`\`

#### Kanban Data
\`\`\`http
GET /api/v1/kanban/calls?userId=user_123
GET /api/v1/kanban/emails?userId=user_123
\`\`\`

---

## 🏗️ Architecture

### Service Layer
\`\`\`
services/
├── campaignCreationService.js    # Campaign creation & validation
├── outreachService.js           # ElevenLabs & email execution
├── scheduledOutreachService.js  # Background scheduling engine
├── recordCopyService.js         # Database record management
└── validationService.js         # Input validation & sanitization
\`\`\`

### Database Collections
\`\`\`
MongoDB: outreach_tracking/
├── call_campaigns      # Call campaign tracking & status
└── email_campaigns     # Email campaign tracking & status
\`\`\`

### Dual Agent System
- **Agent 1**: Handles call attempts 1 & 3
- **Agent 2**: Handles call attempts 2 & 4
- **Load Balancing**: Automatic distribution across ElevenLabs accounts
- **Failover**: Graceful handling of agent unavailability

---

## 📊 Response Formats

### Success Response
\`\`\`json
{
  "success": true,
  "message": "Call campaigns created for 5/5 records",
  "data": {
    "totalRecords": 5,
    "successfulCampaigns": 5,
    "failedCampaigns": 0,
    "campaignTrackingIds": ["camp_1", "camp_2", "camp_3"]
  }
}
\`\`\`

### Error Response
\`\`\`json
{
  "success": false,
  "message": "Validation failed",
  "error": "Invalid phone number format",
  "details": {
    "field": "phone",
    "value": "invalid_number"
  }
}
\`\`\`

---

## 🔄 Campaign Lifecycle

1. **Creation** → Campaign created with scheduled attempts
2. **Queued** → Added to scheduling engine
3. **In Progress** → Currently being executed
4. **Completed** → All attempts finished
5. **Failed** → Execution failed (with retry logic)

---

## 🛠️ Development

### Local Development
\`\`\`bash
npm run dev          # Start with nodemon
npm test            # Run test suite
npm run lint        # Code linting
\`\`\`

### Environment Setup
\`\`\`bash
cp .env.example .env
# Configure your environment variables
npm install
npm start
\`\`\`

---

## 📈 Monitoring & Logging

- **Health Endpoint**: `/health` for system status
- **Campaign Tracking**: Real-time status updates
- **Error Logging**: Comprehensive error tracking
- **Performance Metrics**: Built-in monitoring capabilities

---

## 🔒 Security Features

- **Input Validation**: Comprehensive request validation
- **Rate Limiting**: API endpoint protection
- **Environment Variables**: Secure credential management
- **Error Handling**: Secure error responses without data leakage

---

## 📝 License

MIT License - see LICENSE file for details.

---

## 🆘 Support

- **Health Check**: `GET /health`
- **System Status**: `GET /api/v1/system/config`
- **Documentation**: API endpoints documented above
- **Issues**: Create GitHub issues for bug reports
