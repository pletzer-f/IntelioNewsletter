// api/chat.js — POST /api/chat
// Receives a natural-language message from the briefing chat panel,
// uses Claude to extract structured preference updates, saves them to
// the client record, and returns a human-readable explanation.

import Anthropic from '@anthropic-ai/sdk';
import { getClient, supabase } from '../lib/supabase.js';

export const config = { runtime: 'nodejs' };

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { clientId, message } = body;
  if (!clientId || !message?.trim()) {
    return res.status(400).json({ error: 'Missing clientId or message' });
  }

  // Load current client profile so Claude has full context
  let client;
  try {
    client = await getClient(clientId);
  } catch {
    return res.status(404).json({ error: 'Client not found' });
  }

  const system = `You are Intelio's briefing assistant — a sharp, concise intelligence analyst.
The user is reading their personalised daily economic briefing and wants to customise future editions.

Your job:
1. Understand what the user wants to change or add to their briefing focus.
2. Extract specific, structured updates that should be applied to their briefing profile.
3. Respond with a JSON object — nothing else, no markdown fences — in this exact format:
{
  "reply": "A short, confident 1–2 sentence confirmation of what you've noted, written in first person. Be specific about what changes. Start with 'Noted —' or 'Got it —'.",
  "updates": {
    "client_profile": "Updated profile text incorporating the user's request (full replacement, not append). Keep it concise and structured for AI agent consumption.",
    "client_topics": ["topic1", "topic2"],
    "client_entities": ["Entity1", "Entity2"]
  }
}

Rules:
- Only include fields in "updates" that actually need changing. Omit unchanged fields entirely.
- client_topics: short keyword phrases (2–5 words each), max 8 items.
- client_entities: proper names only (companies, people, institutions), max 10 items.
- client_profile: plain text, max 600 chars, structured for search query generation.
- Never invent data. Base updates strictly on what the user said.
- If the user's request is unclear or too vague to act on, set "updates" to {} and ask a clarifying question in "reply".`;

  const userPrompt = `Current client profile for ${client.client_name}:
---
Company: ${client.client_name}
Region: ${client.region}
Current profile: ${client.client_profile || '(none)'}
Current topics: ${(client.client_topics || []).join(', ') || '(none)'}
Current entities: ${(client.client_entities || []).join(', ') || '(none)'}
---

User's message: "${message.trim()}"

Respond with the JSON object only.`;

  let aiResponse;
  try {
    const msg = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 600,
      system,
      messages:   [{ role: 'user', content: userPrompt }],
    });
    aiResponse = msg.content[0].text.trim();
  } catch (err) {
    console.error('[chat] Claude error:', err.message);
    return res.status(500).json({ error: 'AI unavailable — please try again.' });
  }

  // Parse Claude's JSON response
  let parsed;
  try {
    // Strip any accidental markdown fences
    const clean = aiResponse.replace(/^```json?\s*/i, '').replace(/\s*```$/, '');
    parsed = JSON.parse(clean);
  } catch {
    console.error('[chat] JSON parse error. Raw response:', aiResponse);
    return res.status(500).json({ error: 'AI returned unexpected format — please try again.' });
  }

  const { reply, updates = {} } = parsed;

  // Apply updates to Supabase if there are any
  if (Object.keys(updates).length > 0) {
    try {
      const dbUpdates = {
        updated_at: new Date().toISOString(),
      };
      if (updates.client_profile !== undefined) dbUpdates.client_profile = updates.client_profile;
      if (updates.client_topics  !== undefined) dbUpdates.client_topics  = updates.client_topics;
      if (updates.client_entities !== undefined) dbUpdates.client_entities = updates.client_entities;

      const { error } = await supabase
        .from('clients')
        .update(dbUpdates)
        .eq('id', clientId);

      if (error) throw error;
      console.log(`[chat] Updated profile for ${clientId}:`, Object.keys(dbUpdates));
    } catch (err) {
      console.error('[chat] Supabase update error:', err.message);
      // Return the reply anyway — don't fail silently
      return res.status(500).json({ error: 'Preference saved by AI but not written to database — please try again.' });
    }
  }

  return res.status(200).json({ reply, saved: Object.keys(updates).length > 0 });
}
