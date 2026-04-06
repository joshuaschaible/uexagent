export type NamedTable = {
  title: string;
  headers: string[];
  rows: string[][];
};

export type Message = {
  id: string;
  role: "user" | "bot";
  text: string;
  table?: {
    headers: string[];
    rows: string[][];
  };
  tables?: NamedTable[];
  chart?: {
    type: "line";
    data: { label: string; buyPrice: number; sellPrice: number }[];
    commodityName: string;
  };
  map?: {
    system: string;
    routes: { from: string; to: string; profit: number; commodity: string }[];
    highlights: string[];
  };
  image?: {
    url: string;
    alt: string;
    caption?: string;
  };
  profit?: ProfitData;
  isError?: boolean;
  isStreaming?: boolean;
  isLLM?: boolean;
};

export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
};

export type ProfitData = {
  shipName: string;
  commodityName: string;
  scu: number;
  buyPrice: number;
  sellPrice: number;
  buyTerminal: string;
  sellTerminal: string;
};

export type ChatResponse = {
  text: string;
  table?: {
    headers: string[];
    rows: string[][];
  };
  tables?: NamedTable[];
  chart?: {
    type: "line";
    data: { label: string; buyPrice: number; sellPrice: number }[];
    commodityName: string;
  };
  map?: {
    system: string;
    routes: { from: string; to: string; profit: number; commodity: string }[];
    highlights: string[];
  };
  image?: {
    url: string;
    alt: string;
    caption?: string;
  };
  profit?: ProfitData;
  isLLM?: boolean;
};
