import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';

export class GeminiReasoner {
  get configured() {
    if (config.vertex) {
      return Boolean(config.project && config.location);
    }
    return Boolean(config.geminiApiKey || (config.project && config.location));
  }

  async reason({ incident, evidence, plans }) {
    if (!this.configured) return { mode:'deterministic-development', summary:'Gemini is not configured; deterministic local reasoning is being used for development. No Gemini claim is made.', recommendation: plans[0]?.strategy || 'reorder' };
    const allowedStrategies = (plans || []).map(p => p.strategy).filter(Boolean);
    const prompt = `You are CinePilot, a production recovery intelligence agent. Use ONLY the supplied evidence. Do not invent facts.
Return a valid JSON object with EXACTLY the following keys:
- "summary": (string) Brief summary of the incident and impact.
- "recommendation": (string) The exact candidate strategy name chosen from [${allowedStrategies.map(s => `"${s}"`).join(', ')}]. Must be ONLY the exact strategy string identifier, nothing else.
- "risks": (string) Key risks of chosen or alternative options based on evidence.
- "expected_outcome": (string) Expected recovery outcome.

Incident:
${JSON.stringify(incident)}

Evidence:
${JSON.stringify(evidence)}

Candidate plans:
${JSON.stringify(plans)}`;

    let text;
    try {
      text = await this.generate(prompt);
    } catch (err) {
      console.warn(`[GeminiReasoner] Gemini API request failed (${err.message}). Using deterministic fallback.`);
      return {
        mode: 'deterministic-fallback',
        summary: `Gemini API temporarily unavailable (${err.message}); fallback to deterministic plan ranking.`,
        recommendation: plans[0]?.strategy || 'reorder',
        risks: 'Fallback reasoning: review deterministic score breakdown.',
        expected_outcome: 'Deterministic ranking outcome applied.'
      };
    }

    const parsed = extractJson(text);

    const validStrategy = normalizeStrategy(parsed?.recommendation, allowedStrategies);
    if (
      !parsed ||
      typeof parsed.summary !== 'string' || !parsed.summary.trim() ||
      typeof parsed.risks !== 'string' || !parsed.risks.trim() ||
      typeof parsed.expected_outcome !== 'string' || !parsed.expected_outcome.trim() ||
      !validStrategy
    ) {
      console.warn('[GeminiReasoner] Schema validation failed for Gemini response:', {
        hasParsed: Boolean(parsed),
        summaryType: typeof parsed?.summary,
        risksType: typeof parsed?.risks,
        expectedOutcomeType: typeof parsed?.expected_outcome,
        rawRecommendation: parsed?.recommendation,
        allowedStrategies
      });
      throw new Error('Gemini returned an invalid decision schema.');
    }

    return {
      mode: 'gemini',
      summary: parsed.summary.trim(),
      recommendation: validStrategy,
      risks: parsed.risks.trim(),
      expected_outcome: parsed.expected_outcome.trim()
    };
  }

  createClient() {
    if (config.vertex) {
      if (!config.project || !config.location) {
        throw new Error(
          'Vertex AI configuration missing: GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION must be set.'
        );
      }
      return new GoogleGenAI({
        vertexai: true,
        project: config.project,
        location: config.location
      });
    }

    if (config.geminiApiKey) {
      return new GoogleGenAI({ apiKey: config.geminiApiKey });
    }

    return null;
  }

  async generate(prompt) {
    const client = this.createClient();
    if (!client) {
      throw new Error(
        'Google Cloud Gen AI SDK is not configured. Configure Vertex AI via GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION.'
      );
    }
    const response = await client.models.generateContent({
      model: config.geminiModel || 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });
    return response.text || '';
  }
}

function normalizeStrategy(raw, allowed) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (allowed.includes(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  const directMatch = allowed.find(s => s.toLowerCase() === lower);
  if (directMatch) return directMatch;
  return null;
}

function extractJson(text){ try{return JSON.parse(text)}catch{} const a=text.indexOf('{'),b=text.lastIndexOf('}'); if(a>=0&&b>a){try{return JSON.parse(text.slice(a,b+1))}catch{}} return null; }
