import { config } from './config.js';

export class GeminiReasoner {
  get configured() { return Boolean(config.geminiApiKey || (config.vertex && config.vertexAccessToken)); }

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

  async generate(prompt) {
    if (config.geminiApiKey) {
      const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`;
      const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0.1,responseMimeType:'application/json'}})});
      if(!r.ok) throw new Error(`Gemini request failed (${r.status})`);
      const data=await r.json();
      return data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('') || '';
    }
    throw new Error('Vertex AI direct token mode is not configured. Set GEMINI_API_KEY for local live Gemini.');
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
