export type Role = 'user' | 'assistant';

export type FeedbackMistake = {
  wrong: string;
  correct: string;
  explanation: string;
};

export type Feedback = {
  mistakes: FeedbackMistake[];
  natural?: string;
};

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  feedback?: Feedback;
};

export type ApiChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};
