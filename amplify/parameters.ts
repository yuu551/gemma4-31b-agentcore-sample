export const parameters = {
  // AgentCore Gateway（AWS Knowledge MCP）を有効にする場合は true に変更
  // 環境変数 ENABLE_GATEWAY=true でも有効化できる（sandbox 開発用）
  enableGateway: process.env.ENABLE_GATEWAY === "true" || false,
};
