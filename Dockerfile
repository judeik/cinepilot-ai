# Production dual-runtime image for CinePilot AI V3
# Supports Node.js >= 20 and Python >= 3.10 for the stdio MCP server
FROM node:20-slim

# Install Python 3, pip, and CA certificates for secure HTTPS ClickHouse/Gemini calls
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests first to leverage Docker layer caching
COPY package.json ./
COPY requirements.txt ./

# Install production Node dependencies (zero third-party dependencies required)
RUN npm install --omit=dev --ignore-scripts

# Install Python dependencies for the ClickHouse MCP server
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Copy application source code, static assets, and scenario data
COPY src/ ./src/
COPY public/ ./public/
COPY data/ ./data/

# Default production environment configuration
# Cloud providers (Cloud Run, Render, Railway) will inject PORT dynamically
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8056 \
    CLICKHOUSE_MCP_COMMAND=mcp-clickhouse \
    CLICKHOUSE_MCP_ARGS="" \
    CLICKHOUSE_ALLOW_WRITE_ACCESS=false

EXPOSE 8056

# Health check compatible with standard container runtimes
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:' + (process.env.PORT || 8056) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start CinePilot AI command center
CMD ["npm", "start"]
