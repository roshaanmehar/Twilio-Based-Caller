import { MongoClient } from "mongodb"
import dotenv from "dotenv"

dotenv.config()

let client = null
const dbCache = {}

export const connectToMongoDB = async () => {
  try {
    if (!process.env.MONGODB_CONNECTION_STRING) {
      throw new Error("MONGODB_CONNECTION_STRING not found in environment variables")
    }

    client = new MongoClient(process.env.MONGODB_CONNECTION_STRING, {
      // Add connection options for better reliability
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      connectTimeoutMS: 10000, // Give up initial connection after 10 seconds
      maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
      retryWrites: true,
      retryReads: true,
    })

    await client.connect()

    // Test connection by listing databases
    const adminDb = client.db("admin")
    const dbs = await adminDb.admin().listDatabases()
    console.log(
      `✅ Connected to MongoDB successfully. Available databases: ${dbs.databases.map((db) => db.name).join(", ")}`,
    )

    return client
  } catch (error) {
    console.error("❌ Error connecting to MongoDB:", error.message)
    throw error
  }
}

export const getDatabase = (databaseName) => {
  if (!client) {
    throw new Error("MongoDB client not connected. Call connectToMongoDB() first.")
  }

  // Cache database connections
  if (!dbCache[databaseName]) {
    dbCache[databaseName] = client.db(databaseName)
  }

  return dbCache[databaseName]
}

export const getCollection = (databaseName, collectionName) => {
  try {
    const database = getDatabase(databaseName)

    // Create collection if it doesn't exist (with better error handling)
    database.createCollection(collectionName).catch((err) => {
      // Ignore "collection already exists" error and connection errors
      if (
        !err.message.includes("already exists") &&
        !err.message.includes("ENOTFOUND") &&
        !err.message.includes("ECONNABORTED") &&
        !err.message.includes("server monitor timeout")
      ) {
        console.error(`Error creating collection ${collectionName}:`, err.message)
      }
    })

    return database.collection(collectionName)
  } catch (error) {
    console.error(`❌ Error getting collection ${databaseName}.${collectionName}:`, error.message)

    // For connection errors, return a mock collection that will fail gracefully
    if (
      error.message.includes("ENOTFOUND") ||
      error.message.includes("ECONNABORTED") ||
      error.message.includes("server monitor timeout")
    ) {
      console.log(`⚠️ MongoDB connection issue - operations on ${collectionName} will be retried later`)
    }

    throw error
  }
}

export const closeConnection = async () => {
  if (client) {
    await client.close()
    console.log("🔌 MongoDB connection closed")
  }
}

// Helper function to convert string ID to ObjectId
export const toObjectId = async (id) => {
  const { ObjectId } = await import("mongodb")
  return new ObjectId(id)
}

export default {
  connectToMongoDB,
  getDatabase,
  getCollection,
  closeConnection,
  toObjectId,
}
