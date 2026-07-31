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

// ============================================================
// RULE-BASED LEAD SCORING ENGINE
// Scores leads 0-100 based on case type + description keywords
// Consistent, instant, free — no API call needed
// ============================================================

function scoreLead(service, description, existingScore) {
  // If a valid score already came from the frontend AI, trust it
  if (existingScore && existingScore > 0 && existingScore !== 50) {
    return { score: existingScore, priority: getPriority(existingScore) };
  }

  const desc = (description || '').toLowerCase();
  const svc = (service || '').toLowerCase();

  let urgency = 0;
  let severity = 0;

  // ── URGENCY KEYWORDS ──────────────────────────────────────

  // Critical — happening right now
  if (contains(desc, ['arrested', 'in custody', 'locked up', 'jail tonight', 'detained'])) {
    urgency = 52;
  } else if (contains(desc, ['bail refused', 'bail denied', 'remanded', 'no bail'])) {
    urgency = 50;
  } else if (contains(desc, ['supreme court', 'court tomorrow', 'hearing tomorrow', 'tonight', 'tonight'])) {
    urgency = 48;
  } else if (contains(desc, ['court today', 'hearing today', 'appearing today'])) {
    urgency = 48;
  } else if (contains(desc, ['police interview', 'interview tomorrow', 'speaking to police tomorrow'])) {
    urgency = 44;
  } else if (contains(desc, ['avo served today', 'avo today', 'breach', 'breached avo'])) {
    urgency = 46;
  } else if (contains(desc, ['court this week', 'few days', 'days time', '2 days', '3 days', '4 days', 'next few days'])) {
    urgency = 36;
  } else if (contains(desc, ['next week', 'within a week', 'week away', '7 days'])) {
    urgency = 28;
  } else if (contains(desc, ['2 weeks', 'two weeks', 'fortnight'])) {
    urgency = 20;
  } else if (contains(desc, ['month', '6 weeks', '4 weeks', '3 weeks'])) {
    urgency = 12;
  } else if (contains(desc, ['court attendance notice', 'can ', 'received notice', 'attendance notice'])) {
    urgency = 16;
  } else if (contains(desc, ['charged', 'charge', 'offence'])) {
    urgency = 14;
  } else {
    urgency = 6; // General enquiry
  }

  // ── SEVERITY BY CASE TYPE ─────────────────────────────────

  if (svc.includes('bail')) {
    // Bail applications — always serious
    if (contains(desc, ['murder', 'manslaughter', 'serious assault', 'aggravated assault', 'armed robbery', 'sexual assault', 'rape'])) {
      severity = 50;
    } else if (contains(desc, ['assault', 'violence', 'weapon', 'drug supply', 'trafficking', 'supply'])) {
      severity = 44;
    } else if (contains(desc, ['domestic', 'family violence', 'dv'])) {
      severity = 40;
    } else if (contains(desc, ['fraud', 'property', 'break and enter', 'robbery'])) {
      severity = 30;
    } else {
      severity = 22;
    }

  } else if (svc.includes('criminal')) {
    if (contains(desc, ['murder', 'manslaughter', 'sexual assault', 'rape', 'child'])) {
      severity = 50;
    } else if (contains(desc, ['aggravated assault', 'armed', 'weapon', 'drug supply', 'trafficking', 'importation'])) {
      severity = 46;
    } else if (contains(desc, ['assault', 'actual bodily harm', 'abh', 'fraud', 'break and enter'])) {
      severity = 38;
    } else if (contains(desc, ['common assault', 'drug possession', 'shoplifting', 'theft'])) {
      severity = 24;
    } else if (contains(desc, ['general', 'information', 'curious', 'wondering', 'not me', 'friend'])) {
      severity = 8;
    } else {
      severity = 20;
    }

  } else if (svc.includes('traffic') || svc.includes('driving')) {
    if (contains(desc, ['dangerous driving', 'negligent driving', 'injury', 'accident', 'death', 'fatality'])) {
      severity = 48;
    } else if (contains(desc, ['high range', '0.15', '0.16', '0.17', '0.18', '0.19', '0.2'])) {
      severity = 44;
    } else if (contains(desc, ['drug driving', 'mdma', 'ice', 'meth', 'cannabis driving'])) {
      severity = 40;
    } else if (contains(desc, ['mid range', '0.08', '0.09', '0.10', '0.11', '0.12', '0.13', '0.14'])) {
      severity = 34;
    } else if (contains(desc, ['lose my licence', 'lose licence', 'job', 'work', 'driver', 'delivery'])) {
      severity = 36; // High impact even for lower range
    } else if (contains(desc, ['low range', '0.05', '0.06', '0.07', 'suspended', 'disqualified'])) {
      severity = 24;
    } else if (contains(desc, ['speeding', 'speed camera', 'fine', 'minor'])) {
      severity = 14;
    } else {
      severity = 20;
    }

  } else if (svc.includes('drug')) {
    if (contains(desc, ['supply', 'trafficking', 'importation', 'manufacture', 'large quantity', 'commercial'])) {
      severity = 50;
    } else if (contains(desc, ['intent to supply', 'deal', 'dealing'])) {
      severity = 44;
    } else if (contains(desc, ['ecstasy', 'mdma', 'cocaine', 'heroin', 'ice', 'meth', 'amphetamine'])) {
      severity = 34;
    } else if (contains(desc, ['cannabis', 'weed', 'marijuana', 'small amount', 'personal use'])) {
      severity = 16;
    } else {
      severity = 22;
    }

  } else if (svc.includes('avo') || svc.includes('apprehended')) {
    if (contains(desc, ['breach', 'breached', 'breaching', 'violated'])) {
      severity = 48;
    } else if (contains(desc, ['advo', 'domestic', 'violence', 'threat', 'threatened'])) {
      severity = 40;
    } else if (contains(desc, ['apvo', 'police application'])) {
      severity = 36;
    } else if (contains(desc, ['private avo', 'neighbour', 'workplace'])) {
      severity = 28;
    } else if (contains(desc, ['protect', 'protection', 'scared', 'afraid', 'fear'])) {
      severity = 42; // Victim seeking protection
    } else {
      severity = 22;
    }

  } else if (svc.includes('domestic') || svc.includes('family violence')) {
    if (contains(desc, ['strangl', 'choke', 'weapon', 'knife', 'gun'])) {
      severity = 50;
    } else if (contains(desc, ['assault', 'hit', 'punch', 'physical', 'injured', 'hurt'])) {
      severity = 46;
    } else if (contains(desc, ['threat', 'threaten', 'scared', 'afraid', 'danger'])) {
      severity = 42;
    } else if (contains(desc, ['repeat', 'again', 'previous', 'history'])) {
      severity = 44;
    } else if (contains(desc, ['intimidat', 'stalk', 'harass'])) {
      severity = 38;
    } else if (contains(desc, ['property', 'damage', 'broke'])) {
      severity = 26;
    } else {
      severity = 24;
    }

  } else {
    // Default for any other case type
    severity = 20;
  }

  // ── BONUS MULTIPLIERS ──────────────────────────────────────

  // Stack bonus: in custody + bail refused + court tomorrow = critical
  let bonus = 0;
  const inCustody = contains(desc, ['arrested', 'in custody', 'locked up', 'detained', 'remanded']);
  const bailRefused = contains(desc, ['bail refused', 'bail denied', 'no bail', 'remanded']);
  const courtTomorrow = contains(desc, ['tomorrow', 'tonight', 'today', 'supreme court']);
  if (inCustody && bailRefused && courtTomorrow) bonus = 8;
  else if (inCustody && courtTomorrow) bonus = 4;

  // Repeat offender bonus
  if (contains(desc, ['repeat', 'previous conviction', 'prior', 'before', 'last time'])) bonus += 4;

  // Cap at 100
  const total = Math.min(100, urgency + severity + bonus);

  return {
    score: total,
    priority: getPriority(total)
  };
}

function contains(text, keywords) {
  return keywords.some(kw => text.includes(kw));
}

function getPriority(score) {
  if (score >= 80) return 'high';
  if (score >= 55) return 'medium';
  return 'low';
}

// ============================================================

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
    priority TEXT DEFAULT 'medium',
    score INTEGER DEFAULT 50,
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
    message: 'AgentFlow Lead Capture API',
    endpoints: {
      submit: 'POST /api/leads',
      fetch: 'GET /api/leads',
      delete: 'DELETE /api/leads/:id or DELETE /api/leads'
    }
  });
});

// POST /api/leads - Submit new lead
app.post('/api/leads', async (req, res) => {
  const { name, email, phone, service, message, priority, score, firm } = req.body;

  // Validation
  if (!name || !phone || !service) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required fields: name, phone, service' 
    });
  }

  // ── RULE-BASED SCORING ──────────────────────────────────────
  // Extract description from message (may be JSON from Bartley demo)
  let description = message || '';
  try {
    const parsed = JSON.parse(message);
    if (parsed.description) description = parsed.description;
  } catch(e) {
    description = message || '';
  }

  const scored = scoreLead(service, description, score);
  const finalScore = scored.score;
  const finalPriority = scored.priority;
  // ────────────────────────────────────────────────────────────

  // Insert into database
  const sql = `INSERT INTO leads (name, email, phone, service, message, priority, score) VALUES (?, ?, ?, ?, ?, ?, ?)`;
  
  db.run(sql, [name, email || '', phone, service, message || '', finalPriority, finalScore], async function(err) {
    if (err) {
      console.error('Database insert error:', err);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to save lead' 
      });
    }

    const firmName = firm || 'AgentFlow';
    console.log(`✅ New lead saved: ${name} - ${service} [Score: ${finalScore} | ${finalPriority.toUpperCase()}] — ${firmName}`);

    // Send SMS alert via Twilio
    try {
      const priorityEmoji = finalScore >= 80 ? '🔥' : finalScore >= 55 ? '⚡' : '📋';
      const smsBody = `${priorityEmoji} NEW ENQUIRY — ${firmName}\n\nScore: ${finalScore}/100\nPriority: ${finalPriority.toUpperCase()}\nName: ${name}\nService: ${service}\nPhone: ${phone}${email ? '\nEmail: ' + email : ''}${description ? '\n\n"' + description.substring(0, 120) + (description.length > 120 ? '..."' : '"') : ''}`;
      
      await twilioClient.messages.create({
        body: smsBody,
        from: TWILIO_PHONE,
        to: ALERT_PHONE
      });
      
      console.log(`📱 SMS alert sent to ${ALERT_PHONE}`);
    } catch (smsError) {
      console.error('Twilio SMS error:', smsError.message);
    }

    res.json({ 
      success: true, 
      message: 'Lead submitted successfully',
      leadId: this.lastID,
      score: finalScore,
      priority: finalPriority
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

// DELETE /api/leads/:id - Delete a specific lead
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
  console.log(`🚀 AgentFlow API running on port ${PORT}`);
  console.log(`📍 URL: https://nodejs-production-3d033.up.railway.app`);
});
