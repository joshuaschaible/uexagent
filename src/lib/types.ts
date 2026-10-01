export type NamedTable = {
  title: string;
  headers: string[];
  rows: string[][];
};

export type PriceChartData = {
  type: "line";
  data: { label: string; buyPrice: number | null; sellPrice: number | null; timestamp?: number }[];
  commodityName: string;
  terminalName?: string;
  gameVersion?: string;
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
  chart?: PriceChartData;
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
  cargoCapacity?: number;
  assumptions?: string;
};

export type ChatResponse = {
  text: string;
  table?: {
    headers: string[];
    rows: string[][];
  };
  tables?: NamedTable[];
  chart?: PriceChartData;
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
