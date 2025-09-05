# Multi-Platform Outreach & Calling System

A comprehensive suite of applications for managing AI-powered calling campaigns, Twilio-based calling, and modern web interfaces.

## 🏗️ Project Structure

This repository contains three main applications:

\`\`\`
├── /                          # Next.js Frontend Application
├── VEDA AI CALLER/           # AI-Powered Campaign Management Backend
└── Twilio Caller/            # Twilio-Based Calling System
\`\`\`

---

## 🚀 Next.js Frontend Application

### Overview
Modern React application built with Next.js 14, featuring a comprehensive UI component library and advanced TypeScript integration.

### Key Features
- **Next.js 14** with App Router architecture
- **React 19** with TypeScript for type safety
- **Tailwind CSS** for utility-first styling
- **shadcn/ui** component system with 40+ reusable components
- **Radix UI** primitives for accessible components
- **React Hook Form** with Zod validation
- **Recharts** for data visualization
- **Dark/Light theme** support with theme provider

### Tech Stack
\`\`\`json
{
  "framework": "Next.js 14",
  "runtime": "React 19",
  "language": "TypeScript",
  "styling": "Tailwind CSS",
  "components": "shadcn/ui + Radix UI",
  "forms": "React Hook Form + Zod",
  "charts": "Recharts"
}
\`\`\`

### Available Components
- **UI Components**: Button, Card, Dialog, Form, Input, Select, Table, etc.
- **Layout**: Sidebar, Navigation, Theme Provider
- **Data**: Charts, Tables, Pagination
- **Forms**: Input validation, Multi-step forms
- **Feedback**: Toast notifications, Loading states

### Getting Started
\`\`\`bash
npm install
npm run dev
\`\`\`

---

## 🤖 VEDA AI CALLER - Campaign Management Backend

### Overview
Enterprise-grade Node.js backend for managing AI-powered calling and email campaigns with dual ElevenLabs agent support and comprehensive tracking.

### Key Features

#### 🎯 **Dual Agent System**
- **Agent 1**: Handles attempts 1 & 3
- **Agent 2**: Handles attempts 2 & 4
- Automatic load balancing between ElevenLabs accounts

#### 📞 **Campaign Management**
- **Call Campaigns**: Custom scheduling with configurable attempts
- **Email Campaigns**: Zapier webhook integration
- **Status Tracking**: Real-time campaign monitoring
- **Duplicate Prevention**: Records can't be added twice

#### 🇬🇧 **UK-Native Operations**
- All operations in UK timezone (Europe/London)
- Working hours configuration
- UK-formatted timestamps

#### 📊 **Kanban Integration**
- RESTful API endpoints for frontend Kanban boards
- Campaign status filtering
- User-specific campaign views

### API Endpoints

#### Campaign Management
\`\`\`http
POST /api/v1/campaigns/calls      # Create call campaigns
POST /api/v1/campaigns/emails     # Create email campaigns
GET  /api/v1/campaigns/status     # Get campaign status
\`\`\`

#### Record Management
\`\`\`http
GET  /api/v1/records/status       # Check original record status
GET  /api/v1/records/eligibility  # Check campaign eligibility
\`\`\`

#### Kanban & System
\`\`\`http
GET  /api/v1/kanban/calls         # Kanban data for calls
GET  /api/v1/kanban/emails        # Kanban data for emails
GET  /api/v1/system/config        # System configuration
GET  /health                      # Health check
\`\`\`

### Environment Variables
\`\`\`env
# ElevenLabs Account 1 (Agent 1)
ELEVEN_LABS_API_KEY_1=your_api_key_1
ELEVEN_LABS_AGENT_ID_1=your_agent_id_1
ELEVEN_LABS_PHONE_NUMBER_ID_1=your_phone_id_1

# ElevenLabs Account 2 (Agent 2)
ELEVEN_LABS_API_KEY_2=your_api_key_2
ELEVEN_LABS_AGENT_ID_2=your_agent_id_2
ELEVEN_LABS_PHONE_NUMBER_ID_2=your_phone_id_2

# Integrations
ZAPIER_EMAIL_WEBHOOK_URL=your_zapier_webhook
GEMINI_API_KEY=your_gemini_key
MONGODB_CONNECTION_STRING=your_mongodb_connection
\`\`\`

### Database Structure
\`\`\`javascript
// MongoDB Collections
outreach_tracking/
├── call_campaigns     # Call campaign tracking
└── email_campaigns    # Email campaign tracking
\`\`\`

### Services Architecture
\`\`\`
services/
├── campaignCreationService.js    # Campaign creation & management
├── outreachService.js           # Outreach execution
├── scheduledOutreachService.js  # Scheduled campaign handling
├── recordCopyService.js         # Record copying operations
└── validationService.js         # Data validation
\`\`\`

### Getting Started
\`\`\`bash
cd "VEDA AI CALLER"
npm install
npm start
\`\`\`

### Docker Support
\`\`\`bash
docker build -t veda-ai-caller .
docker run -p 8080:8080 veda-ai-caller
\`\`\`

---

## 📱 Twilio Caller - Twilio Integration System

### Overview
Specialized calling system built with Twilio integration for traditional telephony operations.

### Key Features
- **Twilio Integration**: Native Twilio API support
- **Call Management**: Outbound calling capabilities
- **Next.js Interface**: Modern web interface for call operations
- **Real-time Updates**: Live call status monitoring

### Tech Stack
- **Backend**: Node.js with Twilio SDK
- **Frontend**: Next.js application
- **Database**: MongoDB integration
- **API**: RESTful endpoints for call management

### Getting Started
\`\`\`bash
cd "Twilio Caller"
npm install
npm run dev
\`\`\`

---

## 🔧 Configuration & Setup

### Prerequisites
- **Node.js** 18+ 
- **MongoDB** database
- **ElevenLabs** API accounts (2 accounts for VEDA AI)
- **Twilio** account (for Twilio Caller)
- **Zapier** webhook (for email campaigns)
- **Google Gemini** API key

### Installation Steps

1. **Clone the repository**
\`\`\`bash
git clone <repository-url>
cd <project-directory>
\`\`\`

2. **Setup Frontend Application**
\`\`\`bash
npm install
npm run dev
\`\`\`

3. **Setup VEDA AI CALLER**
\`\`\`bash
cd "VEDA AI CALLER"
npm install
# Configure environment variables
npm start
\`\`\`

4. **Setup Twilio Caller**
\`\`\`bash
cd "Twilio Caller"
npm install
# Configure Twilio credentials
npm run dev
\`\`\`

### Environment Configuration
Each application requires its own environment configuration. Refer to the respective `.env.example` files in each directory.

---

## 📈 Features Comparison

| Feature | Frontend App | VEDA AI CALLER | Twilio Caller |
|---------|-------------|----------------|---------------|
| **UI Framework** | Next.js 14 | Express.js | Next.js |
| **Calling Provider** | - | ElevenLabs | Twilio |
| **Campaign Management** | ✅ | ✅ | ✅ |
| **Dual Agent Support** | - | ✅ | - |
| **Email Integration** | - | ✅ | - |
| **Kanban API** | ✅ | ✅ | - |
| **UK Timezone Native** | - | ✅ | - |
| **Docker Support** | - | ✅ | - |

---

## 🚀 Deployment

### Frontend Application
\`\`\`bash
npm run build
npm start
\`\`\`

### VEDA AI CALLER
\`\`\`bash
# Docker deployment
docker build -t veda-ai-caller .
docker run -p 8080:8080 veda-ai-caller

# Or direct deployment
npm start
\`\`\`

### Twilio Caller
\`\`\`bash
npm run build
npm start
\`\`\`

---

## 📝 API Documentation

### VEDA AI CALLER API

#### Create Call Campaign
\`\`\`http
POST /api/v1/campaigns/calls
Content-Type: application/json

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

#### Response Format
\`\`\`json
{
  "success": true,
  "message": "Call campaigns created for 1/1 records",
  "data": {
    "totalRecords": 1,
    "successfulCampaigns": 1,
    "failedCampaigns": 0,
    "campaignTrackingIds": ["campaign_123"]
  }
}
\`\`\`

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Check the API documentation above
- Review the health check endpoints for system status

---

## 🔄 Version History

- **v2.0**: Enhanced campaign management with dual agent support
- **v1.5**: Added Kanban API endpoints and UK timezone support
- **v1.0**: Initial release with basic calling functionality
