
export enum TokenType {
  ERC20 = "ERC-20",
  ERC721 = "ERC-721",
  ERC1155 = "ERC-1155",
}

export type MintItem = {
  blockNumber: number;
  txHash: string;
  logIndex: number;
  contract: string;
  to: string;
  type: TokenType;
  tokenId?: string; // For ERC721, ERC1155
  amount?: string; // For ERC20, ERC1155
  timestamp?: number;
};

export type ContractMeta = {
  name?: string;
  symbol?: string;
  decimals?: number;
};

export type CollSummary = {
  address: string;
  type: TokenType;
  name?: string;
  symbol?: string;
  decimals?: number;
  totalMintEvents: number;
  uniqueTokens: number;
  tokenIds: Set<string>;
};
