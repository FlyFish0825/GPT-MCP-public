// Only the Desktop Commander child receives this preload. Keep its config,
// telemetry state and tool history separate from existing installations.
if (!process.env.GPT_MCP_DC_HOME) throw new Error('Missing isolated DC home');
require('node:os').homedir = () => process.env.GPT_MCP_DC_HOME;
