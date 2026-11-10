export interface Message {
  id: string;
  role: 'user' | 'friday' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  researchId?: string;
  researchResponse?: boolean;
}

export type CommandHandler = (cmd: string) => Promise<string | void>;
