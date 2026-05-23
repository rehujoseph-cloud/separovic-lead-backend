const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const twilio = require('twilio');

const app = express();
const PORT = process.env.PORT || 3000;

// Twilio credentials from environment variables ONLY
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE = process.env.TWILIO_PHONE;
const ALERT_PHONE = process.env.ALERT_PHONE;

// Validate required environment variables
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE || !ALERT_PHONE) {
  console.error('❌ ERROR: Missing required environment variables!');
  console.error('Please set: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE, ALERT_PHONE');
  process.exit(1);
}

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite Database
const db = new sqlite3.Database('./leads.db', (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('✅ Connected to SQLite database');
  }
});

// Create leads table
db.run(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    service TEXT NOT NULL,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`, (err) => {
  if (err) {
    console.error('Table creation error:', err);
  } else {
    console.log('✅ Leads table ready');
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'online',
    message: 'Separovic Lead Capture API',
    endpoints: {
      submit: 'POST /api/leads',
      fetch: 'GET /api/leads',
      delete: 'DELETE /api/leads/:id'
    }
  });
});

// POST /api/leads - Submit new lead
app.post('/api/leads', async (req, res) => {
  const { name, email, phone, service, message } = req.body;

  // Validation
  if (!name || !email || !phone || !service) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required fields: name, email, phone, service' 
    });
  }

  // Insert into database
  const sql = `INSERT INTO leads (name, email, phone, service, message) VALUES (?, ?, ?, ?, ?)`;
  
  db.run(sql, [name, email, phone, service, message || ''], async function(err) {
    if (err) {
      console.error('Database insert error:', err);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to save lead' 
      });
    }

    console.log(`✅ New lead saved: ${name} - ${service}`);

    // Send SMS alert via Twilio
    try {
      const smsBody = `🔔 NEW LEAD!\n\nName: ${name}\nService: ${service}\nPhone: ${phone}\nEmail: ${email}`;
      
      await twilioClient.messages.create({
        body: smsBody,
        from: TWILIO_PHONE,
        to: ALERT_PHONE
      });
      
      console.log(`📱 SMS alert sent to ${ALERT_PHONE}`);
    } catch (smsError) {
      console.error('Twilio SMS error:', smsError.message);
      // Don't fail the request if SMS fails
    }

    res.json({ 
      success: true, 
      message: 'Lead submitted successfully',
      leadId: this.lastID 
    });
  });
});

// GET /api/leads - Fetch all leads
app.get('/api/leads', (req, res) => {
  const sql = `SELECT * FROM leads ORDER BY created_at DESC`;
  
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Database fetch error:', err);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch leads' 
      });
    }

    res.json({ 
      success: true, 
      leads: rows,
      count: rows.length 
    });
  });
});

// DELETE /api/leads/:id - Delete a lead (for dashboard reset/cleanup)
app.delete('/api/leads/:id', (req, res) => {
  const { id } = req.params;
  
  const sql = `DELETE FROM leads WHERE id = ?`;
  
  db.run(sql, [id], function(err) {
    if (err) {
      console.error('Database delete error:', err);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to delete lead' 
      });
    }

    if (this.changes === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Lead not found' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Lead deleted successfully' 
    });
  });
});

// DELETE /api/leads - Delete ALL leads (RESET button)
app.delete('/api/leads', (req, res) => {
  const sql = `DELETE FROM leads`;
  
  db.run(sql, [], function(err) {
    if (err) {
      console.error('Database clear error:', err);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to clear leads' 
      });
    }

    console.log('🗑️ All leads deleted');
    
    res.json({ 
      success: true, 
      message: 'All leads deleted successfully',
      deletedCount: this.changes 
    });
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 URL: https://nodejs-production-3d033.up.railway.app`);
});
