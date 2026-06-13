# Stage 1: Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies
RUN npm ci

# Copy the rest of the application files
COPY . .

# Build both frontend assets and bundled backend server
RUN npm run build

# Stage 2: Production stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
# Expose port 3000 (standard for this applet)
EXPOSE 3000

# Copy package files
COPY package*.json ./

# Install only production dependencies (excluding devDependencies to keep image extremely light)
RUN npm ci --only=production

# Copy built assets and compiled server from builder
COPY --from=builder /app/dist ./dist

# Copy local database fallback and firebase-applet config if present
COPY --from=builder /app/db.json ./db.json
COPY --from=builder /app/firebase-applet-config.json ./firebase-applet-config.json

# Command to run the production backend
CMD ["npm", "run", "start"]
