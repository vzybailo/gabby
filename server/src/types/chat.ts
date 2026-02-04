export type Mistake = {
  wrong: string;
  correct: string;
  explanation: string;
};

export type Feedback = {
  mistakes: Mistake[];
  natural: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  feedback?: Feedback;
};

export type ApiChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};
