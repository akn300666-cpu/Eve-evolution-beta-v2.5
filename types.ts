
export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  image?: string; // Base64 string for images displayed in chat
  isError?: boolean;
  isImageLoading?: boolean;
}

export type ModelTier = 'free' | 'pro';
export type Language = 'en' | 'ml' | 'manglish';

export interface EveConfig {
  voiceEnabled: boolean;
  personality: 'default' | 'bananafy';
  language: Language;
}

export interface ApiKeyDef {
  id: string;
  label: string;
  key: string;
}

export interface GenerationSettings {
  // Image Gen Settings
  guidance: number;
  steps: number;
  ipAdapterStrength: number;
  loraStrength: number;
  seed: number;
  randomizeSeed: boolean;
  // Chat Model Settings
  temperature: number;
  topP: number;
  topK: number;
  // Language
  language: Language;
}
