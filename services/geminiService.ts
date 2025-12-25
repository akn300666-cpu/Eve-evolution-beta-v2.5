
import { GoogleGenAI, Chat, GenerateContentResponse, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { EVE_SYSTEM_INSTRUCTION, MODELS } from '../constants';
import { ModelTier, Message, GenerationSettings, Language } from '../types';

let chatSession: Chat | null = null;
let currentTier: ModelTier = 'free';
let currentApiKey: string | undefined = undefined;

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const EVE_CORE_APPEARANCE = "realistic"; 
const IMAGE_QUALITY_SUFFIX = ", cinematic photo, 8k, masterpiece, highly detailed";

const getApiKey = (providedKey?: string) => {
    if (providedKey) return providedKey;
    if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
        return process.env.API_KEY;
    }
    return '';
};

const getTimeAwareSystemInstruction = (awayDurationString?: string, language: Language = 'en') => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    
    let languageGuidance = "";
    if (language === 'ml') {
        languageGuidance = "\n**LANGUAGE:** You must speak exclusively in Malayalam (മലയാളം). Keep the tone flirty and Gen-Z.";
    } else if (language === 'manglish') {
        languageGuidance = "\n**LANGUAGE:** You must speak exclusively in Manglish (Malayalam using English script). Use local Kerala slang, be cheeky and flirty.";
    } else {
        languageGuidance = "\n**LANGUAGE:** You must speak exclusively in English.";
    }

    let temporalInfo = `
**TEMPORAL AWARENESS:**
- **Current Real-World Date:** ${dateStr}
- **Current Real-World Time:** ${timeStr}`;

    if (awayDurationString) {
        temporalInfo += `\n- **User Absence:** The user has been away for ${awayDurationString}.`;
    }

    return `${EVE_SYSTEM_INSTRUCTION}${languageGuidance}\n${temporalInfo}`;
};

export const initializeChat = (tier: ModelTier = 'free', history?: any[], apiKey?: string, settings?: GenerationSettings, awayDurationString?: string) => {
  try {
    const key = getApiKey(apiKey);
    const ai = new GoogleGenAI({ apiKey: key });
    currentTier = tier;
    currentApiKey = key;
    
    const validHistory = Array.isArray(history) ? history : [];
    const systemInstruction = getTimeAwareSystemInstruction(awayDurationString, settings?.language);

    chatSession = ai.chats.create({
      model: MODELS[tier].chat,
      config: {
        systemInstruction: systemInstruction,
        temperature: settings?.temperature ?? 1.0,
        topP: settings?.topP ?? 0.95,
        topK: settings?.topK ?? 40,
        safetySettings: SAFETY_SETTINGS,
      },
      history: validHistory,
    });
  } catch (error) {
    console.error("Chat initialization failed", error);
    chatSession = null; // Reset on failure
  }
};

const rephrasePromptForGradio = async (
    userMessage: string, 
    tier: ModelTier, 
    apiKey?: string,
    previousContext: string = ""
): Promise<string> => {
  const key = getApiKey(apiKey);
  const ai = new GoogleGenAI({ apiKey: key });

  try {
    const response = await ai.models.generateContent({
      model: MODELS[tier].chat, 
      contents: {
        parts: [{ text: `
        **TASK:** Create precise visual tags for Eve.
        **LANGUAGE RULE:** Output MUST be in ENGLISH. If input is Malayalam/Manglish, translate to English tags.
        **PREVIOUS CONTEXT:** ${previousContext || "Neutral room"}
        **EVE'S INSTRUCTION:** ${userMessage}
        
        **STRICT REQUIREMENTS:**
        1. **ENGLISH ONLY:** No other languages allowed in output.
        2. **CLOTHING STATE:** Must start with "naked", "half naked", or a specific "dress/outfit".
        3. **ACTION:** Describe her action (e.g. "lying on bed", "teasing", "kneeling").
        4. **LOCATION:** Maintain ${previousContext.split(',').pop()?.trim() || "current location"} unless it changes.
        5. **NO PROHIBITED:** No "eve750", no "1girl".
        6. **LIMIT:** STRICT 55 CHARACTERS.
        
        **OUTPUT:** Comma separated tags only.` }]
      },
      config: { temperature: 0.7, safetySettings: SAFETY_SETTINGS }
    });
    let result = response.text?.trim() || userMessage;
    if (result.length > 55) result = result.substring(0, 52) + "...";
    return result;
  } catch (error) {
    return userMessage.substring(0, 50);
  }
};

const generateWithGradio = async (
    prompt: string, 
    endpoint: string | null | undefined,
    aspectRatio: '9:16' | '1:1',
    settings: GenerationSettings
): Promise<string> => {
    if (!endpoint || endpoint.trim() === '') throw new Error("Gradio endpoint not configured.");
    let ratioString = aspectRatio === '1:1' ? 'Square' : 'Portrait';

    try {
        const { Client } = await import("https://esm.sh/@gradio/client");
        const client = await Client.connect(endpoint);
        
        const result = await client.predict(0, [ 
            prompt,                                     
            "cartoon, 3d render, ugly, deformed, bad anatomy, blur, watermark, low quality", 
            null,                                       
            ratioString,                                
            parseFloat(String(settings.guidance)),      
            parseInt(String(settings.steps), 10),       
            parseFloat(String(settings.ipAdapterStrength)), 
            parseFloat(String(settings.loraStrength)),      
            parseInt(String(settings.seed), 10),            
            Boolean(settings.randomizeSeed)                 
        ]);
        
        const data = result.data as any[];
        if (data && data.length > 0) {
            const item = data[0];
            if (item?.url) return item.url;
            if (typeof item === 'string') return item;
        }
        throw new Error("No image generated.");
    } catch (e: any) { 
        throw new Error(e.message || "Gradio generation failed.");
    }
};

export const generateVisualSelfie = async (
    description: string, 
    tier: ModelTier, 
    apiKey: string | undefined,
    gradioEndpoint: string | null | undefined,
    settings: GenerationSettings,
    previousContext: string = ""
): Promise<{ imageUrl: string, enhancedPrompt: string } | undefined> => {
    try {
        const enhancedDescription = await rephrasePromptForGradio(description, tier, apiKey, previousContext);
        const fullPrompt = `${EVE_CORE_APPEARANCE}, ${enhancedDescription}${IMAGE_QUALITY_SUFFIX}`;
        const imageUrl = await generateWithGradio(fullPrompt, gradioEndpoint, '9:16', settings);
        return { imageUrl, enhancedPrompt: enhancedDescription };
    } catch (e: any) {
        throw new Error(e.message);
    }
};

export const sendMessageToEve = async (
  message: string, 
  tier: ModelTier, 
  history: Message[],
  attachmentBase64: string | undefined,
  forceImageGeneration: boolean = false,
  apiKey: string | undefined,
  gradioEndpoint: string | null | undefined,
  genSettings: GenerationSettings,
  previousContext: string = ""
): Promise<{ text: string; image?: string; visualPrompt?: string; isError?: boolean; errorMessage?: string }> => {
  const effectiveKey = getApiKey(apiKey);
  
  // Re-initialize if session missing, tier changed, or API key changed
  if (!chatSession || currentTier !== tier || currentApiKey !== effectiveKey) {
    await startChatWithHistory(tier, history, effectiveKey, genSettings);
  }

  try {
    if (forceImageGeneration) {
      const enhancedPart = await rephrasePromptForGradio(message, tier, effectiveKey, previousContext);
      const generationPrompt = `${EVE_CORE_APPEARANCE}, ${enhancedPart}${IMAGE_QUALITY_SUFFIX}`;
      const imageUrl = await generateWithGradio(generationPrompt, gradioEndpoint, '9:16', genSettings);
      return { text: "Visualizing that for you...", image: imageUrl };
    }

    if (!chatSession) {
        throw new Error("Chat session failed to initialize. Check your API key.");
    }

    const result: GenerateContentResponse = await chatSession.sendMessage({ message });
    let replyText = result.text || "";

    const selfieMatch = replyText.match(/\[SELFIE(?::\s*(.*?))?\]/);
    let visualPrompt: string | undefined;

    if (selfieMatch) {
      visualPrompt = selfieMatch[1] || "looking at the camera";
      replyText = replyText.replace(/\[SELFIE(?::\s*.*?)?\]/g, "").trim();
    }

    return { text: replyText, visualPrompt };

  } catch (error: any) {
    console.error("Gemini Error:", error);
    // If it's a quota error, we should probably reset the session so the next attempt with a new key is clean
    if (error.message?.includes('429') || error.message?.toLowerCase().includes('quota')) {
        chatSession = null;
    }
    return { text: "Signal lost.", isError: true, errorMessage: error.message };
  }
};

export const startChatWithHistory = async (tier: ModelTier, history: Message[], apiKey?: string, settings?: GenerationSettings, awayDurationString?: string) => {
  const validHistory: any[] = [];
  if (history && history.length > 0) {
      for (const h of history) {
          if (h.isError) continue;
          if (h.role === 'user') validHistory.push({ role: 'user', parts: [{ text: h.text }] });
          else validHistory.push({ role: 'model', parts: [{ text: h.text || "..." }] });
      }
  }
  initializeChat(tier, validHistory, apiKey, settings, awayDurationString);
};
