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

    client = new MongoClient(process.env.MONGODB_CONNECTION_STRING)
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
  const database = getDatabase(databaseName)

  // Create collection if it doesn't exist
  database.createCollection(collectionName).catch((err) => {
    // Ignore "collection already exists" error
    if (!err.message.includes("already exists")) {
      console.error(`Error creating collection ${collectionName}:`, err.message)
    }
  })

  return database.collection(collectionName)
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
