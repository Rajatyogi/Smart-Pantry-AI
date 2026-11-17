# Pantry: Intelligent Kitchen Inventory & Meal Planner

Submitted by: Rajat Yogi | KID: K25687 | B.Tech (CSE) | Career Point University

## How to run
1. Install Node.js (version 18 or higher) from https://nodejs.org
2. Open this folder in VS Code, then open the terminal (Ctrl + `)
3. Run: `npm install`
4. Run: `npm start`
5. Open http://localhost:3000 in your browser (internet is needed for the React/Tailwind CDN files)

## Optional settings (.env)
Copy `.env.example` to `.env` and fill in:
- `GEMINI_API_KEY` : real AI recipes from Google Gemini (without it, sample recipes are shown)
- `MONGO_URI`      : MongoDB Atlas connection string (without it, data is saved in data.json)

## Features
Login/Signup (JWT) | Pantry with expiry tracking | Dashboard analytics | Reminders |
AI recipes (Gemini) | Smart shopping list

## Tech stack
React.js + Tailwind CSS, Node.js + Express.js, MongoDB Atlas (or JSON file), JWT, Google Gemini API
