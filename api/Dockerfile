FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application source
COPY src ./src
COPY views ./views
COPY public ./public

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["node", "src/index.js"]
