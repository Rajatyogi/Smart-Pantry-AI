require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const SECRET = process.env.JWT_SECRET || 'smart-pantry-secret-key';
const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Database ----------
// By default data is saved in data.json (no setup needed).
// If MONGO_URI is set in .env, MongoDB Atlas is used instead.
const FILE = path.join(__dirname, 'data.json');
let mem = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : { users: [], items: [], shopping: [] };
const saveFile = () => fs.writeFileSync(FILE, JSON.stringify(mem, null, 2));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
let mongo = null;

const db = {
  async find(col, q) {
    if (mongo) return mongo.collection(col).find(q).toArray();
    return mem[col].filter(d => Object.keys(q).every(k => d[k] === q[k]));
  },
  async add(col, doc) {
    doc._id = newId();
    if (mongo) await mongo.collection(col).insertOne(doc);
    else { mem[col].push(doc); saveFile(); }
    return doc;
  },
  async update(col, id, userId, patch) {
    delete patch._id; delete patch.userId;
    if (mongo) await mongo.collection(col).updateOne({ _id: id, userId }, { $set: patch });
    else {
      const d = mem[col].find(x => x._id === id && x.userId === userId);
      if (d) Object.assign(d, patch);
      saveFile();
    }
    return { ok: true };
  },
  async remove(col, id, userId) {
    if (mongo) await mongo.collection(col).deleteOne({ _id: id, userId });
    else { mem[col] = mem[col].filter(x => !(x._id === id && x.userId === userId)); saveFile(); }
    return { ok: true };
  }
};

// ---------- Helpers ----------
const wrap = fn => (req, res) => fn(req, res).catch(e => res.status(500).json({ error: e.message }));
const makeToken = u => jwt.sign({ id: u._id }, SECRET, { expiresIn: '7d' });
function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    req.userId = jwt.verify(token, SECRET).id;
    next();
  } catch (e) { res.status(401).json({ error: 'Please login again' }); }
}

// ---------- Auth routes ----------
app.post('/api/signup', wrap(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields are required' });
  const mail = email.toLowerCase().trim();
  if ((await db.find('users', { email: mail })).length) return res.status(400).json({ error: 'Email is already registered' });
  const user = await db.add('users', { name, email: mail, password: await bcrypt.hash(password, 10) });
  res.json({ token: makeToken(user), name: user.name });
}));

app.post('/api/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const [user] = await db.find('users', { email: (email || '').toLowerCase().trim() });
  if (!user || !(await bcrypt.compare(password || '', user.password))) return res.status(400).json({ error: 'Wrong email or password' });
  res.json({ token: makeToken(user), name: user.name });
}));

// ---------- Pantry items ----------
app.get('/api/items', auth, wrap(async (req, res) => res.json(await db.find('items', { userId: req.userId }))));
app.post('/api/items', auth, wrap(async (req, res) => {
  const { name, quantity, unit, category, expiry } = req.body;
  if (!name || !expiry) return res.status(400).json({ error: 'Name and expiry date are required' });
  res.json(await db.add('items', { userId: req.userId, name, quantity: Number(quantity) || 1, unit: unit || 'pcs', category: category || 'Other', expiry }));
}));
app.put('/api/items/:id', auth, wrap(async (req, res) => res.json(await db.update('items', req.params.id, req.userId, req.body))));
app.delete('/api/items/:id', auth, wrap(async (req, res) => res.json(await db.remove('items', req.params.id, req.userId))));

// ---------- Shopping list ----------
app.get('/api/shopping', auth, wrap(async (req, res) => res.json(await db.find('shopping', { userId: req.userId }))));
app.post('/api/shopping', auth, wrap(async (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: 'Item name is required' });
  res.json(await db.add('shopping', { userId: req.userId, name: req.body.name, bought: false, reason: 'Added by you' }));
}));
app.put('/api/shopping/:id', auth, wrap(async (req, res) => res.json(await db.update('shopping', req.params.id, req.userId, req.body))));
app.delete('/api/shopping/:id', auth, wrap(async (req, res) => res.json(await db.remove('shopping', req.params.id, req.userId))));

// Smart list: add items that are expired or running low (quantity 1 or less)
app.post('/api/shopping/generate', auth, wrap(async (req, res) => {
  const items = await db.find('items', { userId: req.userId });
  const list = await db.find('shopping', { userId: req.userId });
  const today = new Date(new Date().toDateString());
  for (const it of items) {
    const expired = new Date(it.expiry + 'T00:00:00') < today;
    const low = it.quantity <= 1;
    const already = list.some(s => !s.bought && s.name.toLowerCase() === it.name.toLowerCase());
    if ((expired || low) && !already) {
      await db.add('shopping', { userId: req.userId, name: it.name, bought: false, reason: expired ? 'Expired' : 'Running low' });
    }
  }
  res.json(await db.find('shopping', { userId: req.userId }));
}));

// ---------- AI recipes (Google Gemini) ----------
async function askGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } })
  });
  const data = await r.json();
  return JSON.parse(data.candidates[0].content.parts[0].text);
}

app.post('/api/recipes', auth, wrap(async (req, res) => {
  const items = await db.find('items', { userId: req.userId });
  if (!items.length) return res.status(400).json({ error: 'Add some pantry items first' });
  // Use items that expire first, so food is not wasted
  const names = items.sort((a, b) => a.expiry.localeCompare(b.expiry)).map(i => i.name);
  const prompt = `I have these ingredients: ${names.join(', ')}. Suggest 3 simple recipes that use them (use the first ones first). ` +
    `Reply only with a JSON array. Each item: {"title": string, "time": string, "ingredients": [string], "steps": [string]}.`;
  try {
    const recipes = await askGemini(prompt);
    if (recipes) return res.json({ source: 'Google Gemini', recipes });
  } catch (e) { console.log('Gemini failed, using sample recipes:', e.message); }
  // Fallback so the app always works (no API key or no internet)
  const a = names.slice(0, 3).join(', ');
  res.json({
    source: 'Sample (add GEMINI_API_KEY in .env for real AI recipes)',
    recipes: [
      { title: `Quick Stir Fry with ${names[0]}`, time: '20 min', ingredients: names.slice(0, 4), steps: ['Chop all ingredients.', 'Heat oil in a pan.', 'Cook the ingredients for 8-10 minutes.', 'Add salt and spices, then serve hot.'] },
      { title: 'Pantry Mix Soup', time: '25 min', ingredients: names.slice(0, 5), steps: ['Boil water in a pot.', `Add ${a}.`, 'Simmer for 15 minutes.', 'Season and serve.'] },
      { title: 'Simple Veg Wrap', time: '15 min', ingredients: names.slice(0, 3), steps: ['Lightly cook the ingredients.', 'Place them on a roti or bread.', 'Roll it up and enjoy.'] }
    ]
  });
}));

// ---------- Start ----------
(async () => {
  if (process.env.MONGO_URI) {
    try {
      const { MongoClient } = require('mongodb');
      const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      await client.connect();
      mongo = client.db('smartpantry');
      console.log('Database: MongoDB Atlas connected');
    } catch (e) { console.log('MongoDB failed (' + e.message + '). Using local data.json instead.'); }
  } else console.log('Database: local data.json');
  app.listen(PORT, () => console.log(`\nPantry is running. Open http://localhost:${PORT}\n`));
})();
