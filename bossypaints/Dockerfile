# Stage 1: Build the application
FROM node:18 AS build

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Serve the application
FROM node:18-alpine

# Set the working directory
WORKDIR /app

# Copy the build output
COPY --from=build /app ./

# Install production dependencies
RUN npm install --production

# Expose port 3000
EXPOSE 3000

# Start the application
CMD ["node", "build"]