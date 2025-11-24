import { MongoClient } from 'mongodb';

// Environment variables with fallbacks
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://username:password@cluster.mongodb.net/email-verification?retryWrites=true&w=majority';
const DB_NAME = process.env.MONGODB_DB || 'email-verification';
const DOMAINS_COLLECTION = 'allowed_domains';

// Connection caching
let cachedClient = null;
let cachedDb = null;

// Connect to MongoDB database
async function connectToDatabase() {
  try {
    if (cachedClient && cachedDb) {
      return { client: cachedClient, db: cachedDb };
    }
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    const db = client.db(DB_NAME);
    
    cachedClient = client;
    cachedDb = db;
    
    return { client, db };
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
}

// Check if domain is allowed in database
async function isDomainAllowed(domain) {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection(DOMAINS_COLLECTION);
    
    const domainRecord = await collection.findOne({ 
      domain: domain.toLowerCase() 
    });
    
    return !!domainRecord;
  } catch (error) {
    console.error('Error checking domain:', error);
    return false;
  }
}

export default async function handler(req, res) {
  // Set CORS headers for all browsers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*'); // Replace with specific origins for security if needed
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
  
  // Handle OPTIONS preflight request (needed for CORS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Handle POST request to validate the email
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  
  try {
    const { email } = req.body;
    
    // Check if email is provided
    if (!email) {
      return res.status(400).json({ message: 'Please enter an email address' });
    }
    
    // Get domain from the email
    const domain = email.split('@')[1];
    
    // Validate email format
    if (!domain) {
      return res.status(400).json({ message: 'Invalid email format' });
    }
    
    // Check if domain is allowed
    const isAllowed = await isDomainAllowed(domain);
    
    if (!isAllowed) {
      return res.status(400).json({ message: 'Access Denied' });
    }
    
    // Successfully validated the email - using original response format
    return res.status(200).json({ message: 'Email validated successfully' });
    
  } catch (error) {
    console.error('API error:', error);
    return res.status(500).json({ message: 'Unable to verify email. Please try again later.' });
  }
}
