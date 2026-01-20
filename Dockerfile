FROM node:18-alpine

# Install system dependencies
# python3: Required for some yt-dlp functionalities
# ffmpeg: Required for audio conversion
# curl: Used to download yt-dlp
RUN apk add --no-cache python3 ffmpeg curl

# Install yt-dlp globally
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Copy package files first for caching
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production

# Copy application source code
COPY . .

# Create directories for data persistence
RUN mkdir -p downloads temp data bin

# Environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
