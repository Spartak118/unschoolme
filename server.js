const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const fetch = require('node-fetch');
const app = express();
const path = require('path');

app.use(express.json());
app.use(session({
  secret: 'unschoolme-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const users = [];

app.post('/api/register', async (req, res) => {
  const { name, email, password, phone, role } = req.body;
  if (!name || !email || !password) return res.json({ success: false, error: 'Missing required fields' });
  if (users.find(u => u.email === email)) return res.json({ success: false, error: 'Email already registered' });
  const hashed = await bcrypt.hash(password, 10);
  const user = { id: uuidv4(), name, email, phone: phone || '', password: hashed, role: role || 'learner' };
  users.push(user);

  // Sync to CRM
  try {
    await fetch('https://crm-backend-flame.vercel.app/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'UnschoolMe',
        type: user.role,
        firstName: user.name.split(' ')[0],
        lastName: user.name.split(' ')[1] || '',
        email: user.email,
        phone: user.phone || '',
        notes: 'Registered via UnschoolMe'
      })
    });
    console.log('✅ CRM sync successful:', user.email);
  } catch (err) {
    console.log('CRM sync failed:', err.message);
  }

  const { password: _, ...safeUser } = user;
  req.session.userId = user.id;
  res.json({ success: true, user: safeUser });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user) return res.json({ success: false, error: 'Invalid email or password' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.json({ success: false, error: 'Invalid email or password' });
  const { password: _, ...safeUser } = user;
  req.session.userId = user.id;
  res.json({ success: true, user: safeUser });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = users.find(u => u.id === req.session.userId);
  if (!user) return res.json({ user: null });
  const { password: _, ...safeUser } = user;
  res.json({ user: safeUser });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/taxes', (req, res) => res.sendFile(path.join(__dirname, 'public/taxes/index.html')));
app.get('/banking', (req, res) => res.sendFile(path.join(__dirname, 'public/banking/index.html')));
app.get('/credit', (req, res) => res.sendFile(path.join(__dirname, 'public/credit/index.html')));
app.get('/government', (req, res) => res.sendFile(path.join(__dirname, 'public/government/index.html')));
app.get('/business', (req, res) => res.sendFile(path.join(__dirname, 'public/business/index.html')));
app.get('/rights', (req, res) => res.sendFile(path.join(__dirname, 'public/rights/index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public/login/index.html')));
app.get('/upload', (req, res) => res.sendFile(path.join(__dirname, 'public/upload/index.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public/chat/index.html')));

app.post('/api/chat', (req, res) => {
  const { message } = req.body;
  if (!message) return res.json({ answer: 'Please ask me something!' });
  const knowledge = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/knowledge.json'), 'utf8'));
  const q = message.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;
  knowledge.entries.forEach(entry => {
    let score = 0;
    entry.keywords.forEach(keyword => {
      if (q.includes(keyword.toLowerCase())) score += keyword.split(' ').length;
    });
    if (score > bestScore) { bestScore = score; bestMatch = entry; }
  });
  if (bestMatch && bestScore > 0) {
    res.json({ answer: bestMatch.answer, topic: bestMatch.question, confidence: bestScore });
  } else {
    res.json({ answer: "I don't have a specific answer for that yet." });
  }
});

app.listen(3000, () => console.log('UnschoolMe v2 running at http://localhost:3000'));